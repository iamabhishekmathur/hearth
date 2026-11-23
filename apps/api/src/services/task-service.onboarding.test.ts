import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma so createTask doesn't touch a DB. task.create echoes back a row.
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    task: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'task_1',
        ...data,
        subTasks: [],
        comments: [],
      })),
    },
  },
}));

// Mock the onboarding service — we only assert the step-completion side effect.
vi.mock('./onboarding-service.js', () => ({
  markStepComplete: vi.fn(async () => ({ completedSteps: [] })),
}));

import { createTask } from './task-service.js';
import { markStepComplete } from './onboarding-service.js';

const markStep = markStepComplete as ReturnType<typeof vi.fn>;

const ORG = 'org_1';
const USER = 'user_1';

describe('task-service createTask → first_task onboarding auto-completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markStep.mockResolvedValue({ completedSteps: ['first_task'] });
  });

  it('marks the first_task step complete for the task owner', async () => {
    await createTask(ORG, USER, { title: 'Ship onboarding', source: 'manual' });

    // Best-effort completion is fire-and-forget; let the microtask flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(markStep).toHaveBeenCalledTimes(1);
    expect(markStep).toHaveBeenCalledWith(USER, 'first_task');
  });

  it('returns the created task even when the onboarding write rejects (non-blocking)', async () => {
    markStep.mockRejectedValueOnce(new Error('onboarding store down'));

    const task = await createTask(ORG, USER, { title: 'Resilient create', source: 'manual' });

    // The task creation must succeed regardless of the onboarding side effect.
    expect(task).toMatchObject({ id: 'task_1', title: 'Resilient create', userId: USER });

    // Flush the rejected best-effort promise so the unhandled-rejection guard
    // in task-service has a chance to run; the test must not throw.
    await Promise.resolve();
    await Promise.resolve();

    expect(markStep).toHaveBeenCalledWith(USER, 'first_task');
  });
});
