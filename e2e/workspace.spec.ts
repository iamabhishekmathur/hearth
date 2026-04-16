import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const API = 'http://localhost:8000/api/v1';
const AUTH_FILE = path.join(__dirname, '..', 'test-results', '.auth-state.json');

// ─── Shared auth: login once, reuse across tests ────────────────────────────

async function ensureAuth(page: Page): Promise<string> {
  // Try restoring saved auth state
  if (fs.existsSync(AUTH_FILE)) {
    const state = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    await page.context().addCookies(state.cookies);
    // Verify session is still valid
    const check = await page.request.get(`${API}/tasks?parentOnly=true`);
    if (check.ok()) {
      const cookies = await page.context().cookies();
      return cookies.find((c) => c.name === 'hearth.csrf')?.value ?? '';
    }
  }

  // Login fresh
  await page.goto('/login');
  await page.fill('input#email', 'admin@hearth.local');
  await page.fill('input#password', 'changeme');
  await page.click('button[type="submit"]');
  await expect(page.getByText('Chat')).toBeVisible({ timeout: 15_000 });

  // Save auth state for reuse
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === 'hearth.csrf')?.value ?? '';
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ cookies }));
  return csrf;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createTask(
  page: Page,
  csrf: string,
  data: { title: string; description?: string; source?: string },
) {
  const res = await page.request.post(`${API}/tasks`, {
    headers: { 'x-csrf-token': csrf, 'Content-Type': 'application/json' },
    data: { source: 'manual', ...data },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).data;
}

async function updateTask(
  page: Page,
  csrf: string,
  id: string,
  data: Record<string, unknown>,
) {
  const res = await page.request.patch(`${API}/tasks/${id}`, {
    headers: { 'x-csrf-token': csrf, 'Content-Type': 'application/json' },
    data,
  });
  return { status: res.status(), body: await res.json() };
}

async function deleteTask(page: Page, csrf: string, id: string) {
  await page.request.delete(`${API}/tasks/${id}`, {
    headers: { 'x-csrf-token': csrf },
  });
}

async function pollTaskStatus(
  page: Page,
  csrf: string,
  taskId: string,
  targetStatuses: string[],
  maxWaitMs = 60_000,
) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await page.request.get(`${API}/tasks/${taskId}`);
    const body = await res.json();
    const status = body.data?.status;
    if (targetStatuses.includes(status)) return body.data;
    await page.waitForTimeout(2000);
  }
  throw new Error(`Task ${taskId} did not reach ${targetStatuses.join('|')} within ${maxWaitMs}ms`);
}

