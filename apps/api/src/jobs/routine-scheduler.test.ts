import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('bullmq', () => {
  const add = vi.fn();
  const getRepeatableJobs = vi.fn().mockResolvedValue([]);
  const removeRepeatableByKey = vi.fn();

  return {
    Queue: function () {
      return {
        add,
        getRepeatableJobs,
        removeRepeatableByKey,
        close: vi.fn(),
      };
    },
    Worker: function () {
      return {
        on: vi.fn(),
        close: vi.fn(),
      };
    },
    _getMocks: () => ({ add, getRepeatableJobs, removeRepeatableByKey }),
  };
});

vi.mock('../config.js', () => ({
  env: { REDIS_URL: 'redis://localhost:6379' },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    routine: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../agent/context-builder.js', () => ({
  buildAgentContext: vi.fn(),
}));

vi.mock('../agent/agent-runtime.js', () => ({
  agentLoop: vi.fn(),
}));

vi.mock('../ws/socket-manager.js', () => ({
  emitToUser: vi.fn(),
}));

vi.mock('../services/routine-service.js', () => ({
  createRun: vi.fn(),
  completeRun: vi.fn(),
}));

vi.mock('../services/delivery-service.js', () => ({
  deliver: vi.fn(),
}));

import { routineQueue, syncRoutineSchedules, enqueueRoutineNow } from './routine-scheduler.js';
import * as bullmq from 'bullmq';

describe('routine-scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncRoutineSchedules clears existing repeatable jobs', async () => {
    await syncRoutineSchedules();
    expect(routineQueue.getRepeatableJobs).toHaveBeenCalled();
  });

  it('enqueueRoutineNow adds a job with correct data', async () => {
    await enqueueRoutineNow('r1', 'u1');
    expect(routineQueue.add).toHaveBeenCalledWith(
      'execute-routine',
      { routineId: 'r1', userId: 'u1' },
      expect.objectContaining({ jobId: expect.stringContaining('routine-now-r1-') }),
    );
  });
});
