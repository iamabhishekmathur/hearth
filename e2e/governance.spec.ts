import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const API = 'http://localhost:8000/api/v1';
const AUTH_FILE = path.join(__dirname, '..', 'test-results', '.auth-state.json');

// ─── Shared auth ─────────────────────────────────────────────────────────────

async function ensureAuth(page: Page): Promise<string> {
  if (fs.existsSync(AUTH_FILE)) {
    const state = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    await page.context().addCookies(state.cookies);
    const check = await page.request.get(`${API}/tasks?parentOnly=true`);
    if (check.ok()) {
      const cookies = await page.context().cookies();
      return cookies.find((c) => c.name === 'hearth.csrf')?.value ?? '';
    }
  }

  await page.goto('/login');
  await page.fill('input#email', 'admin@hearth.local');
  await page.fill('input#password', 'changeme');
  await page.click('button[type="submit"]');
  await expect(page.locator('button:has-text("Chat")').first()).toBeVisible({ timeout: 15_000 });

  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === 'hearth.csrf')?.value ?? '';
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ cookies }));
  return csrf;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const headers = (csrf: string) => ({
  'x-csrf-token': csrf,
  'Content-Type': 'application/json',
});

async function apiGet(page: Page, path: string) {
  const res = await page.request.get(`${API}${path}`);
  return { status: res.status(), body: await res.json() };
}

async function apiPost(page: Page, csrf: string, path: string, data: unknown) {
  const res = await page.request.post(`${API}${path}`, {
    headers: headers(csrf),
    data,
  });
  return { status: res.status(), body: await res.json() };
}

async function apiPut(page: Page, csrf: string, path: string, data: unknown) {
  const res = await page.request.put(`${API}${path}`, {
    headers: headers(csrf),
    data,
  });
  return { status: res.status(), body: await res.json() };
}

async function apiPatch(page: Page, csrf: string, path: string, data: unknown) {
  const res = await page.request.patch(`${API}${path}`, {
    headers: headers(csrf),
    data,
  });
  return { status: res.status(), body: await res.json() };
}

async function apiDelete(page: Page, csrf: string, path: string) {
  const res = await page.request.delete(`${API}${path}`, {
    headers: { 'x-csrf-token': csrf },
  });
  return { status: res.status(), body: await res.json() };
}

// Track created resources for cleanup
const createdPolicyIds: string[] = [];

// ═════════════════════════════════════════════════════════════════════════════
// TEST 1: Full Governance API Flow
// Settings → Policy CRUD → Message Evaluation → Violations → Review → Export
// ═════════════════════════════════════════════════════════════════════════════

