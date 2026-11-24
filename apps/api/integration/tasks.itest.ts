/**
 * Tasks integration tests — create, GET, PATCH status transitions, and
 * ownership scoping. Pins remaining known defects (see DEFECT comments).
 *
 * Routes under test (mounted at /api/v1/tasks, see src/routes/tasks.ts):
 *   POST   /tasks
 *   GET    /tasks/:id
 *   PATCH  /tasks/:id            (status transitions validated against
 *                                 VALID_STATUS_TRANSITIONS)
 *   POST   /tasks/:id/comments
 *   POST   /tasks/:id/subtasks
 *   POST   /tasks/:id/reviews
 *
 * Tasks created via the API always start in `auto_detected` (task-service
 * createTask default). To exercise later states we either PATCH through the
 * legal transition chain or seed the row directly with the plain prisma client.
 */
import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import {
  prisma,
  seedAuthFixture,
  loginAgent,
  truncateAll,
  disconnect,
  type AuthFixture,
} from './setup.js';

let fx: AuthFixture;

beforeEach(async () => {
  await truncateAll();
  fx = await seedAuthFixture();
});

afterAll(async () => {
  await disconnect();
});

/** Create a task for `userId` directly with a chosen status (bypasses the
 *  auto_detected default so we can land on review/done etc. without firing
 *  the planning/execution queues). */
async function seedTask(
  orgId: string,
  userId: string,
  status:
    | 'auto_detected'
    | 'backlog'
    | 'planning'
    | 'executing'
    | 'review'
    | 'done'
    | 'failed'
    | 'archived' = 'auto_detected',
) {
  return prisma.task.create({
    data: {
      orgId,
      userId,
      title: 'Seeded task',
      source: 'manual',
      status: status as never,
      context: {},
    },
  });
}

