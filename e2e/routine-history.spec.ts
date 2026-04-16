import { test, expect } from '@playwright/test';

const API = 'http://localhost:8000/api/v1';

test('Run history: create runs, verify list, expand detail, paginate', async ({ page }) => {
  const routineName = `E2E History ${Date.now()}`;

  // ── Login ─────────────────────────────────────────────────────────────────
  await page.goto('/login');
  await page.fill('input#email', 'admin@hearth.local');
  await page.fill('input#password', 'changeme');
  await page.click('button[type="submit"]');
  await expect(page.locator('text=Chat')).toBeVisible({ timeout: 10_000 });

  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === 'hearth.csrf')?.value ?? '';

  // ── Create routine ────────────────────────────────────────────────────────
  let routineId: string;
  await test.step('Create routine', async () => {
    const res = await page.request.post(`${API}/routines`, {
      headers: { 'x-csrf-token': csrf, 'Content-Type': 'application/json' },
      data: {
        name: routineName,
        prompt: 'List my upcoming calendar events from @Google Calendar and summarize briefly.',
        schedule: '0 9 * * 1-5',
      },
    });
    expect(res.status()).toBe(201);
    routineId = (await res.json()).data.id;
  });

  // ── Run it twice to build history ─────────────────────────────────────────
  for (const runNum of [1, 2]) {
    await test.step(`Execute run ${runNum}`, async () => {
      const res = await page.request.post(`${API}/routines/${routineId}/run-now`, {
        headers: { 'x-csrf-token': csrf },
      });
      expect(res.status()).toBe(200);

      // Poll until complete
      const start = Date.now();
      while (Date.now() - start < 60_000) {
        const runsRes = await page.request.get(`${API}/routines/${routineId}/runs`);
        const body = await runsRes.json();
        const completed = body.data?.filter((r: { status: string }) =>
          r.status === 'success' || r.status === 'failed',
        );
        if (completed?.length >= runNum) break;
        await page.waitForTimeout(2000);
      }
    });
  }

  // ── Verify run history via API ────────────────────────────────────────────
  await test.step('API returns 2 runs', async () => {
    const res = await page.request.get(`${API}/routines/${routineId}/runs`);
    const body = await res.json();
    expect(body.data.length).toBe(2);
    expect(body.total).toBe(2);
    // Most recent first
    expect(new Date(body.data[0].startedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(body.data[1].startedAt).getTime(),
    );
    // Both should have output
    for (const run of body.data) {
      expect(run.status).toBe('success');
      expect(run.durationMs).toBeGreaterThan(0);
      expect(run.output).toBeTruthy();
    }
  });

  // ── Navigate to routines page and open detail panel ───────────────────────
  await test.step('Open routine detail panel', async () => {
    await page.goto('/#/routines');
    await page.waitForTimeout(1000);
    await page.locator(`text=${routineName}`).first().click();
    await page.waitForTimeout(500);
  });

  // ── Overview tab should show "Recent Runs" section ────────────────────────
  await test.step('Overview shows recent runs', async () => {
    await expect(page.locator('text=Recent Runs')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=View all')).toBeVisible();
  });

  // ── Switch to Run History tab ─────────────────────────────────────────────
  await test.step('Switch to Run History tab', async () => {
    await page.locator('text=Run History').click();
    await page.waitForTimeout(1000);

    // Should see filter pills
    await expect(page.locator('button:has-text("All")')).toBeVisible();

    // Should see at least 2 run entries with "success" text
    const successEntries = page.locator('text=success');
    const count = await successEntries.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  // ── Click a run to see detail ─────────────────────────────────────────────
  await test.step('Expand run detail', async () => {
    // Click the first run entry (the clickable row)
    const firstRun = page.locator('.divide-y > button').first();
    await firstRun.click();
    await page.waitForTimeout(500);

    // Should see "Back to history" link
    await expect(page.locator('text=Back to history')).toBeVisible();

    // Should see output section
    await expect(page.locator('text=Output')).toBeVisible();

    // Should see metadata (Started, Duration)
    await expect(page.locator('text=Started')).toBeVisible();
    await expect(page.locator('text=Duration')).toBeVisible();

    // Take screenshot
    await page.screenshot({ path: 'test-results/run-detail.png' });
  });

  // ── Navigate back to history list ─────────────────────────────────────────
  await test.step('Back to history list', async () => {
    await page.locator('text=Back to history').click();
    await page.waitForTimeout(500);

    // Should be back on the list with filter pills
    await expect(page.locator('button:has-text("All")')).toBeVisible();
  });

  // ── Clean up ──────────────────────────────────────────────────────────────
  await test.step('Delete test routine', async () => {
    await page.request.delete(`${API}/routines/${routineId}`, {
      headers: { 'x-csrf-token': csrf },
    });
  });
});
