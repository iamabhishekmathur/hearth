import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock ioredis so we can drive cross-instance pub/sub deterministically. ──
// Each `new Redis()` returns a client bound to a single shared in-memory bus,
// so a `publish` on one "connection" is delivered to subscribers on all the
// others — exactly the multi-instance shape we want to assert.
type Listener = (channel: string, message: string) => void;
const bus = {
  subscribers: new Set<Listener>(),
  publish(channel: string, message: string) {
    for (const l of this.subscribers) l(channel, message);
  },
};

vi.mock('ioredis', () => {
  class MockRedis {
    private listeners: Listener[] = [];
    on(event: string, cb: Listener) {
      if (event === 'message') {
        this.listeners.push(cb);
        bus.subscribers.add(cb);
      }
      return this;
    }
    async subscribe() {
      return 1;
    }
    async publish(channel: string, message: string) {
      bus.publish(channel, message);
      return 1;
    }
  }
  return { default: MockRedis };
});

vi.mock('../config.js', () => ({ env: { REDIS_URL: 'redis://localhost:6379' } }));
vi.mock('../lib/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import {
  initRunRegistry,
  registerRun,
  unregisterRun,
  requestStop,
  claimFinalize,
  getActiveRun,
  getActiveRunsForSession,
  newRunId,
  __resetRunRegistryForTests,
} from './run-registry.js';

describe('run-registry', () => {
  beforeEach(() => {
    __resetRunRegistryForTests();
    bus.subscribers.clear();
    vi.clearAllMocks();
  });

  it('registers and finds a run; unregister removes it', () => {
    const runId = newRunId();
    const ctl = registerRun({ runId, sessionId: 's1', initiatorUserId: 'u1' });
    expect(getActiveRun(runId)?.initiatorUserId).toBe('u1');
    expect(getActiveRunsForSession('s1').map((r) => r.runId)).toContain(runId);
    expect(ctl.signal.aborted).toBe(false);
    unregisterRun(runId);
    expect(getActiveRun(runId)).toBeUndefined();
  });

  it('requestStop aborts a locally-owned run', async () => {
    const runId = newRunId();
    const ctl = registerRun({ runId, sessionId: 's1', initiatorUserId: 'u1' });
    await requestStop(runId);
    expect(ctl.signal.aborted).toBe(true);
  });

  // ── §5.1 case 12: cross-instance stop via Redis pub/sub ──
  it('case 12: a stop published on instance A aborts the run owned by instance B', async () => {
    // Instance B owns the run and is subscribed to the stop channel.
    initRunRegistry();
    const runId = newRunId();
    const ctl = registerRun({ runId, sessionId: 's-multi', initiatorUserId: 'u1' });

    // Instance A publishes a stop for a run it does NOT own (simulated by
    // publishing directly to the shared bus — requestStop also publishes).
    bus.publish('chat:stop', JSON.stringify({ runId }));

    expect(ctl.signal.aborted).toBe(true);
  });

  it('ignores cross-instance stops for runs it does not own', () => {
    initRunRegistry();
    const mine = registerRun({ runId: 'mine', sessionId: 's1', initiatorUserId: 'u1' });
    // A stop for some other instance's run — must not touch ours.
    bus.publish('chat:stop', JSON.stringify({ runId: 'someone-elses' }));
    expect(mine.signal.aborted).toBe(false);
  });

  // ── §5.1 case 17: idempotent finalization (stop↔done race) ──
  it('case 17: claimFinalize returns true exactly once per runId', () => {
    const runId = newRunId();
    expect(claimFinalize(runId)).toBe(true);
    expect(claimFinalize(runId)).toBe(false);
    expect(claimFinalize(runId)).toBe(false);
    // A different run is independent.
    expect(claimFinalize(newRunId())).toBe(true);
  });

  // ── §5.1 case 13: steering mechanics — a new turn aborts the prior run ──
  it('case 13: steering aborts all of a session\'s in-flight runs', async () => {
    const r1 = registerRun({ runId: newRunId(), sessionId: 's-steer', initiatorUserId: 'u1' });
    // Simulate the route's steering: on a new message, stop every active run
    // for the session before starting the fresh one.
    for (const run of getActiveRunsForSession('s-steer')) {
      await requestStop(run.runId);
    }
    expect(r1.signal.aborted).toBe(true);

    // The fresh run registers and is independent / not aborted.
    const r2 = registerRun({ runId: newRunId(), sessionId: 's-steer', initiatorUserId: 'u1' });
    expect(r2.signal.aborted).toBe(false);
  });

  it('double-stop is harmless (idempotent abort)', async () => {
    const runId = newRunId();
    const ctl = registerRun({ runId, sessionId: 's1', initiatorUserId: 'u1' });
    await requestStop(runId);
    await requestStop(runId);
    expect(ctl.signal.aborted).toBe(true);
  });
});
