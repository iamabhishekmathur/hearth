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

vi.mock('../services/routine-context-service.js', () => ({
  buildRoutineRunContext: vi.fn().mockResolvedValue({ state: {}, previousRuns: [], stateConfig: {} }),
}));

vi.mock('../services/delivery-rule-engine.js', () => ({
  evaluateDeliveryRules: vi.fn().mockReturnValue([]),
  applyTemplate: vi.fn((_: unknown, output: string) => output),
}));

vi.mock('../services/routine-parameter-service.js', () => ({
  resolveDefaults: vi.fn((_: unknown, vals: unknown) => vals),
  resolvePromptTemplate: vi.fn((prompt: string) => prompt),
  validateParameterValues: vi.fn().mockReturnValue({ valid: true }),
}));

vi.mock('../services/chain-service.js', () => ({
  getDownstreamChains: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/pipeline-service.js', () => ({
  createPipelineRun: vi.fn(),
  addRunToPipeline: vi.fn(),
  findPipelineByRunId: vi.fn(),
  completePipeline: vi.fn(),
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
      expect.objectContaining({ routineId: 'r1', userId: 'u1', triggeredBy: 'manual' }),
      expect.objectContaining({ jobId: expect.stringContaining('routine-now-r1-') }),
    );
  });
});