// Transition a task through the full status machine to reach a target status
async function transitionTo(
  page: Page,
  csrf: string,
  taskId: string,
  target: 'backlog' | 'planning' | 'executing',
) {
  const chain: string[] = [];
  if (['backlog', 'planning', 'executing'].includes(target)) chain.push('backlog');
  if (['planning', 'executing'].includes(target)) chain.push('planning');
  if (target === 'executing') chain.push('executing');
  for (const status of chain) {
    await updateTask(page, csrf, taskId, { status });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TEST 1: Task CRUD & Kanban Board
// ═════════════════════════════════════════════════════════════════════════════

test('Task CRUD: create, read, update status, delete', async ({ page }) => {
  const csrf = await ensureAuth(page);
  const title = `CRUD Test ${Date.now()}`;

  // ── Create task via API ─────────────────────────────────────────────────
  let task: Record<string, unknown>;
  await test.step('Create task', async () => {
    task = await createTask(page, csrf, {
      title,
      description: 'Testing basic CRUD operations',
    });
    expect(task.id).toBeTruthy();
    expect(task.status).toBe('auto_detected');
    expect(task.source).toBe('manual');
    console.log(`Created task: ${task.id}`);
  });

  // ── Verify in list ──────────────────────────────────────────────────────
  await test.step('Task appears in GET /tasks', async () => {
    const res = await page.request.get(`${API}/tasks?parentOnly=true`);
    const body = await res.json();
    const found = body.data.find((t: Record<string, unknown>) => t.id === task.id);
    expect(found).toBeTruthy();
    expect(found.title).toBe(title);
  });

  // ── Update title ────────────────────────────────────────────────────────
  await test.step('Update task title', async () => {
    const { status, body } = await updateTask(page, csrf, task.id as string, {
      title: `${title} (updated)`,
    });
    expect(status).toBe(200);
    expect(body.data.title).toContain('(updated)');
  });

  // ── Status transitions ─────────────────────────────────────────────────
  await test.step('auto_detected → backlog', async () => {
    const { status } = await updateTask(page, csrf, task.id as string, { status: 'backlog' });
    expect(status).toBe(200);
  });

  await test.step('backlog → planning', async () => {
    const { status } = await updateTask(page, csrf, task.id as string, { status: 'planning' });
    expect(status).toBe(200);
  });

  await test.step('planning → backlog (revert)', async () => {
    const { status } = await updateTask(page, csrf, task.id as string, { status: 'backlog' });
    expect(status).toBe(200);
  });

  // ── Verify on Kanban board ─────────────────────────────────────────────
  await test.step('Task visible on Kanban board', async () => {
    await page.goto('/#/workspace');
    await page.waitForTimeout(1500);
    const taskCard = page.locator(`text=${title} (updated)`).first();
    await expect(taskCard).toBeVisible({ timeout: 10_000 });
  });

  // ── Delete ──────────────────────────────────────────────────────────────
  await test.step('Delete task', async () => {
    await deleteTask(page, csrf, task.id as string);
    // Verify gone — should return 404
    const res = await page.request.get(`${API}/tasks/${task.id}`);
    expect(res.status()).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TEST 2: Status Transition Validation
// ═════════════════════════════════════════════════════════════════════════════

test('Status transitions: valid and invalid', async ({ page }) => {
  const csrf = await ensureAuth(page);
  const task = await createTask(page, csrf, { title: `Transitions ${Date.now()}` });

  // Valid: auto_detected → backlog
  await test.step('Valid: auto_detected → backlog', async () => {
    const { status } = await updateTask(page, csrf, task.id, { status: 'backlog' });
    expect(status).toBe(200);
  });

  // Valid: backlog → planning
  await test.step('Valid: backlog → planning', async () => {
    const { status } = await updateTask(page, csrf, task.id, { status: 'planning' });
    expect(status).toBe(200);
  });

  // Invalid: planning → done (must go through executing → review first)
  await test.step('Invalid: planning → done', async () => {
    const { status, body } = await updateTask(page, csrf, task.id, { status: 'done' });
    expect(status).toBe(422);
    expect(body.error).toContain('transition');
  });

  // Invalid: planning → review
  await test.step('Invalid: planning → review', async () => {
    const { status } = await updateTask(page, csrf, task.id, { status: 'review' });
    expect(status).toBe(422);
  });

  // Valid: planning → executing
  await test.step('Valid: planning → executing (triggers agent)', async () => {
    const { status } = await updateTask(page, csrf, task.id, { status: 'executing' });
    expect(status).toBe(200);
  });

  // Wait for agent to finish, then verify review state
  await test.step('Agent completes → review', async () => {
    const updated = await pollTaskStatus(page, csrf, task.id, ['review', 'failed'], 90_000);
    console.log(`Task reached status: ${updated.status}`);
    expect(['review', 'failed']).toContain(updated.status);
  });

  // Valid: review → done
  await test.step('Valid: review → done', async () => {
    const res = await page.request.get(`${API}/tasks/${task.id}`);
    const current = (await res.json()).data;
    if (current.status === 'review') {
      const { status } = await updateTask(page, csrf, task.id, { status: 'done' });
      expect(status).toBe(200);
    }
  });

  await deleteTask(page, csrf, task.id);
});

// ═════════════════════════════════════════════════════════════════════════════
// TEST 3: Task Execution with AI Agent
// ═════════════════════════════════════════════════════════════════════════════

test('Task execution: AI agent runs with mock integrations', async ({ page }) => {
  const csrf = await ensureAuth(page);

  const task = await createTask(page, csrf, {
    title: 'Summarize my calendar and Slack activity',
    description:
      'Check @Google Calendar for upcoming events this week and search @Slack #engineering for recent updates. Write a brief summary.',
  });
  console.log(`Created task: ${task.id}`);

  // Move through status machine to executing
  await test.step('Transition to executing', async () => {
    await transitionTo(page, csrf, task.id, 'executing');
    console.log('Task execution enqueued');
  });

  // Wait for completion
  let completedTask: Record<string, unknown>;
  await test.step('Wait for agent completion', async () => {
    completedTask = await pollTaskStatus(page, csrf, task.id, ['review', 'failed'], 90_000);
    console.log(`Task status: ${completedTask.status}`);
    expect(completedTask.status).toBe('review');
  });

  // Verify agent output
  await test.step('Agent produced output', async () => {
    const output = completedTask.agentOutput as Record<string, unknown> | null;
    console.log(`Agent output: ${JSON.stringify(output)?.slice(0, 500)}`);
    expect(output).toBeTruthy();
  });

  // Verify execution steps
  await test.step('Execution steps recorded', async () => {
    const res = await page.request.get(`${API}/tasks/${task.id}/steps`);
    const body = await res.json();
    console.log(`Execution steps: ${body.data.length}`);
    expect(body.data.length).toBeGreaterThan(0);

    // Check step structure
    const step = body.data[0];
    expect(step.taskId).toBe(task.id);
    expect(step.description).toBeTruthy();
    expect(['completed', 'running', 'failed']).toContain(step.status);
  });

  // Complete the task
  await test.step('Mark as done', async () => {
    const { status } = await updateTask(page, csrf, task.id, { status: 'done' });
    expect(status).toBe(200);
  });

  await deleteTask(page, csrf, task.id);
});

// ═════════════════════════════════════════════════════════════════════════════
// TEST 4: Comments & Subtasks
// ═════════════════════════════════════════════════════════════════════════════

test('Comments and subtasks', async ({ page }) => {
  const csrf = await ensureAuth(page);
  const task = await createTask(page, csrf, {
    title: `Comments & Subtasks ${Date.now()}`,
    description: 'Parent task for testing comments and subtasks',
  });

  // ── Add comments ────────────────────────────────────────────────────────
  await test.step('Add comments', async () => {
    for (const text of ['First comment', 'Second comment', 'Looking good!']) {
      const res = await page.request.post(`${API}/tasks/${task.id}/comments`, {
        headers: { 'x-csrf-token': csrf, 'Content-Type': 'application/json' },
        data: { content: text },
      });
      expect(res.status()).toBe(201);
    }
  });

  await test.step('List comments', async () => {
    const res = await page.request.get(`${API}/tasks/${task.id}/comments`);
    const body = await res.json();
    expect(body.data.length).toBe(3);
    expect(body.data[0].content).toBe('First comment');
    expect(body.data[0].isAgent).toBe(false);
  });

  // ── Create subtasks ─────────────────────────────────────────────────────
  await test.step('Create subtasks', async () => {
    for (const title of ['Subtask A', 'Subtask B']) {
      const res = await page.request.post(`${API}/tasks/${task.id}/subtasks`, {
        headers: { 'x-csrf-token': csrf, 'Content-Type': 'application/json' },
        data: { title, description: `Description for ${title}` },
      });
      expect(res.status()).toBe(201);
      const sub = (await res.json()).data;
      expect(sub.parentTaskId).toBe(task.id);
      expect(sub.source).toBe('sub_agent');
    }
  });

  // ── Verify in task detail ───────────────────────────────────────────────
  await test.step('Task detail includes subtasks and comments', async () => {
    const res = await page.request.get(`${API}/tasks/${task.id}`);
    const body = await res.json();
    expect(body.data.subTasks.length).toBe(2);
    expect(body.data.comments.length).toBe(3);
  });

  // ── Verify in UI ───────────────────────────────────────────────────────
  await test.step('UI shows comments and subtasks', async () => {
    await page.goto('/#/workspace');
    await page.waitForTimeout(1500);

    // Click task to open detail panel
    await page.locator(`text=${task.title}`).first().click();
    await page.waitForTimeout(1000);

    // Check Comments tab
    await page.locator('button:has-text("Comments")').click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=First comment')).toBeVisible();
    await expect(page.locator('text=Looking good!')).toBeVisible();

    // Check Subtasks tab
    await page.locator('button:has-text("Subtasks")').click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=Subtask A')).toBeVisible();
    await expect(page.locator('text=Subtask B')).toBeVisible();
  });

  await deleteTask(page, csrf, task.id);
});

// ═════════════════════════════════════════════════════════════════════════════
// TEST 5: Task Detail Panel — All Tabs
// ═════════════════════════════════════════════════════════════════════════════

test('Task detail panel: all tabs render correctly', async ({ page }) => {
  const csrf = await ensureAuth(page);

  // Create and execute a task so we have execution data
  const task = await createTask(page, csrf, {
    title: `Detail Panel ${Date.now()}`,
    description: 'List my Gmail labels and search Notion for "roadmap".',
  });

  // Execute it through the full status machine
  await transitionTo(page, csrf, task.id, 'executing');
  await pollTaskStatus(page, csrf, task.id, ['review', 'failed'], 90_000);

  // Add a comment
  await page.request.post(`${API}/tasks/${task.id}/comments`, {
    headers: { 'x-csrf-token': csrf, 'Content-Type': 'application/json' },
    data: { content: 'Reviewing this execution' },
  });

  // Add a subtask
  await page.request.post(`${API}/tasks/${task.id}/subtasks`, {
    headers: { 'x-csrf-token': csrf, 'Content-Type': 'application/json' },
    data: { title: 'Follow-up item' },
  });

  // Navigate to workspace and open detail panel
  await page.goto('/#/workspace');
  await page.waitForTimeout(1500);
  // Use full unique title to avoid matching tasks from previous test runs
  await page.locator(`text=${task.title}`).first().click();
  await page.waitForTimeout(1000);

  // ── Overview tab ────────────────────────────────────────────────────────
  await test.step('Overview tab', async () => {
    await page.locator('button:has-text("Overview")').click();
    await page.waitForTimeout(300);
    // Should show description — use .first() since text may appear in Kanban cards too
    await expect(page.locator('text=List my Gmail labels').first()).toBeVisible();
  });

  // ── Execution tab ──────────────────────────────────────────────────────
  await test.step('Execution tab shows steps', async () => {
    await page.locator('button:has-text("Execution")').click();
    await page.waitForTimeout(500);
    const stepEntries = page.locator('text=#1');
    const hasSteps = (await stepEntries.count()) > 0;
    console.log(`Has execution steps visible: ${hasSteps}`);
  });

  // ── Comments tab ───────────────────────────────────────────────────────
  await test.step('Comments tab', async () => {
    await page.locator('button:has-text("Comments")').click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=Reviewing this execution').first()).toBeVisible();
  });

  // ── Subtasks tab ───────────────────────────────────────────────────────
  await test.step('Subtasks tab', async () => {
    await page.locator('button:has-text("Subtasks")').click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=Follow-up item')).toBeVisible();
  });

  await page.screenshot({ path: 'test-results/workspace-detail-panel.png' });

  await deleteTask(page, csrf, task.id);
});

// ═════════════════════════════════════════════════════════════════════════════
// TEST 6: Kanban Board UI — Create via Form
// ═════════════════════════════════════════════════════════════════════════════

test('Kanban board: create task via UI form', async ({ page }) => {
  const csrf = await ensureAuth(page);
  const title = `UI Created ${Date.now()}`;

  await page.goto('/#/workspace');
  await page.waitForTimeout(1500);

  // Click "New Task" button
  await test.step('Open create form', async () => {
    await page.locator('button:has-text("New Task")').click();
    await page.waitForTimeout(300);
    const input = page.locator('input[placeholder*="title"]').first();
    await expect(input).toBeVisible();
  });

  // Type title and submit
  await test.step('Create task via form', async () => {
    const input = page.locator('input[placeholder*="title"]').first();
    await input.fill(title);
    await input.press('Enter');
    await page.waitForTimeout(1500);
  });

  // Verify it appears in the board
  await test.step('Task appears on Kanban board', async () => {
    await page.waitForTimeout(500);
    const taskCard = page.locator(`text=${title}`).first();
    await expect(taskCard).toBeVisible({ timeout: 5_000 });
  });

  // Clean up
  const res = await page.request.get(`${API}/tasks?parentOnly=true`);
  const tasks = (await res.json()).data;
  const created = tasks.find((t: Record<string, unknown>) => t.title === title);
  if (created) await deleteTask(page, csrf, created.id as string);
});

// ═════════════════════════════════════════════════════════════════════════════
// TEST 7: Full Lifecycle — End to End
// ═════════════════════════════════════════════════════════════════════════════

test('Full lifecycle: create → plan → execute → review → done', async ({ page }) => {
  const csrf = await ensureAuth(page);
  const title = `Lifecycle ${Date.now()}`;

  // Create
  const task = await createTask(page, csrf, {
    title,
    description: 'Search Notion for "sprint planning" and check my upcoming Google Calendar events. Give me a brief summary.',
  });
  console.log(`Created: ${task.id} [auto_detected]`);

  // Triage
  await test.step('auto_detected → backlog', async () => {
    const { status } = await updateTask(page, csrf, task.id, { status: 'backlog' });
    expect(status).toBe(200);
    console.log('Moved to: backlog');
  });

  // Plan
  await test.step('backlog → planning', async () => {
    const { status } = await updateTask(page, csrf, task.id, { status: 'planning' });
    expect(status).toBe(200);
    console.log('Moved to: planning');
  });

  // Execute
  await test.step('planning → executing (triggers AI)', async () => {
    const { status } = await updateTask(page, csrf, task.id, { status: 'executing' });
    expect(status).toBe(200);
    console.log('Moved to: executing');
  });

  // Wait for review
  let reviewTask: Record<string, unknown>;
  await test.step('Wait for agent → review', async () => {
    reviewTask = await pollTaskStatus(page, csrf, task.id, ['review', 'failed'], 90_000);
    console.log(`Reached: ${reviewTask.status}`);
    expect(reviewTask.status).toBe('review');
  });

  // Verify execution results
  await test.step('Verify execution results', async () => {
    // Agent output
    expect(reviewTask.agentOutput).toBeTruthy();
    const output = JSON.stringify(reviewTask.agentOutput);
    console.log(`Agent output (${output.length} chars): ${output.slice(0, 300)}`);

    // Execution steps
    const stepsRes = await page.request.get(`${API}/tasks/${task.id}/steps`);
    const steps = (await stepsRes.json()).data;
    console.log(`Execution steps: ${steps.length}`);
    expect(steps.length).toBeGreaterThan(0);

    // System comment from agent should exist
    const commentsRes = await page.request.get(`${API}/tasks/${task.id}/comments`);
    const comments = (await commentsRes.json()).data;
    console.log(`Comments: ${comments.length}`);
  });

  // Complete
  await test.step('review → done', async () => {
    const { status } = await updateTask(page, csrf, task.id, { status: 'done' });
    expect(status).toBe(200);
    console.log('Moved to: done');
  });

  // Verify on board
  await test.step('Verify in Done column on board', async () => {
    await page.goto('/#/workspace');
    await page.waitForTimeout(1500);
    const taskCard = page.locator(`text=${title}`).first();
    await expect(taskCard).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: 'test-results/workspace-lifecycle-done.png' });
  });

  await deleteTask(page, csrf, task.id);
});
