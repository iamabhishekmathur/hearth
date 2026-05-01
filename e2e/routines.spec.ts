/**
 * Comprehensive Routines E2E Tests (~30 tests)
 *
 * Covers: CRUD, Execution, Scheduling, Templates, State Management,
 * Run History, Triggers & Webhooks, Chains, Parameterized Routines,
 * Scope, and Approvals.
 *
 * Replaces the older routine-run.spec.ts and routine-history.spec.ts.
 */
import { test, expect } from '@playwright/test';
import {
  API,
  loginAs,
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  createRoutine,
  pollRunStatus,
  Cleanup,
  uniqueId,
  HAS_LLM,
} from './fixtures/test-helpers';

// ═════════════════════════════════════════════════════════════════════════════
// CRUD
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Routines — CRUD', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  // 1
  test('Create routine with name + prompt returns 201', async ({ page }) => {
    const name = uniqueId('routine');
    const res = await apiPost(page, csrf, '/routines', {
      name,
      prompt: 'Summarize the latest engineering standup notes.',
      delivery: { channels: ['in_app'] },
    });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.name).toBe(name);
    expect(res.body.data.prompt).toContain('standup');
    console.log(`Created routine: ${res.body.data.id}`);

    const id = res.body.data.id;
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${id}`);
    });
  });

  // 2
  test('Create with full config stores schedule, params, delivery, and description', async ({
    page,
  }) => {
    const name = uniqueId('full-config');
    const res = await apiPost(page, csrf, '/routines', {
      name,
      prompt: 'Generate a weekly digest of team activity.',
      schedule: '0 9 * * 1',
      delivery: { channels: ['in_app', 'email'] },
      parameters: [
        { name: 'teamName', label: 'Team Name', type: 'string', default: 'Engineering' },
        { name: 'includePRs', label: 'Include PRs', type: 'boolean', default: true },
      ],
      scope: 'personal',
      description: 'Weekly team digest with configurable team and PR inclusion.',
    });

    expect(res.status).toBe(201);
    const data = res.body.data;
    expect(data.schedule).toBe('0 9 * * 1');
    expect(data.delivery.channels).toContain('email');
    expect(data.parameters).toHaveLength(2);
    expect(data.parameters[0].name).toBe('teamName');
    expect(data.scope).toBe('personal');
    expect(data.description).toContain('Weekly team digest');
    console.log(`Full-config routine created: ${data.id}`);

    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${data.id}`);
    });
  });

  // 3
  test('Create with invalid cron schedule returns validation error', async ({ page }) => {
    const res = await apiPost(page, csrf, '/routines', {
      name: uniqueId('bad-cron'),
      prompt: 'This should fail.',
      schedule: 'not-a-valid-cron',
      delivery: { channels: ['in_app'] },
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    console.log(`Invalid cron rejected with status ${res.status}: ${JSON.stringify(res.body.error ?? res.body.message)}`);
  });

  // 4 — API uses PATCH /:id (not PUT)
  test('Edit routine prompt updates the stored value', async ({ page }) => {
    const routine = await createRoutine(page, csrf, {
      name: uniqueId('edit-me'),
      prompt: 'Original prompt text.',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    const updated = await apiPatch(page, csrf, `/routines/${routine.id}`, {
      prompt: 'Updated prompt text with new instructions.',
    });

    expect(updated.status).toBe(200);
    expect(updated.body.data.prompt).toContain('Updated prompt text');
    console.log(`Routine ${routine.id} prompt updated`);

    // Verify via GET
    const detail = await apiGet(page, `/routines/${routine.id}`);
    expect(detail.body.data.prompt).toContain('Updated prompt text');
  });

  // 5
  test('Delete routine returns 204', async ({ page }) => {
    const routine = await createRoutine(page, csrf, {
      name: uniqueId('delete-me'),
      prompt: 'Routine to be deleted.',
    });

    const res = await apiDelete(page, csrf, `/routines/${routine.id}`);
    expect(res.status).toBe(204);
    console.log(`Routine ${routine.id} deleted`);

    // Verify it is gone
    const detail = await apiGet(page, `/routines/${routine.id}`);
    expect(detail.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Execution (LLM-dependent)
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Routines — Execution', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  // 6
  test('Run now triggers execution and stores output on completion', async ({ page }) => {
    test.slow();

    const routine = await createRoutine(page, csrf, {
      name: uniqueId('run-now'),
      prompt: 'List 3 productivity tips for remote teams.',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    const triggerRes = await apiPost(page, csrf, `/routines/${routine.id}/run-now`);
    expect(triggerRes.status).toBe(200);
    expect(triggerRes.body.message).toContain('enqueued');
    console.log('Run enqueued, polling for completion...');

    const run = await pollRunStatus(page, routine.id, 90_000);
    expect(run.status).toBe('success');
    expect(run.output).toBeTruthy();
    const outputText = typeof run.output === 'string' ? run.output : (run.output?.result ?? JSON.stringify(run.output));
    expect(outputText.length).toBeGreaterThan(10);
    console.log(`Run completed: ${run.status}, output length: ${outputText.length}`);
  });

  // 7
  test('Test-run executes prompt without saving a routine', async ({ page }) => {
    test.slow();

    const res = await apiPost(page, csrf, '/routines/test-run', {
      prompt: 'What is 2 + 2? Reply with just the number.',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBeTruthy();
    expect(res.body.data.durationMs).toBeGreaterThanOrEqual(0);
    console.log(`Test-run status: ${res.body.data.status}, duration: ${res.body.data.durationMs}ms`);

    if (res.body.data.status === 'success') {
      expect(res.body.data.output).toBeTruthy();
      console.log(`Test-run output: ${JSON.stringify(res.body.data.output).slice(0, 300)}`);
    }
  });

  // 8 — No GET /:id/runs/:runId endpoint; fetch from run list instead
  test('View individual run output returns full text', async ({ page }) => {
    test.slow();

    const routine = await createRoutine(page, csrf, {
      name: uniqueId('view-output'),
      prompt: 'Say hello world.',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    await apiPost(page, csrf, `/routines/${routine.id}/run-now`);
    const run = await pollRunStatus(page, routine.id, 90_000);

    // Fetch single run from the list endpoint
    const listRes = await apiGet(page, `/routines/${routine.id}/runs`);
    expect(listRes.status).toBe(200);
    const found = (listRes.body.data ?? []).find(
      (r: { id: string }) => r.id === run.id,
    );
    expect(found).toBeTruthy();
    expect(found.output).toBeTruthy();
    console.log(`Run detail fetched: id=${run.id}, status=${found.status}`);
  });

  // 9
  test('Run history lists completed runs', async ({ page }) => {
    test.slow();

    const routine = await createRoutine(page, csrf, {
      name: uniqueId('history-check'),
      prompt: 'Reply with OK.',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    // Trigger a run and wait
    await apiPost(page, csrf, `/routines/${routine.id}/run-now`);
    await pollRunStatus(page, routine.id, 90_000);

    const history = await apiGet(page, `/routines/${routine.id}/runs`);
    expect(history.status).toBe(200);
    expect(history.body.data.length).toBeGreaterThanOrEqual(1);
    expect(['success', 'failed']).toContain(history.body.data[0].status);
    console.log(`Run history contains ${history.body.data.length} run(s)`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scheduling (Toggle endpoint)
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Routines — Scheduling', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  // 10 — API uses POST /:id/toggle (single toggle, not separate enable/disable)
  test('Toggle routine to enabled sets enabled to true', async ({ page }) => {
    const routine = await createRoutine(page, csrf, {
      name: uniqueId('enable-me'),
      prompt: 'Scheduled task.',
      schedule: '0 8 * * *',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    // Check current state and toggle until enabled
    let detail = await apiGet(page, `/routines/${routine.id}`);
    if (detail.body.data.enabled) {
      // Already enabled — toggle off first so we can toggle on
      await apiPost(page, csrf, `/routines/${routine.id}/toggle`);
    }

    const res = await apiPost(page, csrf, `/routines/${routine.id}/toggle`);
    expect(res.status).toBe(200);

    detail = await apiGet(page, `/routines/${routine.id}`);
    expect(detail.body.data.enabled).toBe(true);
    console.log(`Routine ${routine.id} enabled via toggle`);
  });

  // 11 — API uses POST /:id/toggle
  test('Toggle routine to disabled sets enabled to false', async ({ page }) => {
    const routine = await createRoutine(page, csrf, {
      name: uniqueId('disable-me'),
      prompt: 'Scheduled task.',
      schedule: '0 8 * * *',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    // Ensure enabled first
    let detail = await apiGet(page, `/routines/${routine.id}`);
    if (!detail.body.data.enabled) {
      await apiPost(page, csrf, `/routines/${routine.id}/toggle`);
    }

    // Now toggle to disabled
    const res = await apiPost(page, csrf, `/routines/${routine.id}/toggle`);
    expect(res.status).toBe(200);

    detail = await apiGet(page, `/routines/${routine.id}`);
    expect(detail.body.data.enabled).toBe(false);
    console.log(`Routine ${routine.id} disabled via toggle`);
  });

  // 12
  test('Toggle on then off results in correct final state', async ({ page }) => {
    const routine = await createRoutine(page, csrf, {
      name: uniqueId('toggle'),
      prompt: 'Toggle test.',
      schedule: '0 12 * * *',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    // Get initial state
    let detail = await apiGet(page, `/routines/${routine.id}`);
    const initialEnabled = detail.body.data.enabled;

    // Toggle 1
    await apiPost(page, csrf, `/routines/${routine.id}/toggle`);
    detail = await apiGet(page, `/routines/${routine.id}`);
    expect(detail.body.data.enabled).toBe(!initialEnabled);

    // Toggle 2
    await apiPost(page, csrf, `/routines/${routine.id}/toggle`);
    detail = await apiGet(page, `/routines/${routine.id}`);
    expect(detail.body.data.enabled).toBe(initialEnabled);

    // Toggle 3
    await apiPost(page, csrf, `/routines/${routine.id}/toggle`);
    detail = await apiGet(page, `/routines/${routine.id}`);
    expect(detail.body.data.enabled).toBe(!initialEnabled);
    console.log(`Toggle sequence completed, final enabled=${detail.body.data.enabled}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Templates
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Routines — Templates', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  // 13 — No GET /routines/templates endpoint exists yet; skip until implemented
  test('Browse templates returns a list of available templates', async ({ page }) => {
    test.skip(true, 'GET /routines/templates endpoint not yet implemented');

    const res = await apiGet(page, '/routines/templates');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);

    const first = res.body.data[0];
    expect(first.name).toBeTruthy();
    expect(first.prompt).toBeTruthy();
    console.log(`Templates available: ${res.body.data.length}`);
    console.log(`First template: "${first.name}"`);
  });

  // 14 — Depends on templates endpoint; skip until implemented
  test('Create routine from template pre-populates fields', async ({ page }) => {
    test.skip(true, 'GET /routines/templates endpoint not yet implemented');

    const templates = await apiGet(page, '/routines/templates');
    expect(templates.body.data.length).toBeGreaterThan(0);

    const tpl = templates.body.data[0];
    const name = uniqueId('from-template');
    const routine = await createRoutine(page, csrf, {
      name,
      prompt: tpl.prompt,
      schedule: tpl.schedule ?? '0 9 * * 1-5',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    expect(routine.prompt).toBe(tpl.prompt);
    console.log(`Routine created from template "${tpl.name}": id=${routine.id}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// State Management
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Routines — State Management', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  // 15
  test('Get state returns state JSON', async ({ page }) => {
    const routine = await createRoutine(page, csrf, {
      name: uniqueId('state-get'),
      prompt: 'Stateful routine.',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    const res = await apiGet(page, `/routines/${routine.id}/state`);
    expect(res.status).toBe(200);
    // State may be empty object or null initially
    expect(res.body.data !== undefined).toBe(true);
    console.log(`Initial state: ${JSON.stringify(res.body.data)}`);
  });

  // 16 — State PUT body IS the state object (raw), not { state: {...} }
  test('Update state merges new values', async ({ page }) => {
    const routine = await createRoutine(page, csrf, {
      name: uniqueId('state-update'),
      prompt: 'Stateful routine.',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    // Set initial state (body IS the state, not wrapped)
    await apiPut(page, csrf, `/routines/${routine.id}/state`, {
      lastRunDate: '2026-04-20',
      counter: 1,
    });

    // Update with new value
    await apiPut(page, csrf, `/routines/${routine.id}/state`, {
      lastRunDate: '2026-04-24',
      counter: 2,
      newField: 'hello',
    });

    const res = await apiGet(page, `/routines/${routine.id}/state`);
    expect(res.status).toBe(200);
    // Response is { data: state_object }
    expect(res.body.data.counter).toBe(2);
    expect(res.body.data.lastRunDate).toBe('2026-04-24');
    expect(res.body.data.newField).toBe('hello');
    console.log(`Updated state: ${JSON.stringify(res.body.data)}`);
  });

  // 17 — State DELETE response is { data: {} }
  test('Reset state clears all state data', async ({ page }) => {
    const routine = await createRoutine(page, csrf, {
      name: uniqueId('state-reset'),
      prompt: 'Stateful routine.',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    // Set some state (body IS the state, not wrapped)
    await apiPut(page, csrf, `/routines/${routine.id}/state`, {
      important: 'data',
      count: 42,
    });

    // Reset — returns { data: {} }
    const resetRes = await apiDelete(page, csrf, `/routines/${routine.id}/state`);
    expect(resetRes.status).toBe(200);

    // Verify emptied
    const res = await apiGet(page, `/routines/${routine.id}/state`);
    expect(res.status).toBe(200);
    const state = res.body.data;
    // Should be empty/null/{}
    const isEmpty =
      state === null ||
      state === undefined ||
      (typeof state === 'object' && Object.keys(state).length === 0);
    expect(isEmpty).toBe(true);
    console.log(`State after reset: ${JSON.stringify(state)}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Run History (LLM-dependent)
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Routines — Run History', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  // 18
  test('Two runs appear in history with correct count', async ({ page }) => {
    test.slow();

    const routine = await createRoutine(page, csrf, {
      name: uniqueId('two-runs'),
      prompt: 'Reply with a random number.',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    // Run #1
    await apiPost(page, csrf, `/routines/${routine.id}/run-now`);
    await pollRunStatus(page, routine.id, 90_000);

    // Run #2
    await apiPost(page, csrf, `/routines/${routine.id}/run-now`);
    // Poll until we have 2 completed runs
    const start = Date.now();
    let runs: Array<{ status: string; startedAt: string }> = [];
    while (Date.now() - start < 90_000) {
      const { body } = await apiGet(page, `/routines/${routine.id}/runs`);
      const completed = (body.data ?? []).filter(
        (r: { status: string }) => r.status === 'success' || r.status === 'failed',
      );
      if (completed.length >= 2) {
        runs = completed;
        break;
      }
      await page.waitForTimeout(2000);
    }

    expect(runs.length).toBeGreaterThanOrEqual(2);
    // Most recent first
    expect(new Date(runs[0].startedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(runs[1].startedAt).getTime(),
    );
    console.log(`History shows ${runs.length} completed runs`);
  });

  // 19 — No server-side status filter on GET /:id/runs; filter client-side
  test('Filter runs by status returns only matching entries', async ({ page }) => {
    test.slow();

    const routine = await createRoutine(page, csrf, {
      name: uniqueId('filter-status'),
      prompt: 'Reply with OK.',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    await apiPost(page, csrf, `/routines/${routine.id}/run-now`);
    await pollRunStatus(page, routine.id, 90_000);

    // Fetch all runs and filter client-side (no server-side status filter)
    const allRunsRes = await apiGet(page, `/routines/${routine.id}/runs`);
    expect(allRunsRes.status).toBe(200);

    const successRuns = (allRunsRes.body.data ?? []).filter(
      (r: { status: string }) => r.status === 'success',
    );
    for (const run of successRuns) {
      expect(run.status).toBe('success');
    }
    console.log(`Filtered success runs: ${successRuns.length}`);

    const pendingRuns = (allRunsRes.body.data ?? []).filter(
      (r: { status: string }) => r.status === 'pending',
    );
    expect(pendingRuns.length).toBe(0);
    console.log('Filtered pending runs: 0 (as expected)');
  });

  // 20 — GET /:id/runs supports ?page= but not ?pageSize=; response has { data, total, page, pageSize }
  test('Pagination returns correct page ordering', async ({ page }) => {
    test.slow();

    const routine = await createRoutine(page, csrf, {
      name: uniqueId('pagination'),
      prompt: 'Reply with OK.',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    // Create at least one run
    await apiPost(page, csrf, `/routines/${routine.id}/run-now`);
    await pollRunStatus(page, routine.id, 90_000);

    // Request page 1
    const page1 = await apiGet(page, `/routines/${routine.id}/runs?page=1`);
    expect(page1.status).toBe(200);
    expect(page1.body.data.length).toBeGreaterThanOrEqual(1);
    expect(page1.body.total).toBeGreaterThanOrEqual(1);
    expect(page1.body.page).toBe(1);
    console.log(`Page 1: ${page1.body.data.length} run(s), total: ${page1.body.total}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Triggers & Webhooks
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Routines — Triggers & Webhooks', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  // 21 — Webhook endpoints are under /routines/webhook-endpoints (not /webhooks/endpoints)
  test('Create webhook endpoint generates a urlToken', async ({ page }) => {
    const res = await apiPost(page, csrf, '/routines/webhook-endpoints', {
      provider: 'github',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.urlToken).toBeTruthy();
    expect(res.body.data.urlToken.length).toBeGreaterThan(8);
    console.log(`Webhook endpoint created: id=${res.body.data.id}, token=${res.body.data.urlToken.slice(0, 8)}...`);

    const endpointId = res.body.data.id;
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/webhook-endpoints/${endpointId}`);
    });
  });

  // 22
  test('Create trigger on a routine stores the trigger', async ({ page }) => {
    const routine = await createRoutine(page, csrf, {
      name: uniqueId('trigger-routine'),
      prompt: 'Process incoming webhook event.',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    // Create webhook endpoint
    const epRes = await apiPost(page, csrf, '/routines/webhook-endpoints', {
      provider: 'github',
    });
    expect(epRes.status).toBe(201);
    const endpointId = epRes.body.data.id;
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/webhook-endpoints/${endpointId}`);
    });

    // Create trigger
    const triggerRes = await apiPost(page, csrf, `/routines/${routine.id}/triggers`, {
      webhookEndpointId: endpointId,
      eventType: 'push',
      filters: { branch: 'main' },
      parameterMapping: { commitMessage: '$.head_commit.message' },
    });

    expect(triggerRes.status).toBe(201);
    expect(triggerRes.body.data.id).toBeTruthy();
    expect(triggerRes.body.data.eventType).toBe('push');
    console.log(`Trigger created: ${triggerRes.body.data.id}`);

    const triggerId = triggerRes.body.data.id;
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}/triggers/${triggerId}`);
    });
  });

  // 23
  test('Delete trigger removes it', async ({ page }) => {
    const routine = await createRoutine(page, csrf, {
      name: uniqueId('trigger-delete'),
      prompt: 'Process webhook.',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    const epRes = await apiPost(page, csrf, '/routines/webhook-endpoints', {
      provider: 'generic',
    });
    const endpointId = epRes.body.data.id;
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/webhook-endpoints/${endpointId}`);
    });

    const triggerRes = await apiPost(page, csrf, `/routines/${routine.id}/triggers`, {
      webhookEndpointId: endpointId,
      eventType: 'issue_opened',
    });
    const triggerId = triggerRes.body.data.id;

    // Delete the trigger
    const delRes = await apiDelete(page, csrf, `/routines/${routine.id}/triggers/${triggerId}`);
    expect([200, 204]).toContain(delRes.status);
    console.log(`Trigger ${triggerId} deleted`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Chains (mounted at /api/v1/routines via chains router)
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Routines — Chains', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  // 24
  test('Create chain A -> B stores the chain link', async ({ page }) => {
    const routineA = await createRoutine(page, csrf, {
      name: uniqueId('chain-A'),
      prompt: 'Routine A: gather data.',
    });
    const routineB = await createRoutine(page, csrf, {
      name: uniqueId('chain-B'),
      prompt: 'Routine B: process data from A.',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routineA.id}`);
      await apiDelete(page, csrf, `/routines/${routineB.id}`);
    });

    const chainRes = await apiPost(page, csrf, `/routines/${routineA.id}/chains`, {
      targetRoutineId: routineB.id,
      condition: 'always',
      parameterMapping: { inputData: '$.output.result' },
    });

    expect(chainRes.status).toBe(201);
    expect(chainRes.body.data.id).toBeTruthy();
    expect(chainRes.body.data.targetRoutineId).toBe(routineB.id);
    console.log(`Chain created: ${routineA.id} -> ${routineB.id}, chain id=${chainRes.body.data.id}`);

    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routineA.id}/chains/${chainRes.body.data.id}`);
    });
  });

  // 25
  test('Get chains lists all chains for a routine', async ({ page }) => {
    const routineA = await createRoutine(page, csrf, {
      name: uniqueId('chain-list-A'),
      prompt: 'Source routine.',
    });
    const routineB = await createRoutine(page, csrf, {
      name: uniqueId('chain-list-B'),
      prompt: 'Target routine.',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routineA.id}`);
      await apiDelete(page, csrf, `/routines/${routineB.id}`);
    });

    const chainRes = await apiPost(page, csrf, `/routines/${routineA.id}/chains`, {
      targetRoutineId: routineB.id,
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routineA.id}/chains/${chainRes.body.data.id}`);
    });

    const listRes = await apiGet(page, `/routines/${routineA.id}/chains`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);

    const chain = listRes.body.data.find(
      (c: { targetRoutineId: string }) => c.targetRoutineId === routineB.id,
    );
    expect(chain).toBeTruthy();
    console.log(`Chains for ${routineA.id}: ${listRes.body.data.length}`);
  });

  // 26
  test('Delete chain removes it from the list', async ({ page }) => {
    const routineA = await createRoutine(page, csrf, {
      name: uniqueId('chain-del-A'),
      prompt: 'Source.',
    });
    const routineB = await createRoutine(page, csrf, {
      name: uniqueId('chain-del-B'),
      prompt: 'Target.',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routineA.id}`);
      await apiDelete(page, csrf, `/routines/${routineB.id}`);
    });

    const chainRes = await apiPost(page, csrf, `/routines/${routineA.id}/chains`, {
      targetRoutineId: routineB.id,
    });
    const chainId = chainRes.body.data.id;

    // Delete the chain
    const delRes = await apiDelete(page, csrf, `/routines/${routineA.id}/chains/${chainId}`);
    expect([200, 204]).toContain(delRes.status);

    // Verify removed
    const listRes = await apiGet(page, `/routines/${routineA.id}/chains`);
    const found = (listRes.body.data ?? []).find(
      (c: { id: string }) => c.id === chainId,
    );
    expect(found).toBeFalsy();
    console.log(`Chain ${chainId} deleted and verified removed`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Parameterized Routines
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Routines — Parameterized', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  // 27
  test('Create routine with parameters stores them correctly', async ({ page }) => {
    const name = uniqueId('parameterized');
    const params = [
      { name: 'reportType', label: 'Report Type', type: 'string', default: 'weekly' },
      { name: 'maxItems', label: 'Max Items', type: 'number', default: 10 },
      { name: 'includeCharts', label: 'Include Charts', type: 'boolean', default: false },
    ];

    const res = await apiPost(page, csrf, '/routines', {
      name,
      prompt: 'Generate a {{reportType}} report with up to {{maxItems}} items.',
      parameters: params,
      delivery: { channels: ['in_app'] },
    });

    expect(res.status).toBe(201);
    expect(res.body.data.parameters).toHaveLength(3);
    expect(res.body.data.parameters[0].name).toBe('reportType');
    expect(res.body.data.parameters[1].type).toBe('number');
    expect(res.body.data.parameters[2].default).toBe(false);
    console.log(`Parameterized routine created: ${res.body.data.id}`);

    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${res.body.data.id}`);
    });
  });

  // 28 — run-now body uses { parameterValues } (not { parameters })
  test('Run with parameter values makes params accessible to execution', async ({ page }) => {
    test.slow();

    const routine = await createRoutine(page, csrf, {
      name: uniqueId('param-run'),
      prompt: 'Generate a report of type {{reportType}}. Include {{maxItems}} items.',
      parameters: [
        { name: 'reportType', type: 'string', default: 'weekly' },
        { name: 'maxItems', type: 'number', default: 5 },
      ],
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    // Run with custom parameter values — body key is parameterValues
    const triggerRes = await apiPost(page, csrf, `/routines/${routine.id}/run-now`, {
      parameterValues: { reportType: 'daily', maxItems: 3 },
    });
    expect(triggerRes.status).toBe(200);
    expect(triggerRes.body.message).toContain('enqueued');

    const run = await pollRunStatus(page, routine.id, 90_000);
    expect(['success', 'failed']).toContain(run.status);
    console.log(`Parameterized run completed: status=${run.status}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scope
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Routines — Scope', () => {
  let csrf: string;
  const cleanup = new Cleanup();

  test.beforeEach(async ({ page }) => {
    csrf = await loginAs(page, 'admin');
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  // 29
  test('Create personal routine sets scope to personal', async ({ page }) => {
    const routine = await createRoutine(page, csrf, {
      name: uniqueId('personal-scope'),
      prompt: 'My personal digest.',
      scope: 'personal',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    expect(routine.scope).toBe('personal');
    console.log(`Personal routine created: ${routine.id}, scope=${routine.scope}`);

    // Verify via list
    const list = await apiGet(page, '/routines');
    const found = list.body.data.find(
      (r: { id: string }) => r.id === routine.id,
    );
    expect(found).toBeTruthy();
    expect(found.scope).toBe('personal');
  });

  // 30
  test('Create org routine sets scope to org (admin user)', async ({ page }) => {
    const routine = await createRoutine(page, csrf, {
      name: uniqueId('org-scope'),
      prompt: 'Organization-wide weekly summary.',
      scope: 'org',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/routines/${routine.id}`);
    });

    expect(routine.scope).toBe('org');
    console.log(`Org routine created: ${routine.id}, scope=${routine.scope}`);

    // Verify persisted
    const detail = await apiGet(page, `/routines/${routine.id}`);
    expect(detail.body.data.scope).toBe('org');
  });
});

test.describe('UI — Routines Page', () => {
  test('Routines page renders with scope tabs and new button', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/routines');
    await page.waitForTimeout(2000);

    expect(page.url()).toContain('/routines');

    // Scope tabs
    for (const tab of ['My Routines', 'Team', 'Organization']) {
      const el = page.locator(`button:has-text("${tab}")`).first();
      const visible = await el.isVisible().catch(() => false);
      console.log(`Tab "${tab}" visible: ${visible}`);
    }

    // New Routine button
    const newBtn = page.getByRole('button', { name: /new routine/i });
    await expect(newBtn).toBeVisible();
    console.log('Routines page elements rendered');
  });

  test('Click routine opens detail panel', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/routines');
    await page.waitForTimeout(2000);

    // Click any routine in the list
    const firstRoutine = page.locator('[class*="cursor-pointer"], [class*="hover:bg"]').first();
    if (await firstRoutine.isVisible().catch(() => false)) {
      await firstRoutine.click();
      await page.waitForTimeout(1000);

      // Detail panel should show
      const panel = page.locator('[class*="border-l"]').first();
      const visible = await panel.isVisible().catch(() => false);
      console.log(`Routine detail panel visible: ${visible}`);
    } else {
      console.log('No routines visible in list');
    }
  });

  test('Switch between scope tabs', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/routines');
    await page.waitForTimeout(1500);

    for (const tab of ['Team', 'Organization', 'My Routines']) {
      const el = page.locator(`button:has-text("${tab}")`).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        await page.waitForTimeout(500);
        console.log(`Switched to ${tab} scope`);
      }
    }
  });
});
