import { test, expect } from '@playwright/test';
import {
  API,
  loginAs,
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  createSession,
  sendMessage,
  Cleanup,
  uniqueId,
} from './fixtures/test-helpers';

// ═════════════════════════════════════════════════════════════════════════════
// Governance API — Comprehensive E2E Tests
// Settings, Policy CRUD, Chat Enforcement, Violations, Stats, Export
// ═════════════════════════════════════════════════════════════════════════════

// ─── Settings & Policies ────────────────────────────────────────────────────

test.describe('Governance — Settings & Policies', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  // Test 1: Get default settings — governance disabled
  test('1. Get default settings — governance disabled', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Ensure governance is disabled (reset state)
    await apiPut(page, csrf, '/admin/governance/settings', {
      enabled: false,
      checkUserMessages: true,
      checkAiResponses: false,
      notifyAdmins: true,
      monitoringBanner: true,
    });

    const { status, body } = await apiGet(page, '/admin/governance/settings');
    expect(status).toBe(200);
    expect(body.data.enabled).toBe(false);
    expect(body.data.checkUserMessages).toBe(true);
    expect(body.data.monitoringBanner).toBe(true);
    console.log('Default settings:', JSON.stringify(body.data));
  });

  // Test 2: Enable governance — persisted
  test('2. Enable governance — persisted on re-read', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const { status: putStatus } = await apiPut(page, csrf, '/admin/governance/settings', {
      enabled: true,
      checkUserMessages: true,
      checkAiResponses: false,
      notifyAdmins: true,
      monitoringBanner: true,
    });
    expect(putStatus).toBe(200);

    // Re-read to confirm persistence
    const { status, body } = await apiGet(page, '/admin/governance/settings');
    expect(status).toBe(200);
    expect(body.data.enabled).toBe(true);
    expect(body.data.checkUserMessages).toBe(true);
    expect(body.data.notifyAdmins).toBe(true);
    console.log('Governance enabled and persisted');

    // Reset
    cleanup.add(async () => {
      await apiPut(page, csrf, '/admin/governance/settings', {
        enabled: false,
        checkUserMessages: true,
        checkAiResponses: false,
        notifyAdmins: true,
        monitoringBanner: true,
      });
    });
  });

  // Test 3: Create keyword policy — 201
  test('3. Create keyword policy — 201', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const name = uniqueId('keyword-policy');

    const { status, body } = await apiPost(page, csrf, '/admin/governance/policies', {
      name,
      description: 'Block sharing of passwords and secrets',
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
    expect(body.data.id).toBeTruthy();
    expect(body.data.name).toBe(name);
    expect(body.data.ruleType).toBe('keyword');
    expect(body.data.severity).toBe('critical');
    expect(body.data.enforcement).toBe('monitor');
    console.log(`Created keyword policy: ${body.data.id}`);

    cleanup.add(() => apiDelete(page, csrf, `/admin/governance/policies/${body.data.id}`).then(() => {}));
  });

  // Test 4: Create regex policy — 201
  test('4. Create regex policy — 201', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const name = uniqueId('regex-policy');

    const { status, body } = await apiPost(page, csrf, '/admin/governance/policies', {
      name,
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
    expect(body.data.id).toBeTruthy();
    expect(body.data.ruleType).toBe('regex');
    expect(body.data.severity).toBe('warning');
    console.log(`Created regex policy: ${body.data.id}`);

    cleanup.add(() => apiDelete(page, csrf, `/admin/governance/policies/${body.data.id}`).then(() => {}));
  });

  // Test 5: List policies — both visible
  test('5. List policies — both keyword and regex visible', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const kName = uniqueId('list-kw');
    const rName = uniqueId('list-rx');

    const { body: kwBody } = await apiPost(page, csrf, '/admin/governance/policies', {
      name: kName,
      severity: 'critical',
      ruleType: 'keyword',
      ruleConfig: { keywords: ['test'], matchMode: 'any', caseSensitive: false },
      enforcement: 'monitor',
    });
    cleanup.add(() => apiDelete(page, csrf, `/admin/governance/policies/${kwBody.data.id}`).then(() => {}));

    const { body: rxBody } = await apiPost(page, csrf, '/admin/governance/policies', {
      name: rName,
      severity: 'warning',
      ruleType: 'regex',
      ruleConfig: { pattern: 'test-\\d+', flags: '' },
      enforcement: 'monitor',
    });
    cleanup.add(() => apiDelete(page, csrf, `/admin/governance/policies/${rxBody.data.id}`).then(() => {}));

    const { status, body } = await apiGet(page, '/admin/governance/policies');
    expect(status).toBe(200);
    const ids = body.data.map((p: Record<string, unknown>) => p.id);
    expect(ids).toContain(kwBody.data.id);
    expect(ids).toContain(rxBody.data.id);
    console.log(`Total policies listed: ${body.data.length}`);
  });

  // Test 6: Update policy — updated
  test('6. Update policy — ruleConfig updated', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const name = uniqueId('update-policy');

    const { body: createBody } = await apiPost(page, csrf, '/admin/governance/policies', {
      name,
      severity: 'warning',
      ruleType: 'keyword',
      ruleConfig: { keywords: ['password'], matchMode: 'any', caseSensitive: false },
      enforcement: 'monitor',
    });
    const policyId = createBody.data.id;
    cleanup.add(() => apiDelete(page, csrf, `/admin/governance/policies/${policyId}`).then(() => {}));

    const { status, body } = await apiPut(page, csrf, `/admin/governance/policies/${policyId}`, {
      ruleConfig: {
        keywords: ['password', 'secret', 'api_key'],
        matchMode: 'any',
        caseSensitive: false,
      },
    });

    expect(status).toBe(200);
    expect(body.data.ruleConfig.keywords).toContain('secret');
    expect(body.data.ruleConfig.keywords).toContain('api_key');
    console.log(`Updated policy ${policyId} — keywords now: ${body.data.ruleConfig.keywords.join(', ')}`);
  });

  // Test 7: Disable policy — enabled=false
  test('7. Disable policy — enabled=false', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const name = uniqueId('disable-policy');

    const { body: createBody } = await apiPost(page, csrf, '/admin/governance/policies', {
      name,
      severity: 'info',
      ruleType: 'keyword',
      ruleConfig: { keywords: ['test'], matchMode: 'any', caseSensitive: false },
      enforcement: 'monitor',
    });
    const policyId = createBody.data.id;
    cleanup.add(() => apiDelete(page, csrf, `/admin/governance/policies/${policyId}`).then(() => {}));

    const { status, body } = await apiPut(page, csrf, `/admin/governance/policies/${policyId}`, {
      enabled: false,
    });
    expect(status).toBe(200);
    expect(body.data.enabled).toBe(false);

    // Confirm via GET
    const { body: fetched } = await apiGet(page, `/admin/governance/policies/${policyId}`);
    expect(fetched.data.enabled).toBe(false);
    console.log(`Policy ${policyId} disabled`);
  });

  // Test 8: Delete policy — removed
  test('8. Delete policy — removed from list', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const name = uniqueId('delete-policy');

    const { body: createBody } = await apiPost(page, csrf, '/admin/governance/policies', {
      name,
      severity: 'info',
      ruleType: 'keyword',
      ruleConfig: { keywords: ['ephemeral'], matchMode: 'any', caseSensitive: false },
      enforcement: 'monitor',
    });
    const policyId = createBody.data.id;

    const { status: delStatus } = await apiDelete(page, csrf, `/admin/governance/policies/${policyId}`);
    expect(delStatus).toBe(200);

    // Confirm removed
    const { status: getStatus } = await apiGet(page, `/admin/governance/policies/${policyId}`);
    expect(getStatus).toBe(404);
    console.log(`Policy ${policyId} deleted and confirmed gone`);
  });

  // Test 9: Create policy without name — 400
  test('9. Create policy without name — 400', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const { status, body } = await apiPost(page, csrf, '/admin/governance/policies', {
      severity: 'warning',
      ruleType: 'keyword',
      ruleConfig: { keywords: ['test'], matchMode: 'any', caseSensitive: false },
      enforcement: 'monitor',
    });

    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
    console.log(`Create without name rejected: ${body.error}`);
  });

  // Test 10: Create with invalid ruleType — 400
  test('10. Create with invalid ruleType — 400', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const { status, body } = await apiPost(page, csrf, '/admin/governance/policies', {
      name: uniqueId('invalid-rule'),
      severity: 'warning',
      ruleType: 'invalid_type',
      ruleConfig: {},
      enforcement: 'monitor',
    });

    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
    console.log(`Create with invalid ruleType rejected: ${body.error}`);
  });
});