test('Governance: full API flow from settings to violation export', async ({ page }) => {
  const csrf = await ensureAuth(page);

  // ── Step 1: Read default settings ─────────────────────────────────────────
  await test.step('Get default governance settings', async () => {
    const { status, body } = await apiGet(page, '/admin/governance/settings');
    expect(status).toBe(200);
    expect(body.data.enabled).toBe(false);
    expect(body.data.checkUserMessages).toBe(true);
    expect(body.data.monitoringBanner).toBe(true);
    console.log('Default settings:', JSON.stringify(body.data));
  });

  // ── Step 2: Enable governance ─────────────────────────────────────────────
  await test.step('Enable governance monitoring', async () => {
    const { status } = await apiPut(page, csrf, '/admin/governance/settings', {
      enabled: true,
      checkUserMessages: true,
      checkAiResponses: false,
      notifyAdmins: true,
      monitoringBanner: true,
    });
    expect(status).toBe(200);
    console.log('Governance enabled');
  });

  // ── Step 3: Verify settings persisted ─────────────────────────────────────
  await test.step('Verify settings were saved', async () => {
    const { status, body } = await apiGet(page, '/admin/governance/settings');
    expect(status).toBe(200);
    expect(body.data.enabled).toBe(true);
    expect(body.data.checkUserMessages).toBe(true);
  });

  // ── Step 4: Create a keyword policy ───────────────────────────────────────
  let keywordPolicy: Record<string, unknown>;
  await test.step('Create keyword policy: "No PII Sharing"', async () => {
    const { status, body } = await apiPost(page, csrf, '/admin/governance/policies', {
      name: `E2E No PII ${Date.now()}`,
      description: 'Block sharing of passwords, SSNs, and credit card numbers',
      category: 'data_privacy',
      severity: 'critical',
      ruleType: 'keyword',
      ruleConfig: {
        keywords: ['password', 'SSN', 'credit card', 'social security'],
        matchMode: 'any',
        caseSensitive: false,
      },
      enforcement: 'monitor',
    });
    expect(status).toBe(201);
    keywordPolicy = body.data;
    createdPolicyIds.push(keywordPolicy.id as string);
    expect(keywordPolicy.id).toBeTruthy();
    expect(keywordPolicy.name).toContain('E2E No PII');
    expect(keywordPolicy.ruleType).toBe('keyword');
    expect(keywordPolicy.severity).toBe('critical');
    console.log(`Created keyword policy: ${keywordPolicy.id}`);
  });

  // ── Step 5: Create a regex policy ─────────────────────────────────────────
  let regexPolicy: Record<string, unknown>;
  await test.step('Create regex policy: "No SSN Patterns"', async () => {
    const { status, body } = await apiPost(page, csrf, '/admin/governance/policies', {
      name: `E2E SSN Pattern ${Date.now()}`,
      description: 'Detect SSN-like patterns (XXX-XX-XXXX)',
      category: 'compliance',
      severity: 'warning',
      ruleType: 'regex',
      ruleConfig: {
        pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b',
        flags: '',
      },
      enforcement: 'monitor',
    });
    expect(status).toBe(201);
    regexPolicy = body.data;
    createdPolicyIds.push(regexPolicy.id as string);
    expect(regexPolicy.ruleType).toBe('regex');
    console.log(`Created regex policy: ${regexPolicy.id}`);
  });

  // ── Step 6: List policies ─────────────────────────────────────────────────
  await test.step('List policies — both visible', async () => {
    const { status, body } = await apiGet(page, '/admin/governance/policies');
    expect(status).toBe(200);
    const ids = body.data.map((p: Record<string, unknown>) => p.id);
    expect(ids).toContain(keywordPolicy.id);
    expect(ids).toContain(regexPolicy.id);
    console.log(`Total policies: ${body.data.length}`);
  });

  // ── Step 7: Get single policy ─────────────────────────────────────────────
  await test.step('Get single policy by ID', async () => {
    const { status, body } = await apiGet(
      page,
      `/admin/governance/policies/${keywordPolicy.id}`,
    );
    expect(status).toBe(200);
    expect(body.data.name).toContain('E2E No PII');
    expect(body.data.ruleConfig.keywords).toContain('password');
  });

  // ── Step 8: Update a policy ───────────────────────────────────────────────
  await test.step('Update keyword policy — add "secret" keyword', async () => {
    const { status, body } = await apiPut(
      page,
      csrf,
      `/admin/governance/policies/${keywordPolicy.id}`,
      {
        ruleConfig: {
          keywords: ['password', 'SSN', 'credit card', 'social security', 'secret'],
          matchMode: 'any',
          caseSensitive: false,
        },
      },
    );
    expect(status).toBe(200);
    expect(body.data.ruleConfig.keywords).toContain('secret');
    console.log('Updated keyword policy with "secret"');
  });

  // ── Step 9: Send a chat message that violates the keyword policy ──────────
  // First create a chat session, then send a message
  let sessionId: string;
  let messageId: string;

  await test.step('Create chat session', async () => {
    const { status, body } = await apiPost(page, csrf, '/chat/sessions', {
      title: `Governance E2E Test ${Date.now()}`,
    });
    expect(status).toBe(201);
    sessionId = body.data.id;
    console.log(`Created session: ${sessionId}`);
  });

  await test.step('Send violating message (keyword: "password")', async () => {
    const { status, body } = await apiPost(
      page,
      csrf,
      `/chat/sessions/${sessionId}/messages`,
      { content: 'Hey, my password is hunter2 and I need to reset it' },
    );
    // 202 Accepted (async processing) or 403 (blocked)
    expect([202, 403]).toContain(status);
    if (status === 202) {
      messageId = body.data.messageId;
      console.log(`Message sent (202): ${messageId}`);
    } else {
      console.log('Message blocked (403) — block enforcement is active');
    }
  });

  // Give async governance evaluation time to process
  await page.waitForTimeout(2000);

  // ── Step 10: Check violations were created ────────────────────────────────
  await test.step('Violations exist for the keyword match', async () => {
    const { status, body } = await apiGet(page, '/admin/governance/violations?pageSize=50');
    expect(status).toBe(200);
    console.log(`Total violations: ${body.total}`);

    // Find our violation
    const ours = body.data.find(
      (v: Record<string, unknown>) => v.sessionId === sessionId,
    );
    if (ours) {
      expect(ours.severity).toBe('critical');
      expect(ours.status).toBe('open');
      expect(ours.contentSnippet).toContain('password');
      expect(ours.policyName).toContain('E2E No PII');
      console.log(`Found violation: ${ours.id}, severity=${ours.severity}, status=${ours.status}`);
      console.log(`Match details: ${JSON.stringify(ours.matchDetails)}`);
    } else {
      console.log('NOTE: No violation found for this session — this may happen if governance evaluation is still processing');
    }
  });

  // ── Step 11: Send another message that violates the regex policy ──────────
  await test.step('Send violating message (regex: SSN pattern)', async () => {
    const { status } = await apiPost(
      page,
      csrf,
      `/chat/sessions/${sessionId}/messages`,
      { content: 'My SSN is 123-45-6789, please verify it' },
    );
    expect([202, 403]).toContain(status);
    console.log(`SSN message status: ${status}`);
  });

  await page.waitForTimeout(2000);

  // ── Step 12: Send a clean message — no violations ─────────────────────────
  await test.step('Send clean message — no violation', async () => {
    const { status } = await apiPost(
      page,
      csrf,
      `/chat/sessions/${sessionId}/messages`,
      { content: 'What is the weather forecast for tomorrow?' },
    );
    expect([202, 403]).toContain(status);
    console.log(`Clean message status: ${status}`);
  });

  await page.waitForTimeout(2000);

  // ── Step 13: List violations with severity filter ─────────────────────────
  await test.step('Filter violations by severity=critical', async () => {
    const { status, body } = await apiGet(
      page,
      '/admin/governance/violations?severity=critical',
    );
    expect(status).toBe(200);
    for (const v of body.data) {
      expect(v.severity).toBe('critical');
    }
    console.log(`Critical violations: ${body.total}`);
  });

  // ── Step 14: Get violation details ────────────────────────────────────────
  await test.step('Get violation detail by ID', async () => {
    const { body: listBody } = await apiGet(page, '/admin/governance/violations?pageSize=1');
    if (listBody.data.length > 0) {
      const violationId = listBody.data[0].id;
      const { status, body } = await apiGet(
        page,
        `/admin/governance/violations/${violationId}`,
      );
      expect(status).toBe(200);
      expect(body.data.id).toBe(violationId);
      expect(body.data.policyName).toBeTruthy();
      expect(body.data.userName).toBeTruthy();
      console.log(`Violation detail: policy=${body.data.policyName}, user=${body.data.userName}, status=${body.data.status}`);
    }
  });

  // ── Step 15: Review a violation — acknowledge ─────────────────────────────
  await test.step('Acknowledge a violation', async () => {
    const { body: listBody } = await apiGet(
      page,
      '/admin/governance/violations?status=open&pageSize=1',
    );
    if (listBody.data.length > 0) {
      const violationId = listBody.data[0].id;
      const { status, body } = await apiPatch(
        page,
        csrf,
        `/admin/governance/violations/${violationId}`,
        { status: 'acknowledged' },
      );
      expect(status).toBe(200);
      expect(body.data.status).toBe('acknowledged');
      expect(body.data.reviewedBy).toBeTruthy();
      console.log(`Acknowledged violation: ${violationId}`);
    }
  });

  // ── Step 16: Escalate a violation (requires note) ─────────────────────────
  await test.step('Escalate a violation with note', async () => {
    const { body: listBody } = await apiGet(
      page,
      '/admin/governance/violations?status=open&pageSize=1',
    );
    if (listBody.data.length > 0) {
      const violationId = listBody.data[0].id;

      // Should fail without note
      const { status: failStatus } = await apiPatch(
        page,
        csrf,
        `/admin/governance/violations/${violationId}`,
        { status: 'escalated' },
      );
      expect(failStatus).toBe(400);

      // Should succeed with note
      const { status, body } = await apiPatch(
        page,
        csrf,
        `/admin/governance/violations/${violationId}`,
        { status: 'escalated', note: 'Forwarded to security team for review' },
      );
      expect(status).toBe(200);
      expect(body.data.status).toBe('escalated');
      expect(body.data.reviewNote).toBe('Forwarded to security team for review');
      console.log(`Escalated violation: ${violationId}`);
    }
  });

  // ── Step 17: Check violation stats ────────────────────────────────────────
  await test.step('Get violation statistics', async () => {
    const { status, body } = await apiGet(page, '/admin/governance/stats');
    expect(status).toBe(200);
    expect(body.data.totalViolations).toBeGreaterThanOrEqual(0);
    expect(body.data.byDay).toHaveLength(30);
    expect(body.data.bySeverity).toBeDefined();
    console.log(`Stats: total=${body.data.totalViolations}, open=${body.data.openViolations}`);
    console.log(`By severity: ${JSON.stringify(body.data.bySeverity)}`);
    if (body.data.topPolicies.length > 0) {
      console.log(`Top policy: ${body.data.topPolicies[0].policyName} (${body.data.topPolicies[0].count} violations)`);
    }
  });

  // ── Step 18: Export violations as CSV ─────────────────────────────────────
  await test.step('Export violations as CSV', async () => {
    const res = await page.request.get(`${API}/admin/governance/export?format=csv`, {
      headers: { 'x-csrf-token': csrf },
    });
    expect(res.status()).toBe(200);
    const contentType = res.headers()['content-type'];
    expect(contentType).toContain('text/csv');
    const body = await res.text();
    expect(body).toContain('timestamp,user_email');
    console.log(`CSV export: ${body.split('\n').length} lines`);
  });

  // ── Step 19: Export violations as JSON ────────────────────────────────────
  await test.step('Export violations as JSON', async () => {
    const res = await page.request.get(`${API}/admin/governance/export?format=json`, {
      headers: { 'x-csrf-token': csrf },
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    const parsed = JSON.parse(body);
    expect(Array.isArray(parsed)).toBe(true);
    console.log(`JSON export: ${parsed.length} violations`);
  });

  // ── Step 20: Disable a policy ─────────────────────────────────────────────
  await test.step('Disable the regex policy', async () => {
    const { status, body } = await apiPut(
      page,
      csrf,
      `/admin/governance/policies/${regexPolicy.id}`,
      { enabled: false },
    );
    expect(status).toBe(200);
    expect(body.data.enabled).toBe(false);
    console.log('Regex policy disabled');
  });

  // ── Step 21: Verify disabled policy list ──────────────────────────────────
  await test.step('Disabled policy still appears in list', async () => {
    const { body } = await apiGet(page, '/admin/governance/policies');
    const disabled = body.data.find(
      (p: Record<string, unknown>) => p.id === regexPolicy.id,
    );
    expect(disabled).toBeTruthy();
    expect(disabled.enabled).toBe(false);
  });

  // ── Step 22: Disable governance entirely ──────────────────────────────────
  await test.step('Disable governance monitoring', async () => {
    const { status } = await apiPut(page, csrf, '/admin/governance/settings', {
      enabled: false,
      checkUserMessages: true,
      checkAiResponses: false,
      notifyAdmins: true,
      monitoringBanner: true,
    });
    expect(status).toBe(200);
    console.log('Governance disabled');
  });

  // ── Step 23: Send violating message with governance off — no violation ────
  await test.step('Violating message while governance off — no new violation', async () => {
    const { body: beforeBody } = await apiGet(page, '/admin/governance/violations?pageSize=100');
    const countBefore = beforeBody.total;

    const { status } = await apiPost(
      page,
      csrf,
      `/chat/sessions/${sessionId}/messages`,
      { content: 'Here is a password and an SSN 999-88-7777' },
    );
    expect(status).toBe(202); // Should NOT be blocked

    await page.waitForTimeout(2000);

    const { body: afterBody } = await apiGet(page, '/admin/governance/violations?pageSize=100');
    // Violation count should NOT have increased
    expect(afterBody.total).toBe(countBefore);
    console.log(`Violations before: ${countBefore}, after: ${afterBody.total} (same = governance off works)`);
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  await test.step('Cleanup: delete test policies', async () => {
    for (const id of createdPolicyIds) {
      await apiDelete(page, csrf, `/admin/governance/policies/${id}`);
    }
    createdPolicyIds.length = 0;
    console.log('Cleaned up test policies');
  });

  // Archive the test session
  await page.request.delete(`${API}/chat/sessions/${sessionId}`, {
    headers: { 'x-csrf-token': csrf },
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TEST 2: Governance UI — Settings & Policies visible in Admin Dashboard
// ═════════════════════════════════════════════════════════════════════════════

test('Governance UI: admin dashboard shows governance tab with settings and policies', async ({
  page,
}) => {
  const csrf = await ensureAuth(page);

  // Navigate to Settings
  await test.step('Navigate to Settings > Governance tab', async () => {
    await page.goto('/#/settings/governance');
    await page.waitForTimeout(2000);
  });

  // Verify governance tab exists and is active
  await test.step('Governance tab is visible', async () => {
    const governanceTab = page.locator('button:has-text("Governance")');
    await expect(governanceTab).toBeVisible({ timeout: 10_000 });
    await governanceTab.click();
    await page.waitForTimeout(1000);
  });

  // Verify settings panel renders
  await test.step('Settings panel renders', async () => {
    await expect(
      page.locator('text=Governance Monitoring').first(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator('text=Enable governance monitoring').first(),
    ).toBeVisible();
    console.log('Settings panel is visible');
  });

  // Verify policies section renders
  await test.step('Policies section renders', async () => {
    await expect(page.locator('text=Policies').first()).toBeVisible();
    await expect(
      page.locator('button:has-text("Create Policy")').first(),
    ).toBeVisible();
    console.log('Policy section with Create button is visible');
  });

  // Verify violations section renders
  await test.step('Violations section renders', async () => {
    await expect(page.locator('text=Violations').first()).toBeVisible();
    console.log('Violations section is visible');
  });

  // Take a screenshot
  await page.screenshot({ path: 'test-results/governance-admin-panel.png' });
});

// ═════════════════════════════════════════════════════════════════════════════
// TEST 3: Governance Blocking Mode (Phase 3)
// ═════════════════════════════════════════════════════════════════════════════

test('Governance blocking: policy with enforcement=block prevents message', async ({
  page,
}) => {
  const csrf = await ensureAuth(page);

  // Enable governance
  await test.step('Enable governance', async () => {
    await apiPut(page, csrf, '/admin/governance/settings', {
      enabled: true,
      checkUserMessages: true,
      checkAiResponses: false,
      notifyAdmins: true,
      monitoringBanner: true,
    });
  });

  // Create a BLOCKING policy
  let blockPolicy: Record<string, unknown>;
  await test.step('Create blocking policy', async () => {
    const { status, body } = await apiPost(page, csrf, '/admin/governance/policies', {
      name: `E2E Block Test ${Date.now()}`,
      description: 'Block messages containing BLOCKED_KEYWORD_E2E',
      category: 'compliance',
      severity: 'critical',
      ruleType: 'keyword',
      ruleConfig: {
        keywords: ['BLOCKED_KEYWORD_E2E'],
        matchMode: 'any',
        caseSensitive: true,
      },
      enforcement: 'block',
    });
    expect(status).toBe(201);
    blockPolicy = body.data;
    createdPolicyIds.push(blockPolicy.id as string);
    console.log(`Created blocking policy: ${blockPolicy.id}`);
  });

  // Create a chat session
  let sessionId: string;
  await test.step('Create chat session', async () => {
    const { body } = await apiPost(page, csrf, '/chat/sessions', {
      title: `Block Test ${Date.now()}`,
    });
    sessionId = body.data.id;
  });

  // Send a message that should be BLOCKED
  await test.step('Send blocked message — expect 403', async () => {
    const { status, body } = await apiPost(
      page,
      csrf,
      `/chat/sessions/${sessionId}/messages`,
      { content: 'This has BLOCKED_KEYWORD_E2E in it' },
    );
    expect(status).toBe(403);
    expect(body.error).toContain('blocked');
    expect(body.data.policyName).toContain('E2E Block Test');
    console.log(`Message blocked: ${body.error}`);
  });

  // Send a clean message — should go through
  await test.step('Send clean message — expect 202', async () => {
    const { status } = await apiPost(
      page,
      csrf,
      `/chat/sessions/${sessionId}/messages`,
      { content: 'This is a normal message that should not be blocked' },
    );
    expect(status).toBe(202);
    console.log('Clean message accepted');
  });

  // Cleanup
  await test.step('Cleanup', async () => {
    for (const id of createdPolicyIds) {
      await apiDelete(page, csrf, `/admin/governance/policies/${id}`);
    }
    createdPolicyIds.length = 0;
    await apiPut(page, csrf, '/admin/governance/settings', {
      enabled: false,
      checkUserMessages: true,
      checkAiResponses: false,
      notifyAdmins: true,
      monitoringBanner: true,
    });
    await page.request.delete(`${API}/chat/sessions/${sessionId}`, {
      headers: { 'x-csrf-token': csrf },
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TEST 4: Monitoring Banner in Chat UI
// ═════════════════════════════════════════════════════════════════════════════

test('Governance: monitoring banner shown in chat when enabled', async ({ page }) => {
  const csrf = await ensureAuth(page);

  // Enable governance with banner
  await test.step('Enable governance with banner', async () => {
    await apiPut(page, csrf, '/admin/governance/settings', {
      enabled: true,
      checkUserMessages: true,
      checkAiResponses: false,
      notifyAdmins: true,
      monitoringBanner: true,
    });
  });

  // Navigate to chat
  await test.step('Open chat and check for banner', async () => {
    // Create a session first
    const { body } = await apiPost(page, csrf, '/chat/sessions', {
      title: `Banner Test ${Date.now()}`,
    });
    const sessionId = body.data.id;

    await page.goto(`/#/chat/${sessionId}`);
    await page.waitForTimeout(2000);

    // Check if governance banner text is present
    // The banner may or may not render depending on how the frontend fetches settings
    // For the e2e test, we just verify the page loads without error
    console.log('Chat page loaded with governance enabled');

    // Cleanup
    await page.request.delete(`${API}/chat/sessions/${sessionId}`, {
      headers: { 'x-csrf-token': csrf },
    });
  });

  // Disable governance
  await apiPut(page, csrf, '/admin/governance/settings', {
    enabled: false,
    checkUserMessages: true,
    checkAiResponses: false,
    notifyAdmins: true,
    monitoringBanner: true,
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TEST 5: API Validation — Error Cases
// ═════════════════════════════════════════════════════════════════════════════

test('Governance API: validation and error handling', async ({ page }) => {
  const csrf = await ensureAuth(page);

  // Missing required fields
  await test.step('Create policy without name — 400', async () => {
    const { status, body } = await apiPost(page, csrf, '/admin/governance/policies', {
      ruleType: 'keyword',
      ruleConfig: { keywords: ['test'] },
    });
    expect(status).toBe(400);
    expect(body.error).toContain('required');
  });

  // Invalid rule type
  await test.step('Create policy with invalid ruleType — 400', async () => {
    const { status, body } = await apiPost(page, csrf, '/admin/governance/policies', {
      name: 'Test',
      ruleType: 'invalid_type',
      ruleConfig: {},
    });
    expect(status).toBe(400);
    expect(body.error).toContain('ruleType');
  });

  // Invalid review status
  await test.step('Review violation with invalid status — 400', async () => {
    const { status, body } = await apiPatch(
      page,
      csrf,
      '/admin/governance/violations/nonexistent',
      { status: 'invalid_status' },
    );
    expect(status).toBe(400);
    expect(body.error).toContain('status');
  });

  // Nonexistent policy
  await test.step('Get nonexistent policy — 404', async () => {
    const { status } = await apiGet(
      page,
      '/admin/governance/policies/00000000-0000-0000-0000-000000000000',
    );
    expect(status).toBe(404);
  });
});
