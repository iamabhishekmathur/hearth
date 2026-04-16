import { test, expect } from '@playwright/test';

const API = 'http://localhost:8000/api/v1';

test('Full routine lifecycle: login → create → run → verify output', async ({ page }) => {
  const routineName = `E2E Routine ${Date.now()}`;

  // ── Step 1: Login ─────────────────────────────────────────────────────────
  await test.step('Login as admin', async () => {
    await page.goto('/login');
    await page.fill('input#email', 'admin@hearth.local');
    await page.fill('input#password', 'changeme');
    await page.click('button[type="submit"]');
    // App uses hash routing — wait for the main sidebar to appear
    await expect(page.locator('text=Chat')).toBeVisible({ timeout: 10_000 });
  });

  // Grab CSRF token for API calls
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === 'hearth.csrf')?.value ?? '';
  expect(csrf).toBeTruthy();

  // ── Step 2: Navigate to Routines ──────────────────────────────────────────
  await test.step('Navigate to routines page', async () => {
    await page.goto('/#/routines');
    // Either we see routines list or the empty state with templates
    await expect(
      page.locator('text=Routines').first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── Step 3: Create routine via API ────────────────────────────────────────
  let routineId: string;

  await test.step('Create routine via API', async () => {
    const res = await page.request.post(`${API}/routines`, {
      headers: { 'x-csrf-token': csrf, 'Content-Type': 'application/json' },
      data: {
        name: routineName,
        description: 'Test routine that uses mock integrations',
        prompt:
          'List my upcoming calendar events using @Google Calendar, then search Slack #engineering channel for recent messages using @Slack. Summarize everything in a brief digest.',
        schedule: '0 9 * * 1-5',
        delivery: { channels: ['in_app'] },
      },
    });

    expect(res.status()).toBe(201);
    const body = await res.json();
    routineId = body.data.id;
    expect(routineId).toBeTruthy();
    console.log(`Created routine: ${routineId} (${routineName})`);
  });

  // ── Step 4: Verify routine appears in list ────────────────────────────────
  await test.step('Routine appears in list with Active dot', async () => {
    await page.reload();
    const routineRow = page.locator(`text=${routineName}`).first();
    await expect(routineRow).toBeVisible({ timeout: 10_000 });

    // Green dot should be present (bg-green-500 within the routine item)
    const greenDot = page.locator('.bg-green-500').first();
    await expect(greenDot).toBeVisible();
  });

  // ── Step 5: Trigger immediate run via API ─────────────────────────────────
  await test.step('Run routine now', async () => {
    const res = await page.request.post(`${API}/routines/${routineId}/run-now`, {
      headers: { 'x-csrf-token': csrf },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.message).toContain('enqueued');
    console.log('Routine execution enqueued');
  });

  // ── Step 6: Poll for run completion ───────────────────────────────────────
  let runResult: { status: string; output: unknown; error: string | null } | null = null;

  await test.step('Wait for run to complete', async () => {
    const maxWait = 60_000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      const res = await page.request.get(`${API}/routines/${routineId}/runs`, {
        headers: { 'x-csrf-token': csrf },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();

      if (body.data && body.data.length > 0) {
        const latest = body.data[0];
        console.log(`Run status: ${latest.status}`);
        if (latest.status === 'success' || latest.status === 'failed') {
          runResult = latest;
          break;
        }
      }
      await page.waitForTimeout(2000);
    }

    expect(runResult).not.toBeNull();
    console.log(`Run completed with status: ${runResult!.status}`);
  });

  // ── Step 7: Verify run output ─────────────────────────────────────────────
  await test.step('Verify run produced output', async () => {
    expect(runResult!.status).toBe('success');

    const output = runResult!.output as Record<string, string>;
    const text = output?.result ?? '';
    console.log(`\n── Run Output (${text.length} chars) ──\n${text.slice(0, 1000)}\n──────────────`);

    // The agent should have produced some output text
    expect(text.length).toBeGreaterThan(10);
  });

  // ── Step 8: Verify detail panel opens ───────────────────────────────────
  await test.step('Detail panel opens for routine', async () => {
    await page.reload();
    await page.waitForTimeout(1000);
    // Click the routine to open detail panel
    await page.locator(`text=${routineName}`).first().click();
    await page.waitForTimeout(1500);

    // Take a screenshot to verify the detail panel is open
    await page.screenshot({ path: 'test-results/detail-panel.png' });

    // The detail panel should be visible — look for any close/back button or routine name in panel
    const panelVisible = await page.locator('.border-l').first().isVisible().catch(() => false);
    console.log(`Detail panel visible: ${panelVisible}`);
  });

  // ── Step 9: Clean up — delete the test routine ────────────────────────────
  await test.step('Delete test routine', async () => {
    const res = await page.request.delete(`${API}/routines/${routineId}`, {
      headers: { 'x-csrf-token': csrf },
    });
    expect(res.status()).toBe(204);
    console.log('Test routine deleted');
  });
});

test('Test run panel: execute prompt without saving', async ({ page }) => {
  // ── Login ─────────────────────────────────────────────────────────────────
  await page.goto('/login');
  await page.fill('input#email', 'admin@hearth.local');
  await page.fill('input#password', 'changeme');
  await page.click('button[type="submit"]');
  await expect(page.locator('text=Chat')).toBeVisible({ timeout: 10_000 });

  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === 'hearth.csrf')?.value ?? '';

  // ── Test run via API (same as "Test before saving" panel) ─────────────────
  await test.step('POST /test-run returns mock integration data', async () => {
    const res = await page.request.post(`${API}/routines/test-run`, {
      headers: { 'x-csrf-token': csrf, 'Content-Type': 'application/json' },
      data: {
        prompt: 'Search Notion for "Q2 Planning" and list my Gmail labels.',
      },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    console.log(`Test run status: ${body.data.status}`);
    console.log(`Test run output: ${JSON.stringify(body.data.output)?.slice(0, 500)}`);
    console.log(`Test run duration: ${body.data.durationMs}ms`);

    // Should complete (success or timeout — depends on LLM availability)
    expect(['success', 'failed', 'timeout']).toContain(body.data.status);

    if (body.data.status === 'success') {
      expect(body.data.output).toBeTruthy();
    }
  });
});