describe('tasks — create & read', () => {
  it('creates a task (201) defaulting to auto_detected, owned by caller', async () => {
    const member = await loginAgent('member');
    const res = await member.post('/api/v1/tasks', { title: 'Write tests', source: 'manual' });
    expect(res.status).toBe(201);
    const id = res.body.data.id;
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row?.userId).toBe(fx.users.member.id);
    expect(row?.status).toBe('auto_detected');
  });

  it('rejects create with missing title/source (400) and bad source (400)', async () => {
    const member = await loginAgent('member');
    expect((await member.post('/api/v1/tasks', { source: 'manual' })).status).toBe(400);
    expect((await member.post('/api/v1/tasks', { title: 'x', source: 'bogus' })).status).toBe(400);
  });

  it('owner GETs its own task (200)', async () => {
    const member = await loginAgent('member');
    const t = await seedTask(fx.primary.orgId, fx.users.member.id);
    const res = await member.get(`/api/v1/tasks/${t.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(t.id);
  });

  it('DEFECT (KANBAN-Z-03): tasks are owner-private — user B GETs user A’s task → 404', async () => {
    const adminTask = await seedTask(fx.primary.orgId, fx.users.admin.id);
    const member = await loginAgent('member');
    // DEFECT (KANBAN-Z-03): pins current behavior — getTask scopes by userId,
    // so a same-org peer cannot read another user's task at all (404, not 403).
    const res = await member.get(`/api/v1/tasks/${adminTask.id}`);
    expect(res.status).toBe(404);
  });
});

describe('tasks — status transitions (VALID_STATUS_TRANSITIONS)', () => {
  it('auto_detected → backlog is allowed (200)', async () => {
    const member = await loginAgent('member');
    const t = await seedTask(fx.primary.orgId, fx.users.member.id, 'auto_detected');
    const res = await member.patch(`/api/v1/tasks/${t.id}`, { status: 'backlog' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('backlog');
  });

  it('backlog → planning is allowed (200)', async () => {
    const member = await loginAgent('member');
    const t = await seedTask(fx.primary.orgId, fx.users.member.id, 'backlog');
    const res = await member.patch(`/api/v1/tasks/${t.id}`, { status: 'planning' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('planning');
  });

  it('auto_detected → done is an illegal transition (422)', async () => {
    const member = await loginAgent('member');
    const t = await seedTask(fx.primary.orgId, fx.users.member.id, 'auto_detected');
    const res = await member.patch(`/api/v1/tasks/${t.id}`, { status: 'done' });
    expect(res.status).toBe(422);
  });

  it('done → planning is illegal (422); done → archived is legal (200)', async () => {
    const member = await loginAgent('member');
    const done = await seedTask(fx.primary.orgId, fx.users.member.id, 'done');
    expect((await member.patch(`/api/v1/tasks/${done.id}`, { status: 'planning' })).status).toBe(422);

    const done2 = await seedTask(fx.primary.orgId, fx.users.member.id, 'done');
    expect((await member.patch(`/api/v1/tasks/${done2.id}`, { status: 'archived' })).status).toBe(200);
  });
});

describe('tasks — review gate', () => {
  it('DEFECT (REVIEW-X-02): direct PATCH review→done completes with NO review record', async () => {
    const member = await loginAgent('member');
    const t = await seedTask(fx.primary.orgId, fx.users.member.id, 'review');

    // review → done is a legal transition in VALID_STATUS_TRANSITIONS, so the
    // human-in-the-loop review gate is bypassed entirely by hitting PATCH.
    const res = await member.patch(`/api/v1/tasks/${t.id}`, { status: 'done' });
    // DEFECT (REVIEW-X-02): pins current behavior — task moves straight to done...
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('done');

    // ...and no TaskReview row was ever created (the /reviews endpoint that
    // records a review decision was never invoked).
    const reviews = await prisma.taskReview.count({ where: { taskId: t.id } });
    expect(reviews).toBe(0);
  });

  it('POST /reviews approve from review → done creates a review row (200/201)', async () => {
    const member = await loginAgent('member');
    const t = await seedTask(fx.primary.orgId, fx.users.member.id, 'review');
    const res = await member.post(`/api/v1/tasks/${t.id}/reviews`, { decision: 'approved' });
    expect(res.status).toBe(201);
    const reviews = await prisma.taskReview.count({ where: { taskId: t.id } });
    expect(reviews).toBe(1);
    const row = await prisma.task.findUnique({ where: { id: t.id } });
    expect(row?.status).toBe('done');
  });

  it('POST /reviews on a non-review task is rejected (422)', async () => {
    const member = await loginAgent('member');
    const t = await seedTask(fx.primary.orgId, fx.users.member.id, 'backlog');
    const res = await member.post(`/api/v1/tasks/${t.id}/reviews`, { decision: 'approved' });
    expect(res.status).toBe(422);
  });
});

describe('tasks — sub-resource ownership scoping', () => {
  // Fixed TASK-Z-02 / TASK-Z-03: every task sub-route now requires the caller
  // to own the task (or be its assignee in the same org). Anyone else gets 404,
  // so a foreign task id reveals nothing.

  it('TASK-Z-02 (fixed): a peer cannot comment on another user’s task → 404, nothing written', async () => {
    const adminTask = await seedTask(fx.primary.orgId, fx.users.admin.id);
    const member = await loginAgent('member');

    const res = await member.post(`/api/v1/tasks/${adminTask.id}/comments`, { content: 'I can comment on your task' });
    expect(res.status).toBe(404);
    expect(await prisma.taskComment.count({ where: { taskId: adminTask.id } })).toBe(0);
  });

  it('TASK-Z-02 (fixed): another org cannot comment on, or read comments of, a task → 404', async () => {
    const primaryTask = await seedTask(fx.primary.orgId, fx.users.admin.id);
    const rival = await loginAgent('rival');
    expect((await rival.post(`/api/v1/tasks/${primaryTask.id}/comments`, { content: 'cross-org comment' })).status).toBe(404);
    expect((await rival.get(`/api/v1/tasks/${primaryTask.id}/comments`)).status).toBe(404);
    expect(await prisma.taskComment.count({ where: { taskId: primaryTask.id } })).toBe(0);
  });

  it('TASK-Z-03 (fixed): a peer cannot add a subtask to another user’s task → 404, nothing written', async () => {
    const adminTask = await seedTask(fx.primary.orgId, fx.users.admin.id);
    const member = await loginAgent('member');

    const res = await member.post(`/api/v1/tasks/${adminTask.id}/subtasks`, { title: 'sneaky subtask' });
    expect(res.status).toBe(404);
    expect(await prisma.task.count({ where: { parentTaskId: adminTask.id } })).toBe(0);
  });

  it('the owner can still comment and add subtasks; a subtask belongs to the parent’s owner', async () => {
    const t = await seedTask(fx.primary.orgId, fx.users.member.id);
    const member = await loginAgent('member');

    expect((await member.post(`/api/v1/tasks/${t.id}/comments`, { content: 'note to self' })).status).toBe(201);
    expect((await member.get(`/api/v1/tasks/${t.id}/comments`)).body.data).toHaveLength(1);

    expect((await member.post(`/api/v1/tasks/${t.id}/subtasks`, { title: 'step 1' })).status).toBe(201);
    const sub = await prisma.task.findFirst({ where: { parentTaskId: t.id } });
    expect(sub?.userId).toBe(fx.users.member.id);
  });

  it('the assignee (same org) can comment; the subtask they add belongs to the owner', async () => {
    const t = await seedTask(fx.primary.orgId, fx.users.admin.id);
    await prisma.task.update({ where: { id: t.id }, data: { assigneeId: fx.users.member.id } });
    const member = await loginAgent('member');

    expect((await member.post(`/api/v1/tasks/${t.id}/comments`, { content: 'on it' })).status).toBe(201);
    expect((await member.post(`/api/v1/tasks/${t.id}/subtasks`, { title: 'part A' })).status).toBe(201);
    const sub = await prisma.task.findFirst({ where: { parentTaskId: t.id } });
    expect(sub?.userId).toBe(fx.users.admin.id);
  });

  it('every other sub-route answers 404 to a non-owner', async () => {
    const t = await seedTask(fx.primary.orgId, fx.users.admin.id);
    const item = await prisma.taskContextItem.create({
      data: { orgId: fx.primary.orgId, taskId: t.id, type: 'note', rawValue: 'secret', createdBy: fx.users.admin.id },
    });
    const member = await loginAgent('member');
    const rival = await loginAgent('rival');

    for (const agent of [member, rival]) {
      expect((await agent.get(`/api/v1/tasks/${t.id}/steps`)).status).toBe(404);
      expect((await agent.get(`/api/v1/tasks/${t.id}/reviews`)).status).toBe(404);
      expect((await agent.get(`/api/v1/tasks/${t.id}/context-items`)).status).toBe(404);
      expect((await agent.patch(`/api/v1/tasks/${t.id}/context-items/${item.id}`, { label: 'x' })).status).toBe(404);
      expect((await agent.post(`/api/v1/tasks/${t.id}/context-items/${item.id}/refresh`)).status).toBe(404);
      expect((await agent.post(`/api/v1/tasks/${t.id}/context-items/${item.id}/analyze`)).status).toBe(404);
      expect((await agent.del(`/api/v1/tasks/${t.id}/context-items/${item.id}`)).status).toBe(404);
    }
    const after = await prisma.taskContextItem.findUnique({ where: { id: item.id } });
    expect(after).toMatchObject({ rawValue: 'secret' });
    expect(after?.label ?? null).not.toBe('x');
  });

  it('an unknown task id → 404 on sub-routes', async () => {
    const member = await loginAgent('member');
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await member.get(`/api/v1/tasks/${missing}/comments`)).status).toBe(404);
    expect((await member.post(`/api/v1/tasks/${missing}/subtasks`, { title: 'x' })).status).toBe(404);
  });
});
