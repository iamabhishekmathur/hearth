import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Component-level coverage for the W2 stop/steer protocol wiring on the client
 * (J1). We mock the socket so we can assert the exact events emitted/subscribed
 * without a live connection, plus the pure gating truth tables the UI uses for
 * the Stop button and (interruptible) live input.
 */

// A fake socket that records emits and dispatches registered handlers.
const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
const emitted: Array<{ event: string; payload: unknown }> = [];
const fakeSocket = {
  connected: true,
  emit: (event: string, payload: unknown) => { emitted.push({ event, payload }); },
  on: (event: string, cb: (...args: unknown[]) => void) => {
    const list = handlers.get(event) ?? [];
    list.push(cb);
    handlers.set(event, list);
  },
  off: (event: string, cb: (...args: unknown[]) => void) => {
    const list = handlers.get(event) ?? [];
    handlers.set(event, list.filter((h) => h !== cb));
  },
  connect: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: () => fakeSocket,
  Socket: class {},
}));

import { emitStopRun, onRunStarted } from '../socket-client';

beforeEach(() => {
  handlers.clear();
  emitted.length = 0;
});

describe('W2 stop/steer protocol wiring', () => {
  it('emitStopRun emits chat:stop with sessionId + runId', () => {
    emitStopRun('sess-1', 'run-7');
    expect(emitted).toEqual([{ event: 'chat:stop', payload: { sessionId: 'sess-1', runId: 'run-7' } }]);
  });

  it('emitStopRun works without a runId (stops all session runs)', () => {
    emitStopRun('sess-1');
    expect(emitted).toEqual([{ event: 'chat:stop', payload: { sessionId: 'sess-1', runId: undefined } }]);
  });

  it('onRunStarted subscribes to chat:run_started and delivers the runId', () => {
    const seen: Array<{ sessionId: string; runId: string }> = [];
    const unsub = onRunStarted((p) => seen.push(p));
    // Simulate the server broadcasting the run id for the turn.
    for (const h of handlers.get('chat:run_started') ?? []) h({ sessionId: 'sess-1', runId: 'run-9' });
    expect(seen).toEqual([{ sessionId: 'sess-1', runId: 'run-9' }]);
    unsub();
    expect(handlers.get('chat:run_started')?.length ?? 0).toBe(0);
  });

  // ── J1 error branch: double-stop is harmless on the client ──
  it('double-stop emits twice (server dedupes via idempotent finalize)', () => {
    emitStopRun('s', 'r');
    emitStopRun('s', 'r');
    expect(emitted.filter((e) => e.event === 'chat:stop')).toHaveLength(2);
  });
});

// The exact gating logic ChatInput derives from (disabled, isStreaming,
// interruptible). Kept in lockstep with chat-input.tsx.
function gate(opts: { disabled?: boolean; isStreaming?: boolean; interruptible?: boolean }) {
  const inputDisabled = opts.interruptible ? !!opts.disabled : (!!opts.disabled || !!opts.isStreaming);
  const showStop = !!opts.interruptible && !!opts.isStreaming;
  return { inputDisabled, showStop };
}

describe('W2 ChatInput gating truth table (J1)', () => {
  it('interruptible ON: input stays live while streaming; Stop shown', () => {
    expect(gate({ isStreaming: true, interruptible: true })).toEqual({ inputDisabled: false, showStop: true });
  });

  it('interruptible ON, idle: input live, no Stop', () => {
    expect(gate({ isStreaming: false, interruptible: true })).toEqual({ inputDisabled: false, showStop: false });
  });

  it('interruptible OFF (legacy): streaming disables input, no Stop', () => {
    expect(gate({ isStreaming: true, interruptible: false })).toEqual({ inputDisabled: true, showStop: false });
  });

  it('interruptible OFF, idle: input live, no Stop', () => {
    expect(gate({ isStreaming: false, interruptible: false })).toEqual({ inputDisabled: false, showStop: false });
  });
});

// The metadata-stamping logic use-chat applies on done{stopReason}. Kept in
// lockstep with use-chat.ts.
function stampDone(stopReason: string | undefined, prev: Record<string, unknown> = {}) {
  return stopReason && stopReason !== 'done'
    ? { ...prev, stopReason, interrupted: stopReason === 'interrupted' || undefined }
    : prev;
}

describe('W2 interrupted-partial stamping (J1)', () => {
  it('interrupted → marks interrupted + stopReason', () => {
    expect(stampDone('interrupted')).toEqual({ stopReason: 'interrupted', interrupted: true });
  });
  it('budget → stopReason only', () => {
    expect(stampDone('budget')).toEqual({ stopReason: 'budget', interrupted: undefined });
  });
  it('done → no stop metadata added', () => {
    expect(stampDone('done', { foo: 1 })).toEqual({ foo: 1 });
  });
});