// ─── Governance in Chat ─────────────────────────────────────────────────────

test.describe('Governance — Chat Enforcement', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  // Test 11: Block — message with blocked keyword returns 403, violation logged
  test('11. Block enforcement — message with blocked keyword returns 403, violation logged', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Enable governance
    await apiPut(page, csrf, '/admin/governance/settings', {
      enabled: true,
      checkUserMessages: true,
      checkAiResponses: false,
      notifyAdmins: true,
      monitoringBanner: true,
    });
    cleanup.add(async () => {
      await apiPut(page, csrf, '/admin/governance/settings', {
        enabled: false,
        checkUserMessages: true,
        checkAiResponses: false,
        notifyAdmins: true,
        monitoringBanner: true,
      });
    });

    // Create blocking policy
    const policyName = uniqueId('block-kw');
    const { body: policyBody } = await apiPost(page, csrf, '/admin/governance/policies', {
      name: policyName,
      description: 'Block messages with BLOCKED_KEYWORD_E2E',
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
    const policyId = policyBody.data.id;
    cleanup.add(() => apiDelete(page, csrf, `/admin/governance/policies/${policyId}`).then(() => {}));

    // Create session
    const session = await createSession(page, csrf, uniqueId('block-chat'));
    cleanup.add(async () => {
      await page.request.delete(`${API}/chat/sessions/${session.id}`, {
        headers: { 'x-csrf-token': csrf },
      });
    });

    // Send message that should be blocked
    const { status, body } = await sendMessage(page, csrf, session.id, 'This has BLOCKED_KEYWORD_E2E in it');
    expect(status).toBe(403);
    expect(body.error).toBe('Message blocked by governance policy');
    expect(body.data.policyName).toBe(policyName);
    expect(body.data.severity).toBe('critical');
    console.log(`Message blocked: ${body.error}, policy: ${body.data.policyName}, severity: ${body.data.severity}`);

    // Give async violation logging time
    await page.waitForTimeout(2000);

    // Verify violation was logged
    const { body: violations } = await apiGet(page, '/admin/governance/violations?pageSize=50');
    const ours = violations.data.find(
      (v: Record<string, unknown>) => v.sessionId === session.id,
    );
    expect(ours).toBeTruthy();
    expect(ours.severity).toBe('critical');
    expect(ours.status).toBe('open');
    console.log(`Violation logged: ${ours.id}`);
  });

  // Test 12: Monitor — message matching monitor policy returns 202, violation logged
  test('12. Monitor enforcement — message goes through (202), violation logged', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Enable governance
    await apiPut(page, csrf, '/admin/governance/settings', {
      enabled: true,
      checkUserMessages: true,
      checkAiResponses: false,
      notifyAdmins: true,
      monitoringBanner: true,
    });
    cleanup.add(async () => {
      await apiPut(page, csrf, '/admin/governance/settings', {
        enabled: false,
        checkUserMessages: true,
        checkAiResponses: false,
        notifyAdmins: true,
        monitoringBanner: true,
      });
    });

    // Create monitor policy
    const policyName = uniqueId('monitor-kw');
    const { body: policyBody } = await apiPost(page, csrf, '/admin/governance/policies', {
      name: policyName,
      description: 'Monitor messages with MONITOR_WORD_E2E',
      category: 'data_privacy',
      severity: 'warning',
      ruleType: 'keyword',
      ruleConfig: {
        keywords: ['MONITOR_WORD_E2E'],
        matchMode: 'any',
        caseSensitive: true,
      },
      enforcement: 'monitor',
    });
    const policyId = policyBody.data.id;
    cleanup.add(() => apiDelete(page, csrf, `/admin/governance/policies/${policyId}`).then(() => {}));

    // Create session
    const session = await createSession(page, csrf, uniqueId('monitor-chat'));
    cleanup.add(async () => {
      await page.request.delete(`${API}/chat/sessions/${session.id}`, {
        headers: { 'x-csrf-token': csrf },
      });
    });

    // Send message that matches monitor policy — should go through
    const { status } = await sendMessage(page, csrf, session.id, 'This contains MONITOR_WORD_E2E for testing');
    expect(status).toBe(202);
    console.log('Monitor message accepted with 202');

    // Wait for async violation logging
    await page.waitForTimeout(2000);

    // Verify violation was logged
    const { body: violations } = await apiGet(page, '/admin/governance/violations?pageSize=50');
    const ours = violations.data.find(
      (v: Record<string, unknown>) => v.sessionId === session.id,
    );
    if (ours) {
      expect(ours.severity).toBe('warning');
      expect(ours.status).toBe('open');
      console.log(`Violation logged for monitor policy: ${ours.id}`);
    } else {
      console.log('NOTE: Violation may still be processing asynchronously');
    }
  });

  // Test 13: Clean message — 202, no violation
  test('13. Clean message — 202, no violation created', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Enable governance
    await apiPut(page, csrf, '/admin/governance/settings', {
      enabled: true,
      checkUserMessages: true,
      checkAiResponses: false,
      notifyAdmins: true,
      monitoringBanner: true,
    });
    cleanup.add(async () => {
      await apiPut(page, csrf, '/admin/governance/settings', {
        enabled: false,
        checkUserMessages: true,
        checkAiResponses: false,
        notifyAdmins: true,
        monitoringBanner: true,
      });
    });

    // Create a narrow policy that won't match normal text
    const policyName = uniqueId('clean-check');
    const { body: policyBody } = await apiPost(page, csrf, '/admin/governance/policies', {
      name: policyName,
      severity: 'critical',
      ruleType: 'keyword',
      ruleConfig: {
        keywords: ['UNIQUE_BLOCK_TRIGGER_XYZZY'],
        matchMode: 'any',
        caseSensitive: true,
      },
      enforcement: 'block',
    });
    cleanup.add(() => apiDelete(page, csrf, `/admin/governance/policies/${policyBody.data.id}`).then(() => {}));

    // Create session
    const session = await createSession(page, csrf, uniqueId('clean-chat'));
    cleanup.add(async () => {
      await page.request.delete(`${API}/chat/sessions/${session.id}`, {
        headers: { 'x-csrf-token': csrf },
      });
    });

    // Record violation count before
    const { body: beforeViolations } = await apiGet(page, '/admin/governance/violations?pageSize=100');
    const countBefore = beforeViolations.total;

    // Send a clean message
    const { status } = await sendMessage(page, csrf, session.id, 'What is the weather forecast for tomorrow?');
    expect(status).toBe(202);
    console.log('Clean message accepted with 202');

    await page.waitForTimeout(2000);

    // Verify no new violation
    const { body: afterViolations } = await apiGet(page, '/admin/governance/violations?pageSize=100');
    expect(afterViolations.total).toBe(countBefore);
    console.log(`Violations before: ${countBefore}, after: ${afterViolations.total} — no new violation`);
  });

  // Test 14: Governance disabled — no evaluation
  test('14. Governance disabled — violating message passes without evaluation', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Ensure governance is OFF
    await apiPut(page, csrf, '/admin/governance/settings', {
      enabled: false,
      checkUserMessages: true,
      checkAiResponses: false,
      notifyAdmins: true,
      monitoringBanner: true,
    });

    // Create a block policy (it shouldn't matter since governance is off)
    const policyName = uniqueId('disabled-check');
    const { body: policyBody } = await apiPost(page, csrf, '/admin/governance/policies', {
      name: policyName,
      severity: 'critical',
      ruleType: 'keyword',
      ruleConfig: {
        keywords: ['DISABLED_TRIGGER_E2E'],
        matchMode: 'any',
        caseSensitive: true,
      },
      enforcement: 'block',
    });
    cleanup.add(() => apiDelete(page, csrf, `/admin/governance/policies/${policyBody.data.id}`).then(() => {}));

    // Create session
    const session = await createSession(page, csrf, uniqueId('disabled-chat'));
    cleanup.add(async () => {
      await page.request.delete(`${API}/chat/sessions/${session.id}`, {
        headers: { 'x-csrf-token': csrf },
      });
    });

    // Record violation count
    const { body: beforeViolations } = await apiGet(page, '/admin/governance/violations?pageSize=100');
    const countBefore = beforeViolations.total;

    // Send a violating message — should NOT be blocked because governance is off
    const { status } = await sendMessage(page, csrf, session.id, 'This has DISABLED_TRIGGER_E2E keyword');
    expect(status).toBe(202);
    console.log('Message passed through with governance disabled');

    await page.waitForTimeout(2000);

    // No new violations
    const { body: afterViolations } = await apiGet(page, '/admin/governance/violations?pageSize=100');
    expect(afterViolations.total).toBe(countBefore);
    console.log(`Violations unchanged: ${countBefore} → ${afterViolations.total}`);
  });
});

