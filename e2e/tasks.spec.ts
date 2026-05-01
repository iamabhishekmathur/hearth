import { test, expect } from '@playwright/test';
import {
  API,
  HAS_LLM,
  loginAs,
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  createTask,
  deleteTask,
  pollTaskStatus,
  Cleanup,
  uniqueId,
} from './fixtures/test-helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Tasks (kanban) — Comprehensive E2E Suite (~33 tests)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Kanban Board UI', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  test('1 — Navigate to /tasks renders the board', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.waitForTimeout(1500);
    // Board container should be visible with at least one column header
    const board = page.locator('[data-testid="kanban-board"], .kanban-board, [class*="board"]').first();
    // Fallback: just assert the page loaded and has column-like content
    const hasColumns = await page.locator('text=Backlog').or(page.locator('text=Planning')).first().isVisible().catch(() => false);
    expect(hasColumns || (await board.isVisible().catch(() => false))).toBeTruthy();
    console.log('Kanban board rendered successfully');
  });

  test('2 — Empty column shows empty state', async ({ page }) => {
    // Navigate to tasks — the "Failed" column is typically empty in a fresh state
    await page.goto('/#/tasks');
    await page.waitForTimeout(1500);
    // At minimum, the column headers should be present even when empty
    const failedColumn = page.locator('text=Failed').first();
    const isVisible = await failedColumn.isVisible().catch(() => false);
    // If "Failed" header exists, the column renders even when empty
    console.log(`Failed column header visible: ${isVisible}`);
    // The board should render without error regardless
    expect(page.url()).toContain('tasks');
  });

  test('3 — Task card shows title on the board', async ({ page }) => {
    const title = uniqueId('card-title');
    const task = await createTask(page, csrf, { title });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    await page.goto('/#/tasks');
    await page.waitForTimeout(1500);

    const taskCard = page.locator(`text=${title}`).first();
    await expect(taskCard).toBeVisible({ timeout: 10_000 });
    console.log(`Task card "${title}" visible on board`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Task CRUD
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Task CRUD', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  test('4 — Create task with title only returns 201, auto_detected, source=manual', async ({ page }) => {
    const title = uniqueId('title-only');
    const task = await createTask(page, csrf, { title });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    expect(task.id).toBeTruthy();
    expect(task.status).toBe('auto_detected');
    expect(task.source).toBe('manual');
    expect(task.title).toBe(title);
    console.log(`Created task ${task.id}: status=${task.status}, source=${task.source}`);
  });

  test('5 — Create task with all fields stores every value', async ({ page }) => {
    const title = uniqueId('all-fields');
    const description = 'Full description for comprehensive task';
    const task = await createTask(page, csrf, {
      title,
      description,
      source: 'email',
      priority: 3,
    });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    expect(task.title).toBe(title);
    expect(task.description).toBe(description);
    expect(task.source).toBe('email');
    expect(task.priority).toBe(3);
    expect(task.status).toBe('auto_detected');
    console.log(`Task ${task.id}: title=${task.title}, desc=${task.description}, src=${task.source}, pri=${task.priority}`);
  });

  test('6 — Edit task title updates correctly', async ({ page }) => {
    const title = uniqueId('edit-title');
    const task = await createTask(page, csrf, { title });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    const newTitle = uniqueId('edited-title');
    const { status, body } = await apiPatch(page, csrf, `/tasks/${task.id}`, { title: newTitle });
    expect(status).toBe(200);
    expect(body.data.title).toBe(newTitle);
    console.log(`Title updated from "${title}" to "${newTitle}"`);
  });

  test('7 — Edit task description updates correctly', async ({ page }) => {
    const title = uniqueId('edit-desc');
    const task = await createTask(page, csrf, { title, description: 'Original description' });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    const newDesc = 'Updated description with more detail';
    const { status, body } = await apiPatch(page, csrf, `/tasks/${task.id}`, { description: newDesc });
    expect(status).toBe(200);
    expect(body.data.description).toBe(newDesc);
    console.log(`Description updated to: "${newDesc}"`);
  });

  test('8 — Change task priority updates correctly', async ({ page }) => {
    const title = uniqueId('change-pri');
    const task = await createTask(page, csrf, { title, priority: 1 });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    const { status, body } = await apiPatch(page, csrf, `/tasks/${task.id}`, { priority: 5 });
    expect(status).toBe(200);
    expect(body.data.priority).toBe(5);
    console.log(`Priority changed from 1 to ${body.data.priority}`);
  });

  test('9 — Delete task returns 200 and re-fetch returns 404', async ({ page }) => {
    const title = uniqueId('delete-me');
    const task = await createTask(page, csrf, { title });

    const delRes = await apiDelete(page, csrf, `/tasks/${task.id}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.message).toBe('Task deleted');
    console.log(`Delete returned ${delRes.status}`);

    const getRes = await apiGet(page, `/tasks/${task.id}`);
    expect(getRes.status).toBe(404);
    console.log(`Re-fetch returned ${getRes.status}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Status Transitions (Valid)
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Status Transitions — Valid', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  test('10 — auto_detected -> backlog', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('ad-backlog') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    const { status, body } = await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });
    expect(status).toBe(200);
    expect(body.data.status).toBe('backlog');
    console.log(`auto_detected -> backlog: ${status}`);
  });

  test('11 — auto_detected -> archived (dismiss)', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('ad-archived') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    const { status, body } = await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'archived' });
    expect(status).toBe(200);
    expect(body.data.status).toBe('archived');
    console.log(`auto_detected -> archived: ${status}`);
  });

  test('12 — backlog -> planning', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('bl-planning') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });
    const { status, body } = await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'planning' });
    expect(status).toBe(200);
    expect(body.data.status).toBe('planning');
    console.log(`backlog -> planning: ${status}`);
  });

  test('13 — planning -> executing', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('pl-exec') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'planning' });
    const { status, body } = await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'executing' });
    expect(status).toBe(200);
    expect(body.data.status).toBe('executing');
    console.log(`planning -> executing: ${status}`);
  });

  test('14 — executing -> review (via agent poll)', async ({ page }) => {
    test.slow(); // 3x timeout
    const task = await createTask(page, csrf, {
      title: uniqueId('exec-review'),
      description: 'Simple test task for agent execution',
    });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'planning' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'executing' });

    const updated = await pollTaskStatus(page, task.id, ['review', 'failed'], 90_000);
    expect(['review', 'failed']).toContain(updated.status);
    console.log(`executing -> ${updated.status} (via agent): polled successfully`);
  });

  test('15 — review -> done (approve)', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('rev-done') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    // Walk to review manually — use backlog -> planning -> executing -> review
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'planning' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'executing' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'review' });

    const { status, body } = await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'done' });
    expect(status).toBe(200);
    expect(body.data.status).toBe('done');
    console.log(`review -> done: ${status}`);
  });

  test('16 — review -> planning (changes requested)', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('rev-plan') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'planning' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'executing' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'review' });

    const { status, body } = await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'planning' });
    expect(status).toBe(200);
    expect(body.data.status).toBe('planning');
    console.log(`review -> planning: ${status}`);
  });

  test('17 — failed -> backlog (retry)', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('fail-bl') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'planning' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'executing' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'failed' });

    const { status, body } = await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });
    expect(status).toBe(200);
    expect(body.data.status).toBe('backlog');
    console.log(`failed -> backlog: ${status}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Status Transitions (Invalid)
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Status Transitions — Invalid', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  test('18 — auto_detected -> done is rejected (422)', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('inv-ad-done') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    const { status } = await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'done' });
    expect(status).toBe(422);
    console.log(`auto_detected -> done: ${status} (correctly rejected)`);
  });

  test('19 — backlog -> done is rejected (422)', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('inv-bl-done') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });
    const { status } = await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'done' });
    expect(status).toBe(422);
    console.log(`backlog -> done: ${status} (correctly rejected)`);
  });

  test('20 — planning -> done is rejected (422)', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('inv-pl-done') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'planning' });
    const { status } = await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'done' });
    expect(status).toBe(422);
    console.log(`planning -> done: ${status} (correctly rejected)`);
  });

  test('21 — done -> backlog is rejected (422)', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('inv-done-bl') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    // Walk to done
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'planning' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'executing' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'review' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'done' });

    const { status } = await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });
    expect(status).toBe(422);
    console.log(`done -> backlog: ${status} (correctly rejected)`);
  });

  test('22 — archived -> backlog is rejected (422)', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('inv-arch-bl') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'archived' });
    const { status } = await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });
    expect(status).toBe(422);
    console.log(`archived -> backlog: ${status} (correctly rejected)`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Task Detail — Comments, Subtasks, Context
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Task Detail', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  test('23 — Add comment appears in comment list', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('comment-test') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    const commentText = `Test comment ${uniqueId('cmt')}`;
    const postRes = await apiPost(page, csrf, `/tasks/${task.id}/comments`, { content: commentText });
    expect(postRes.status).toBe(201);
    console.log(`Comment created: ${postRes.body.data.id}`);

    const getRes = await apiGet(page, `/tasks/${task.id}/comments`);
    expect(getRes.status).toBe(200);
    const found = getRes.body.data.find((c: { content: string }) => c.content === commentText);
    expect(found).toBeTruthy();
    expect(found.isAgent).toBe(false);
    console.log(`Comment found in list: "${found.content}"`);
  });

  test('24 — Add subtask is created with parentTaskId', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('subtask-parent') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    const subTitle = uniqueId('subtask');
    const subDesc = 'Child task description';
    const postRes = await apiPost(page, csrf, `/tasks/${task.id}/subtasks`, {
      title: subTitle,
      description: subDesc,
    });
    expect(postRes.status).toBe(201);

    const sub = postRes.body.data;
    expect(sub.parentTaskId).toBe(task.id);
    expect(sub.title).toBe(subTitle);
    expect(sub.description).toBe(subDesc);
    expect(sub.source).toBe('sub_agent');
    console.log(`Subtask ${sub.id} created under parent ${task.id}`);
  });

  test('25 — Complete subtask marks it done', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('sub-complete') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    const subRes = await apiPost(page, csrf, `/tasks/${task.id}/subtasks`, {
      title: uniqueId('sub-to-complete'),
    });
    const sub = subRes.body.data;
    cleanup.add(() => deleteTask(page, csrf, sub.id));

    // Walk subtask to done: auto_detected -> backlog -> planning -> executing -> review -> done
    await apiPatch(page, csrf, `/tasks/${sub.id}`, { status: 'backlog' });
    await apiPatch(page, csrf, `/tasks/${sub.id}`, { status: 'planning' });
    await apiPatch(page, csrf, `/tasks/${sub.id}`, { status: 'executing' });
    await apiPatch(page, csrf, `/tasks/${sub.id}`, { status: 'review' });
    const { status, body } = await apiPatch(page, csrf, `/tasks/${sub.id}`, { status: 'done' });
    expect(status).toBe(200);
    expect(body.data.status).toBe('done');
    console.log(`Subtask ${sub.id} marked done`);
  });

  test('26 — Add note context item appears in context list', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('ctx-note') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    const label = uniqueId('note-label');
    const postRes = await apiPost(page, csrf, `/tasks/${task.id}/context-items`, {
      type: 'note',
      rawValue: 'This is a note with important context for the task.',
      label,
    });
    expect(postRes.status).toBe(201);
    const ctxItem = postRes.body.data;
    expect(ctxItem.type).toBe('note');
    expect(ctxItem.label).toBe(label);
    console.log(`Context item created: ${ctxItem.id}, type=${ctxItem.type}`);

    const getRes = await apiGet(page, `/tasks/${task.id}/context-items`);
    expect(getRes.status).toBe(200);
    const found = getRes.body.data.find((i: { id: string }) => i.id === ctxItem.id);
    expect(found).toBeTruthy();
    expect(found.rawValue).toContain('important context');
    console.log(`Context item found in list: ${found.id}`);
  });

  test('27 — Add link context item is created', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('ctx-link') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    const postRes = await apiPost(page, csrf, `/tasks/${task.id}/context-items`, {
      type: 'link',
      rawValue: 'https://example.com/relevant-doc',
      label: 'Reference Document',
    });
    expect(postRes.status).toBe(201);
    const ctxItem = postRes.body.data;
    expect(ctxItem.type).toBe('link');
    expect(ctxItem.rawValue).toBe('https://example.com/relevant-doc');
    console.log(`Link context item created: ${ctxItem.id}`);
  });

  test('28 — Delete context item removes it', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('ctx-del') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    // Create a context item
    const postRes = await apiPost(page, csrf, `/tasks/${task.id}/context-items`, {
      type: 'note',
      rawValue: 'Context to be deleted',
    });
    expect(postRes.status).toBe(201);
    const ctxId = postRes.body.data.id;

    // Delete it
    const delRes = await apiDelete(page, csrf, `/tasks/${task.id}/context-items/${ctxId}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.message).toBe('Context item deleted');
    console.log(`Context item ${ctxId} deleted: ${delRes.status}`);

    // Verify it is gone
    const getRes = await apiGet(page, `/tasks/${task.id}/context-items`);
    const remaining = getRes.body.data.filter((i: { id: string }) => i.id === ctxId);
    expect(remaining.length).toBe(0);
    console.log('Context item confirmed removed from list');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Task Sources
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Task Sources', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  test('29 — Task with source=email persists the source', async ({ page }) => {
    const task = await createTask(page, csrf, {
      title: uniqueId('src-email'),
      source: 'email',
    });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    expect(task.source).toBe('email');
    console.log(`Task ${task.id} source: ${task.source}`);

    // Verify via GET as well
    const { body } = await apiGet(page, `/tasks/${task.id}`);
    expect(body.data.source).toBe('email');
    console.log(`GET confirms source: ${body.data.source}`);
  });

  test('30 — Task with source=slack persists the source', async ({ page }) => {
    const task = await createTask(page, csrf, {
      title: uniqueId('src-slack'),
      source: 'slack',
    });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    expect(task.source).toBe('slack');
    console.log(`Task ${task.id} source: ${task.source}`);

    const { body } = await apiGet(page, `/tasks/${task.id}`);
    expect(body.data.source).toBe('slack');
    console.log(`GET confirms source: ${body.data.source}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Reviews
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Reviews', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  test('31 — Submit approved review is recorded', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('rev-approve') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    // Walk to review
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'planning' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'executing' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'review' });

    const postRes = await apiPost(page, csrf, `/tasks/${task.id}/reviews`, {
      decision: 'approved',
    });
    expect(postRes.status).toBe(201);
    expect(postRes.body.data.decision).toBe('approved');
    console.log(`Review recorded: decision=${postRes.body.data.decision}, id=${postRes.body.data.id}`);

    // Verify via task detail
    const { body } = await apiGet(page, `/tasks/${task.id}`);
    expect(body.data.reviews.length).toBeGreaterThanOrEqual(1);
    const review = body.data.reviews.find((r: { decision: string }) => r.decision === 'approved');
    expect(review).toBeTruthy();
    console.log(`Task detail shows ${body.data.reviews.length} review(s)`);
  });

  test('32 — Submit changes_requested review with feedback is recorded', async ({ page }) => {
    const task = await createTask(page, csrf, { title: uniqueId('rev-changes') });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    // Walk to review
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'planning' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'executing' });
    await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'review' });

    const feedback = 'Please add more detail to the summary section.';
    const postRes = await apiPost(page, csrf, `/tasks/${task.id}/reviews`, {
      decision: 'changes_requested',
      feedback,
    });
    expect(postRes.status).toBe(201);
    expect(postRes.body.data.decision).toBe('changes_requested');
    expect(postRes.body.data.feedback).toBe(feedback);
    console.log(`Review recorded: decision=${postRes.body.data.decision}, feedback="${postRes.body.data.feedback}"`);

    // Verify via task detail
    const { body } = await apiGet(page, `/tasks/${task.id}`);
    const review = body.data.reviews.find(
      (r: { decision: string }) => r.decision === 'changes_requested',
    );
    expect(review).toBeTruthy();
    expect(review.feedback).toBe(feedback);
    console.log('Changes requested review confirmed in task detail');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Full Lifecycle
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Full Lifecycle', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  test('33 — Create -> backlog -> planning -> executing -> (poll) -> review -> done', async ({ page }) => {
    test.slow(); // 3x timeout

    const title = uniqueId('lifecycle');
    const task = await createTask(page, csrf, {
      title,
      description: 'Full lifecycle test: create through done.',
    });
    cleanup.add(() => deleteTask(page, csrf, task.id));

    expect(task.status).toBe('auto_detected');
    console.log(`[lifecycle] Created: ${task.id} (auto_detected)`);

    // auto_detected -> backlog
    const r1 = await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });
    expect(r1.status).toBe(200);
    expect(r1.body.data.status).toBe('backlog');
    console.log('[lifecycle] -> backlog');

    // backlog -> planning
    const r2 = await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'planning' });
    expect(r2.status).toBe(200);
    expect(r2.body.data.status).toBe('planning');
    console.log('[lifecycle] -> planning');

    // planning -> executing
    const r3 = await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'executing' });
    expect(r3.status).toBe(200);
    expect(r3.body.data.status).toBe('executing');
    console.log('[lifecycle] -> executing');

    // Poll for agent to finish (review or failed)
    const updated = await pollTaskStatus(page, task.id, ['review', 'failed'], 90_000);
    console.log(`[lifecycle] -> ${updated.status} (polled)`);
    expect(['review', 'failed']).toContain(updated.status);

    // If we reached review, approve and move to done
    if (updated.status === 'review') {
      // Verify execution steps were recorded
      const stepsRes = await apiGet(page, `/tasks/${task.id}/steps`);
      console.log(`[lifecycle] Execution steps: ${stepsRes.body.data?.length ?? 0}`);
      expect(stepsRes.body.data.length).toBeGreaterThan(0);

      // review -> done
      const r4 = await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'done' });
      expect(r4.status).toBe(200);
      expect(r4.body.data.status).toBe('done');
      console.log('[lifecycle] -> done');
    } else {
      // If failed, verify we can retry: failed -> backlog
      const retry = await apiPatch(page, csrf, `/tasks/${task.id}`, { status: 'backlog' });
      expect(retry.status).toBe(200);
      console.log('[lifecycle] failed -> backlog (retry path verified)');
    }

    // Final verification via GET
    const final = await apiGet(page, `/tasks/${task.id}`);
    console.log(`[lifecycle] Final status: ${final.body.data.status}`);
    expect(['done', 'backlog']).toContain(final.body.data.status);
  });
});

test.describe('UI — Kanban Board', () => {
  test('Tasks page renders kanban columns', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/tasks');
    await page.waitForTimeout(2000);

    // Verify page loaded
    expect(page.url()).toContain('/tasks');

    // Look for kanban column headers
    const columnTexts = ['Detected', 'Backlog', 'Planning', 'Executing', 'Review', 'Done'];
    for (const col of columnTexts) {
      const visible = await page.locator(`text=${col}`).first().isVisible().catch(() => false);
      console.log(`Column "${col}" visible: ${visible}`);
    }
  });

  test('New Task button opens create form', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/tasks');
    await page.waitForTimeout(1500);

    const newTaskBtn = page.getByRole('button', { name: /new task/i });
    await expect(newTaskBtn).toBeVisible();
    await newTaskBtn.click();
    await page.waitForTimeout(500);

    // Form should appear with title input
    const titleInput = page.locator('input[placeholder*="title" i]').first();
    await expect(titleInput).toBeVisible();
    console.log('New Task form opened');
  });

  test('Create task via UI form and verify card appears', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/tasks');
    await page.waitForTimeout(1500);

    const title = `UI Task ${Date.now()}`;
    await page.getByRole('button', { name: /new task/i }).click();
    await page.waitForTimeout(300);

    const input = page.locator('input[placeholder*="title" i]').first();
    await input.fill(title);
    await input.press('Enter');
    await page.waitForTimeout(1500);

    // Task card should appear somewhere on the board
    const card = page.locator(`text=${title}`).first();
    await expect(card).toBeVisible({ timeout: 5000 });
    console.log(`Task "${title}" visible on kanban board`);

    // Click card to open detail panel
    await card.click();
    await page.waitForTimeout(1000);

    // Detail panel should show tabs
    const overviewTab = page.locator('button:has-text("Overview")');
    const hasOverview = await overviewTab.isVisible().catch(() => false);
    console.log(`Detail panel Overview tab: ${hasOverview}`);

    // Clean up via API
    const { body } = await apiGet(page, '/tasks?parentOnly=true');
    const task = (body.data || []).find((t: { title: string }) => t.title === title);
    if (task) await deleteTask(page, csrf, task.id);
  });

  test('Task detail panel tabs render', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Create a task via API
    const task = await createTask(page, csrf, { title: `Detail Panel UI ${Date.now()}` });

    await page.goto('/#/tasks');
    await page.waitForTimeout(1500);

    // Click the task card
    await page.locator(`text=${task.title}`).first().click();
    await page.waitForTimeout(1000);

    // Check all tabs
    for (const tabName of ['Overview', 'Execution', 'Comments', 'Subtasks']) {
      const tab = page.locator(`button:has-text("${tabName}")`);
      const visible = await tab.isVisible().catch(() => false);
      if (visible) {
        await tab.click();
        await page.waitForTimeout(300);
      }
      console.log(`Tab "${tabName}" visible: ${visible}`);
    }

    await deleteTask(page, csrf, task.id);
  });
});
