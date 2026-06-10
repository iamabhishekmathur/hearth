/**
 * Tasks integration tests — create, GET, PATCH status transitions, and
 * ownership scoping. Pins several known defects (see DEFECT comments).
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
  it('DEFECT (TASK-Z-02): comments route has NO ownership check — peer comments on another user’s task', async () => {
    const adminTask = await seedTask(fx.primary.orgId, fx.users.admin.id);
    const member = await loginAgent('member');

    // The route looks the task up by id only (addComment never verifies the
    // caller owns / can access the task), so a non-owner comment succeeds.
    const res = await member.post(`/api/v1/tasks/${adminTask.id}/comments`, { content: 'I can comment on your task' });
    // DEFECT (TASK-Z-02): pins current behavior — cross-user comment is accepted.
    expect(res.status).toBe(201);
    const comment = await prisma.taskComment.findFirst({ where: { taskId: adminTask.id } });
    expect(comment?.userId).toBe(fx.users.member.id);
  });

  it('DEFECT (TASK-Z-03): subtasks route has NO ownership check — peer subtasks another user’s task', async () => {
    const adminTask = await seedTask(fx.primary.orgId, fx.users.admin.id);
    const member = await loginAgent('member');

    // createSubtask resolves the parent by id only — no caller ownership gate.
    const res = await member.post(`/api/v1/tasks/${adminTask.id}/subtasks`, { title: 'sneaky subtask' });
    // DEFECT (TASK-Z-03): pins current behavior — cross-user subtask is accepted,
    // and the subtask is even attributed to the (non-owner) caller.
    expect(res.status).toBe(201);
    const sub = await prisma.task.findFirst({ where: { parentTaskId: adminTask.id } });
    expect(sub).toBeTruthy();
    expect(sub?.userId).toBe(fx.users.member.id);
  });

  it('cross-org peer ALSO comments on a foreign-org task (no tenant scope on comments)', async () => {
    const primaryTask = await seedTask(fx.primary.orgId, fx.users.admin.id);
    const rival = await loginAgent('rival');
    // DEFECT (TASK-Z-02): pins current behavior — even a different *org* can comment.
    const res = await rival.post(`/api/v1/tasks/${primaryTask.id}/comments`, { content: 'cross-org comment' });
    expect(res.status).toBe(201);
  });
});
