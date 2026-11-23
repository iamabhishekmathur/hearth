import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma. assignTask reads the task (findFirst on task), resolves the
// target org user (findFirst on user), and writes assigneeId (update on task).
const taskFindFirst = vi.fn<(arg: unknown) => Promise<unknown>>();
const taskUpdate = vi.fn<(arg: unknown) => Promise<unknown>>(async () => ({}));
const userFindFirst = vi.fn<(arg: unknown) => Promise<unknown>>();

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    task: {
      findFirst: (arg: unknown) => taskFindFirst(arg),
      update: (arg: unknown) => taskUpdate(arg),
    },
    user: {
      findFirst: (arg: unknown) => userFindFirst(arg),
    },
  },
}));

// Mock the notification spine — the assign-to-existing-user path must notify.
vi.mock('./notification-service.js', () => ({
  notify: vi.fn(async () => undefined),
}));

// Onboarding step completion is only exercised on the invite path; stub it so
// the import graph resolves.
vi.mock('./onboarding-service.js', () => ({
  markStepComplete: vi.fn(async () => ({ completedSteps: [] })),
}));

// invitation-service is only called on the non-user invite path; stub it so the
// import graph resolves without touching a DB.
vi.mock('./invitation-service.js', () => ({
  createInvite: vi.fn(async () => ({ invite: { id: 'inv_1' }, acceptUrl: 'https://x/#/invite/t' })),
}));

import { assignTask } from './task-service.js';
import { notify } from './notification-service.js';

const notifyMock = notify as ReturnType<typeof vi.fn>;

const TASK = { id: 'task_1', orgId: 'org_1', userId: 'owner_1', title: 'Ship the invite flow' };

describe('task-service assignTask → existing org user notify path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskFindFirst.mockResolvedValue(TASK);
  });

  it('sets assigneeId and notifies the assignee with type "task_assigned"', async () => {
    userFindFirst.mockResolvedValue({ id: 'assignee_2', name: 'Priya', email: 'priya@acme.com' });

    const result = await assignTask(TASK.id, TASK.userId, { userId: 'assignee_2' });

    // assigneeId was written for the resolved user.
    expect(taskUpdate).toHaveBeenCalledTimes(1);
    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TASK.id },
        data: expect.objectContaining({ assigneeId: 'assignee_2' }),
      }),
    );

    // The assignee was notified (notify is fire-and-forget; flush microtasks).
    await Promise.resolve();
    await Promise.resolve();
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: TASK.orgId,
        userId: 'assignee_2',
        type: 'task_assigned',
        entityType: 'task',
        entityId: TASK.id,
      }),
    );

    expect(result).toMatchObject({ assignedUserId: 'assignee_2' });
  });

  it('resolves the assignee by email when no userId is given', async () => {
    userFindFirst.mockResolvedValue({ id: 'assignee_3', name: 'Sam', email: 'sam@acme.com' });

    const result = await assignTask(TASK.id, TASK.userId, { email: 'sam@acme.com' });

    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assigneeId: 'assignee_3' }) }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'assignee_3', type: 'task_assigned' }),
    );
    expect(result).toMatchObject({ assignedUserId: 'assignee_3' });
  });

  it('does NOT notify when a user assigns the task to themselves', async () => {
    userFindFirst.mockResolvedValue({ id: TASK.userId, name: 'Owner', email: 'owner@acme.com' });

    const result = await assignTask(TASK.id, TASK.userId, { userId: TASK.userId });

    expect(taskUpdate).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ assignedUserId: TASK.userId });
  });

  it('returns notFound when the caller does not own the task', async () => {
    taskFindFirst.mockResolvedValue(null);

    const result = await assignTask(TASK.id, 'someone_else', { userId: 'assignee_2' });

    expect(result).toEqual({ task: null, notFound: true });
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