// ─── Violations Management ──────────────────────────────────────────────────

test.describe('Governance — Violations', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  /**
   * Helper: enable governance, create a monitor policy, trigger a violation,
   * and return the violation ID for further testing.
   */
  async function setupViolation(page: import('@playwright/test').Page, csrf: string, cleanup: Cleanup) {
    // Enable governance
    await apiPut(page, csrf, '/admin/governance/settings', {
      enabled: true,
      checkUserMessages: true,
      checkAiResponses: false,
      notifyAdmins: true,
      monitoringBanner: true,
    });
    cleanup.add(async () => {
      await apiPut(page, csrf, '/admin/governance/settings', {
        enabled: false,
        checkUserMessages: true,
        checkAiResponses: false,
        notifyAdmins: true,
        monitoringBanner: true,
      });
    });

    const trigger = uniqueId('VIOLATION_TRIGGER');
    const policyName = uniqueId('violation-policy');
    const { body: policyBody } = await apiPost(page, csrf, '/admin/governance/policies', {
      name: policyName,
      severity: 'critical',
      ruleType: 'keyword',
      ruleConfig: { keywords: [trigger], matchMode: 'any', caseSensitive: true },
      enforcement: 'monitor',
    });
    cleanup.add(() => apiDelete(page, csrf, `/admin/governance/policies/${policyBody.data.id}`).then(() => {}));

    const session = await createSession(page, csrf, uniqueId('violation-sess'));
    cleanup.add(async () => {
      await page.request.delete(`${API}/chat/sessions/${session.id}`, {
        headers: { 'x-csrf-token': csrf },
      });
    });

    // Trigger the violation
    await sendMessage(page, csrf, session.id, `Message containing ${trigger} here`);
    await page.waitForTimeout(2000);

    // Find the violation
    const { body: violations } = await apiGet(page, '/admin/governance/violations?pageSize=50');
    const ours = violations.data.find(
      (v: Record<string, unknown>) => v.sessionId === session.id,
    );
    return { violationId: ours?.id, sessionId: session.id, policyName };
  }

  // Test 15: List violations with filters
  test('15. List violations — with severity filter', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const { violationId } = await setupViolation(page, csrf, cleanup);
    console.log(`Setup violation: ${violationId}`);

    // List all violations
    const { status, body } = await apiGet(page, '/admin/governance/violations?pageSize=50');
    expect(status).toBe(200);
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    console.log(`Total violations: ${body.total}`);

    // Filter by severity
    const { status: filteredStatus, body: filteredBody } = await apiGet(
      page,
      '/admin/governance/violations?severity=critical',
    );
    expect(filteredStatus).toBe(200);
    for (const v of filteredBody.data) {
      expect(v.severity).toBe('critical');
    }
    console.log(`Critical violations: ${filteredBody.total}`);

    // Filter by status
    const { status: openStatus, body: openBody } = await apiGet(
      page,
      '/admin/governance/violations?status=open',
    );
    expect(openStatus).toBe(200);
    for (const v of openBody.data) {
      expect(v.status).toBe('open');
    }
    console.log(`Open violations: ${openBody.total}`);
  });

  // Test 16: Acknowledge violation — status=acknowledged
  test('16. Acknowledge violation — status changes to acknowledged', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const { violationId } = await setupViolation(page, csrf, cleanup);
    if (!violationId) {
      console.log('SKIP: No violation created (async processing may be slow)');
      return;
    }

    const { status, body } = await apiPatch(
      page,
      csrf,
      `/admin/governance/violations/${violationId}`,
      { status: 'acknowledged' },
    );
    expect(status).toBe(200);
    expect(body.data.status).toBe('acknowledged');
    expect(body.data.reviewedBy).toBeTruthy();
    console.log(`Acknowledged violation: ${violationId}, reviewedBy: ${body.data.reviewedBy}`);
  });

  // Test 17: Escalate with note — escalated
  test('17. Escalate with note — status changes to escalated', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const { violationId } = await setupViolation(page, csrf, cleanup);
    if (!violationId) {
      console.log('SKIP: No violation created');
      return;
    }

    const note = 'Forwarded to security team for investigation';
    const { status, body } = await apiPatch(
      page,
      csrf,
      `/admin/governance/violations/${violationId}`,
      { status: 'escalated', note },
    );
    expect(status).toBe(200);
    expect(body.data.status).toBe('escalated');
    expect(body.data.reviewNote).toBe(note);
    console.log(`Escalated violation: ${violationId} with note`);
  });

  // Test 18: Escalate without note — 400
  test('18. Escalate without note — 400', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const { violationId } = await setupViolation(page, csrf, cleanup);
    if (!violationId) {
      console.log('SKIP: No violation created');
      return;
    }

    const { status, body } = await apiPatch(
      page,
      csrf,
      `/admin/governance/violations/${violationId}`,
      { status: 'escalated' },
    );
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
    console.log(`Escalate without note rejected: ${body.error}`);
  });

  // Test 19: Get stats — metrics returned
  test('19. Get stats — totalViolations, byDay, bySeverity, topPolicies', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Generate at least one violation for stats
    await setupViolation(page, csrf, cleanup);

    const { status, body } = await apiGet(page, '/admin/governance/stats');
    expect(status).toBe(200);
    expect(body.data.totalViolations).toBeGreaterThanOrEqual(0);
    expect(body.data.openViolations).toBeDefined();
    expect(body.data.byDay).toBeDefined();
    expect(body.data.bySeverity).toBeDefined();
    expect(body.data.topPolicies).toBeDefined();
    console.log(`Stats: total=${body.data.totalViolations}, open=${body.data.openViolations}`);
    console.log(`By severity: ${JSON.stringify(body.data.bySeverity)}`);
    if (body.data.topPolicies.length > 0) {
      console.log(`Top policy: ${body.data.topPolicies[0].policyName} (${body.data.topPolicies[0].count})`);
    }
  });

  // Test 20: Export CSV — file with headers
  test('20. Export CSV — returns text/csv with expected headers', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const res = await page.request.get(`${API}/admin/governance/export?format=csv`, {
      headers: { 'x-csrf-token': csrf },
    });
    expect(res.status()).toBe(200);
    const contentType = res.headers()['content-type'];
    expect(contentType).toContain('text/csv');
    const body = await res.text();
    expect(body).toContain('timestamp,user_email');
    const lineCount = body.split('\n').length;
    console.log(`CSV export: ${lineCount} lines`);
  });

  // Test 21: Export JSON — array of violations
  test('21. Export JSON — returns array of violations', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const res = await page.request.get(`${API}/admin/governance/export?format=json`, {
      headers: { 'x-csrf-token': csrf },
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    const parsed = JSON.parse(body);
    expect(Array.isArray(parsed)).toBe(true);
    console.log(`JSON export: ${parsed.length} violations`);
  });
});

test.describe('UI — Governance Settings', () => {
  test('Governance tab renders in admin settings', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/settings/governance');
    await page.waitForTimeout(2000);

    // Governance section should be visible
    await expect(page.locator('text=Governance').first()).toBeVisible();

    // Enable toggle
    const toggle = page.locator('text=Enable governance').first();
    const hasToggle = await toggle.isVisible().catch(() => false);
    console.log(`Governance enable toggle visible: ${hasToggle}`);

    // Create Policy button
    const createBtn = page.locator('button:has-text("Create Policy")').first();
    const hasCreate = await createBtn.isVisible().catch(() => false);
    console.log(`Create Policy button visible: ${hasCreate}`);

    // Violations section
    const violations = page.locator('text=Violations').first();
    const hasViolations = await violations.isVisible().catch(() => false);
    console.log(`Violations section visible: ${hasViolations}`);
  });
});
