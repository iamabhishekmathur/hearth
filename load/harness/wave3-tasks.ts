/**
 * WAVE 3 — Task lifecycle, end to end.
 *
 * Happy: create → kanban transitions → planning (planner + subtasks) →
 * executing (executor) → review → approve → done; plus the changes-requested
 * re-plan loop. Defects from the audit: planner creates subtasks as
 * `auto_detected` but the executor only runs `backlog` (orphaned subtasks);
 * concurrent transition conflict (409); transition/review validation; ownership.
 *
 * Worker must be running (planner/executor are BullMQ jobs). Agent-driven steps
 * are polled with generous timeouts.
 */
import { loginAs, prisma, sleep, Recorder, type HearthClient } from './core.js';

const F = 'Tasks';

async function pollTask(c: HearthClient, taskId: string, until: (status: string) => boolean, timeoutMs = 180_000): Promise<string> {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    const r = await c.req<{ data?: { status: string } }>('GET', `/tasks/${taskId}`);
    last = r.body.data?.status ?? '?';
    if (until(last)) return last;
    await sleep(3000);
  }
  return last;
}

async function main() {
  const rec = new Recorder('wave3-tasks');

  // ── Happy: manual create + kanban transitions ─────────────────────────────
  console.log('\n══ Create + kanban transitions ══');
  const u = await loginAs('dev1@hearth.local');
  const create = await u.req<{ data?: { id: string; status: string } }>('POST', '/tasks', { title: 'Add structured logging to checkout', source: 'manual', description: 'JSON logs + request ids' });
  const taskId = create.body.data?.id!;
  rec.record({ feature: F, subFeature: 'create', type: 'happy', name: 'Create a task (manual)',
    expected: `201, status auto_detected`, observed: `status ${create.status}, task ${create.body.data?.status}`, status: create.status === 201 ? 'pass' : 'fail' });

  // auto_detected → backlog → planning is the valid path; do backlog first
  const toBacklog = await u.req('PATCH', `/tasks/${taskId}`, { status: 'backlog' });
  rec.record({ feature: F, subFeature: 'kanban', type: 'happy', name: 'Transition auto_detected → backlog',
    expected: '200', observed: `status ${toBacklog.status}`, status: toBacklog.status === 200 ? 'pass' : 'fail' });

  // illegal transition: backlog → done (not allowed)
  const illegal = await u.req('PATCH', `/tasks/${taskId}`, { status: 'done' });
  rec.record({ feature: F, subFeature: 'transition validation', type: 'user_error', name: 'Illegal transition backlog → done',
    expected: '422 invalid transition', observed: `status ${illegal.status}`, status: illegal.status === 422 ? 'pass' : 'fail' });

  // ── Happy: planning → subtasks → executing → review (agent-driven) ─────────
  console.log('\n══ Planning → execution → review (worker) ══');
  await u.req('PATCH', `/tasks/${taskId}`, { status: 'planning' });
  const afterPlan = await pollTask(u, taskId, (s) => s === 'executing' || s === 'review' || s === 'backlog' || s === 'failed', 180_000);
  rec.record({ feature: F, subFeature: 'planning', type: 'happy', name: 'Planner runs and advances the task',
    expected: 'planner produces subtasks and auto-advances to executing', observed: `status after planning: ${afterPlan}`,
    status: afterPlan === 'executing' || afterPlan === 'review' ? 'pass' : afterPlan === 'backlog' ? 'partial' : 'fail',
    defects: afterPlan === 'backlog' ? ['Planning landed task in backlog (planner failed / returned no parseable subtasks)'] : undefined });

  // DEFECT CHECK: subtask statuses — planner creates them, executor only runs `backlog`
  await sleep(2000);
  const subtasks = await prisma.task.findMany({ where: { parentTaskId: taskId }, select: { status: true } });
  const statuses = subtasks.map((s) => s.status);
  const orphaned = statuses.filter((s) => s === 'auto_detected').length;
  rec.record({ feature: F, subFeature: 'decomposition', type: 'pressure', name: 'Subtask status vs executor filter',
    expected: 'subtasks created in a status the executor will run (backlog)', observed: `${subtasks.length} subtasks, statuses=[${statuses.join(',')}]`,
    status: subtasks.length === 0 ? 'partial' : orphaned > 0 ? 'fail' : 'pass',
    defects: orphaned > 0 ? [`${orphaned} subtask(s) created as 'auto_detected' — executor only runs 'backlog', so they may never execute (planner/executor status mismatch)`] : undefined });

  // Drive to review (executor advances executing→review)
  const atReview = await pollTask(u, taskId, (s) => s === 'review' || s === 'failed' || s === 'done', 180_000);
  rec.record({ feature: F, subFeature: 'execution', type: 'happy', name: 'Executor runs and advances to review',
    expected: 'task reaches review', observed: `status: ${atReview}`, status: atReview === 'review' ? 'pass' : atReview === 'done' ? 'pass' : 'partial' });

  // ── Happy: review approve → done ──────────────────────────────────────────
  console.log('\n══ Review ══');
  if (atReview === 'review') {
    const noFeedback = await u.req('POST', `/tasks/${taskId}/reviews`, { decision: 'changes_requested' });
    rec.record({ feature: F, subFeature: 'review validation', type: 'user_error', name: 'changes_requested without feedback',
      expected: '400', observed: `status ${noFeedback.status}`, status: noFeedback.status === 400 ? 'pass' : 'fail' });
    const approve = await u.req('POST', `/tasks/${taskId}/reviews`, { decision: 'approved' });
    const done = await pollTask(u, taskId, (s) => s === 'done', 20_000);
    rec.record({ feature: F, subFeature: 'review', type: 'happy', name: 'Approve review → done',
      expected: 'task → done', observed: `review status ${approve.status}, task ${done}`, status: done === 'done' ? 'pass' : 'fail' });
  } else {
    rec.record({ feature: F, subFeature: 'review', type: 'happy', name: 'Approve review → done',
      expected: 'task reaches review then done', observed: `task never reached review (was ${atReview})`, status: 'blocked' });
  }

  // ── Pressure: concurrent transition conflict ──────────────────────────────
  console.log('\n══ Concurrency ══');
  {
    const t = await u.req<{ data?: { id: string } }>('POST', '/tasks', { title: 'Race task', source: 'manual' });
    const id = t.body.data!.id;
    await u.req('PATCH', `/tasks/${id}`, { status: 'backlog' });
    await u.req('PATCH', `/tasks/${id}`, { status: 'planning' });
    // force to a known state then fire two competing transitions from 'planning'
    const [a, b] = await Promise.all([
      u.req('PATCH', `/tasks/${id}`, { status: 'backlog' }),
      u.req('PATCH', `/tasks/${id}`, { status: 'executing' }),
    ]);
    const codes = [a.status, b.status].sort();
    rec.record({ feature: F, subFeature: 'concurrency', type: 'pressure', name: 'Two competing transitions from the same status',
      expected: 'one 200, one 409 (compare-and-set)', observed: `statuses ${codes.join(' & ')}`,
      status: codes.includes(200) && codes.includes(409) ? 'pass' : (a.status === 200 && b.status === 200 ? 'fail' : 'partial'),
      defects: a.status === 200 && b.status === 200 ? ['Both concurrent transitions succeeded — compare-and-set did not prevent the race'] : undefined });
  }

  // ── Permission / validation ───────────────────────────────────────────────
  console.log('\n══ Validation & ownership ══');
  {
    const missing = await u.req('POST', '/tasks', { source: 'manual' }); // no title
    rec.record({ feature: F, subFeature: 'validation', type: 'user_error', name: 'Create task without a title',
      expected: '400', observed: `status ${missing.status}`, status: missing.status === 400 ? 'pass' : 'fail' });
    const other = await loginAs('pm1@hearth.local');
    const notMine = await other.req('PATCH', `/tasks/${taskId}`, { status: 'archived' });
    rec.record({ feature: F, subFeature: 'ownership', type: 'permission', name: "Patch another user's task",
      expected: '404 (not owner)', observed: `status ${notMine.status}`, status: notMine.status === 404 ? 'pass' : 'fail',
      defects: notMine.status === 200 ? ["A non-owner mutated another user's task"] : undefined });
  }

  rec.save();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error('wave3 failed:', e); await prisma.$disconnect(); process.exit(1); });
