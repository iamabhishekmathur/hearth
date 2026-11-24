import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the processor fn handed to `new Worker(name, processor, opts)` so we
// can drive the digest job directly without a live Redis/BullMQ runtime.
let capturedProcessor: ((job: { data: { orgId?: string } }) => Promise<unknown>) | null = null;

vi.mock('bullmq', () => ({
  Queue: function () {
    return {
      add: vi.fn(),
      getRepeatableJobs: vi.fn().mockResolvedValue([]),
      removeRepeatableByKey: vi.fn(),
      close: vi.fn(),
    };
  },
  Worker: function (_name: string, processor: never) {
    capturedProcessor = processor;
    return { on: vi.fn(), close: vi.fn() };
  },
}));

vi.mock('../config.js', () => ({
  env: { REDIS_URL: 'redis://localhost:6379', WEB_URL: 'https://app.hearth.test' },
}));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('../services/daily-digest.js', () => ({ runDailyDigest: vi.fn(async () => [{}]) }));

import { runDailyDigest } from '../services/daily-digest.js';
import { getTenant } from '../lib/tenant-context.js';
import { createActivityDigestWorker } from './activity-digest-scheduler.js';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  capturedProcessor = null;
});

describe('activity digest worker', () => {
  it('runs the daily digest for every org (no orgId in the payload)', async () => {
    createActivityDigestWorker();
    expect(capturedProcessor).toBeTypeOf('function');
    const out = await capturedProcessor!({ data: {} });
    expect(asMock(runDailyDigest)).toHaveBeenCalledWith({ orgId: undefined });
    expect(out).toEqual({ processed: true, orgs: 1 });
  });

  it('passes a single orgId through', async () => {
    createActivityDigestWorker();
    await capturedProcessor!({ data: { orgId: 'org-1' } });
    expect(asMock(runDailyDigest)).toHaveBeenCalledWith({ orgId: 'org-1' });
  });

  it('runs inside the system (bypass) job context', async () => {
    let seen: unknown = null;
    asMock(runDailyDigest).mockImplementationOnce(async () => {
      seen = getTenant();
      return [];
    });
    createActivityDigestWorker();
    await capturedProcessor!({ data: {} });
    expect(seen).toEqual({ orgId: null, userId: null, bypass: true });
  });
});
