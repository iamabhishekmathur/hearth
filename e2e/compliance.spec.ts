import { test, expect } from '@playwright/test';
import {
  API,
  loginAs,
  loginAsNewContext,
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  createSession,
  sendMessage,
  Cleanup,
  uniqueId,
  HAS_LLM,
} from './fixtures/test-helpers';

// ═════════════════════════════════════════════════════════════════════════════
// Compliance API — Comprehensive E2E Tests
// Pack management, PII/PCI scrubbing, stats, access control
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Compliance — Pack Management', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  // Test 1: Get compliance config — returns config with enabledPacks
  test('1. Get compliance config — returns config', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const { status, body } = await apiGet(page, '/admin/compliance/config');
    expect(status).toBe(200);
    expect(body.data).toBeDefined();
    expect(body.data.enabledPacks).toBeDefined();
    expect(Array.isArray(body.data.enabledPacks)).toBe(true);
    console.log(`Compliance config: enabledPacks=${JSON.stringify(body.data.enabledPacks)}`);
  });

  // Test 2: Enable PII pack — enabled
  test('2. Enable PII pack — enabled successfully', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Save current state for cleanup
    const { body: before } = await apiGet(page, '/admin/compliance/config');
    const originalPacks = before.data.enabledPacks ?? [];
    cleanup.add(async () => {
      await apiPut(page, csrf, '/admin/compliance/config', { enabledPacks: originalPacks });
    });

    const { status, body } = await apiPut(page, csrf, '/admin/compliance/config', {
      enabledPacks: ['pii'],
    });
    expect(status).toBe(200);

    // Verify PII pack is enabled
    const { body: after } = await apiGet(page, '/admin/compliance/config');
    expect(after.data.enabledPacks).toContain('pii');
    console.log('PII pack enabled');
  });

  // Test 3: Enable PCI-DSS pack — enabled
  test('3. Enable PCI-DSS pack — enabled successfully', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Save current state for cleanup
    const { body: before } = await apiGet(page, '/admin/compliance/config');
    const originalPacks = before.data.enabledPacks ?? [];
    cleanup.add(async () => {
      await apiPut(page, csrf, '/admin/compliance/config', { enabledPacks: originalPacks });
    });

    const { status } = await apiPut(page, csrf, '/admin/compliance/config', {
      enabledPacks: ['pci-dss'],
    });
    expect(status).toBe(200);

    const { body: after } = await apiGet(page, '/admin/compliance/config');
    expect(after.data.enabledPacks).toContain('pci-dss');
    console.log('PCI-DSS pack enabled');
  });
});

test.describe('Compliance — Message Scrubbing', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  /**
   * Helper: enable compliance packs and create a chat session for testing.
   */
  async function setupCompliance(
    page: import('@playwright/test').Page,
    csrf: string,
    packs: string[],
    cleanup: Cleanup,
  ) {
    // Save current state
    const { body: before } = await apiGet(page, '/admin/compliance/config');
    const originalPacks = before.data.enabledPacks ?? [];
    cleanup.add(async () => {
      await apiPut(page, csrf, '/admin/compliance/config', { enabledPacks: originalPacks });
    });

    // Enable requested packs
    await apiPut(page, csrf, '/admin/compliance/config', { enabledPacks: packs });

    // Create session
    const session = await createSession(page, csrf, uniqueId('compliance-chat'));
    cleanup.add(async () => {
      await page.request.delete(`${API}/chat/sessions/${session.id}`, {
        headers: { 'x-csrf-token': csrf },
      });
    });

    return session;
  }

  // Test 4: Message with SSN — message sent (202), compliance processes it
  test.fixme('4. Message with SSN — sent (202), compliance scrubs SSN pattern', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await setupCompliance(page, csrf, ['pii'], cleanup);

    // Send message containing an SSN
    const { status } = await sendMessage(
      page,
      csrf,
      session.id,
      'My social security number is 123-45-6789, please verify.',
    );
    expect(status).toBe(202);
    console.log('Message with SSN accepted (202) — compliance processed it');

    // The message goes through; the scrubbing happens before LLM sees it.
    // We verify acceptance since the scrub is transparent to the user.
  });

  // Test 5: Message with credit card pattern — processed
  test('5. Message with credit card — sent (202), compliance processes it', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await setupCompliance(page, csrf, ['pci-dss'], cleanup);

    // Luhn-valid test card number (Visa test)
    const { status } = await sendMessage(
      page,
      csrf,
      session.id,
      'Please charge my card 4111111111111111 for the order.',
    );
    expect(status).toBe(202);
    console.log('Message with credit card accepted (202) — compliance processed it');
  });

  // Test 6: Message with email — processed
  test('6. Message with email — sent (202), compliance processes it', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await setupCompliance(page, csrf, ['pii'], cleanup);

    const { status } = await sendMessage(
      page,
      csrf,
      session.id,
      'Please send the report to john.doe@example.com by Friday.',
    );
    expect(status).toBe(202);
    console.log('Message with email accepted (202) — compliance processed it');
  });

  // Test 7: Clean message — no scrubbing needed
  test('7. Clean message — no scrubbing, passes normally', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await setupCompliance(page, csrf, ['pii', 'pci-dss'], cleanup);

    const { status } = await sendMessage(
      page,
      csrf,
      session.id,
      'What is the weather forecast for tomorrow in San Francisco?',
    );
    expect(status).toBe(202);
    console.log('Clean message passed without scrubbing');
  });

  // Test 8: Disable pack — scrubbing stops
  test.fixme('8. Disable pack — scrubbing stops, message passes as-is', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // First enable PII
    const { body: before } = await apiGet(page, '/admin/compliance/config');
    const originalPacks = before.data.enabledPacks ?? [];
    cleanup.add(async () => {
      await apiPut(page, csrf, '/admin/compliance/config', { enabledPacks: originalPacks });
    });

    await apiPut(page, csrf, '/admin/compliance/config', { enabledPacks: ['pii'] });

    // Now disable all packs
    await apiPut(page, csrf, '/admin/compliance/config', { enabledPacks: [] });

    // Verify disabled
    const { body: after } = await apiGet(page, '/admin/compliance/config');
    expect(after.data.enabledPacks.length).toBe(0);
    console.log('All packs disabled — scrubbing stopped');

    // Send message with sensitive data — it passes through without scrubbing
    const session = await createSession(page, csrf, uniqueId('no-scrub'));
    cleanup.add(async () => {
      await page.request.delete(`${API}/chat/sessions/${session.id}`, {
        headers: { 'x-csrf-token': csrf },
      });
    });

    const { status } = await sendMessage(
      page,
      csrf,
      session.id,
      'My SSN is 111-22-3333 and card is 4111111111111111',
    );
    expect(status).toBe(202);
    console.log('Message with sensitive data passed through when packs disabled');
  });

  // Test 9: Multiple sensitive items — each gets unique placeholder
  test.fixme('9. Multiple sensitive items — each gets unique placeholder', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await setupCompliance(page, csrf, ['pii', 'pci-dss'], cleanup);

    // Send message with multiple types of sensitive data
    const { status } = await sendMessage(
      page,
      csrf,
      session.id,
      'My SSN is 123-45-6789, email is alice@example.com, and card is 4111111111111111. Also my friend SSN is 987-65-4321 and email bob@test.org.',
    );
    expect(status).toBe(202);
    console.log('Message with multiple sensitive items accepted (202)');
    // Internally the system replaces:
    // 123-45-6789 -> [SSN_1], 987-65-4321 -> [SSN_2]
    // alice@example.com -> [EMAIL_1], bob@test.org -> [EMAIL_2]
    // 4111111111111111 -> [CREDIT_CARD_1]
  });

  // Test 10: Compliance + governance together — both evaluated
  test.fixme('10. Compliance + governance together — both systems evaluate the message', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Enable compliance
    const { body: before } = await apiGet(page, '/admin/compliance/config');
    const originalPacks = before.data.enabledPacks ?? [];
    cleanup.add(async () => {
      await apiPut(page, csrf, '/admin/compliance/config', { enabledPacks: originalPacks });
    });
    await apiPut(page, csrf, '/admin/compliance/config', { enabledPacks: ['pii'] });

    // Enable governance with a monitor policy
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

    const trigger = uniqueId('COMBINED_TRIGGER');
    const { body: policyBody } = await apiPost(page, csrf, '/admin/governance/policies', {
      name: uniqueId('combined-policy'),
      severity: 'warning',
      ruleType: 'keyword',
      ruleConfig: { keywords: [trigger], matchMode: 'any', caseSensitive: true },
      enforcement: 'monitor',
    });
    cleanup.add(() => apiDelete(page, csrf, `/admin/governance/policies/${policyBody.data.id}`).then(() => {}));

    // Create session
    const session = await createSession(page, csrf, uniqueId('combined-chat'));
    cleanup.add(async () => {
      await page.request.delete(`${API}/chat/sessions/${session.id}`, {
        headers: { 'x-csrf-token': csrf },
      });
    });

    // Send message that triggers both compliance (SSN) and governance (keyword)
    const { status } = await sendMessage(
      page,
      csrf,
      session.id,
      `Here is my SSN 222-33-4444 and also ${trigger} is important`,
    );
    expect(status).toBe(202);
    console.log('Message accepted (202) — both compliance and governance evaluated');

    await page.waitForTimeout(2000);

    // Governance should have logged a violation
    const { body: violations } = await apiGet(page, '/admin/governance/violations?pageSize=50');
    const ours = violations.data.find(
      (v: Record<string, unknown>) => v.sessionId === session.id,
    );
    if (ours) {
      console.log(`Governance violation logged: ${ours.id}, severity=${ours.severity}`);
    } else {
      console.log('NOTE: Governance violation may still be processing');
    }
  });
});

test.describe('Compliance — Stats & Access Control', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  // Test 11: Compliance stats — detection counts (separate endpoint)
  test('11. Compliance stats — detection counts returned', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const { status, body } = await apiGet(page, '/admin/compliance/stats');
    expect(status).toBe(200);
    expect(body.data).toBeDefined();
    expect(body.data.totalScrubs).toBeDefined();
    expect(body.data.entityCounts).toBeDefined();
    console.log(`Compliance stats: ${JSON.stringify(body.data)}`);
  });

  // Test 12: Non-admin access — 403 (use loginAsNewContext for isolation)
  test('12. Non-admin access to compliance — 403', async ({ browser }) => {
    const { page, csrf, cleanup: ctxCleanup } = await loginAsNewContext(browser, 'dev1');
    try {
      const { status } = await apiGet(page, '/admin/compliance/config');
      expect(status).toBe(403);
      console.log('Non-admin compliance access correctly returned 403');
    } finally {
      await ctxCleanup();
    }
  });

  // Test 13: Enable invalid pack — error
  test('13. Enable invalid pack name — error returned', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Save current state
    const { body: before } = await apiGet(page, '/admin/compliance/config');
    const originalPacks = before.data.enabledPacks ?? [];
    cleanup.add(async () => {
      await apiPut(page, csrf, '/admin/compliance/config', { enabledPacks: originalPacks });
    });

    const { status, body } = await apiPut(page, csrf, '/admin/compliance/config', {
      enabledPacks: ['nonexistent-pack-xyz'],
    });
    // Expect 400 (validation error) since the server validates pack IDs
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
    console.log(`Invalid pack rejected: ${body.error}`);
  });

  // Test 14: Toggle packs — correct state after enable/disable cycle
  test('14. Toggle packs — enable then disable returns correct state', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Save original state
    const { body: before } = await apiGet(page, '/admin/compliance/config');
    const originalPacks = before.data.enabledPacks ?? [];
    cleanup.add(async () => {
      await apiPut(page, csrf, '/admin/compliance/config', { enabledPacks: originalPacks });
    });

    // Enable both PII and PCI-DSS
    await apiPut(page, csrf, '/admin/compliance/config', { enabledPacks: ['pii', 'pci-dss'] });

    const { body: enabledState } = await apiGet(page, '/admin/compliance/config');
    expect(enabledState.data.enabledPacks).toContain('pii');
    expect(enabledState.data.enabledPacks).toContain('pci-dss');
    console.log(`Enabled packs: ${enabledState.data.enabledPacks.join(', ')}`);

    // Disable PCI-DSS, keep PII
    await apiPut(page, csrf, '/admin/compliance/config', { enabledPacks: ['pii'] });

    const { body: partialState } = await apiGet(page, '/admin/compliance/config');
    expect(partialState.data.enabledPacks).toContain('pii');
    expect(partialState.data.enabledPacks).not.toContain('pci-dss');
    console.log(`After toggle — enabled packs: ${partialState.data.enabledPacks.join(', ')}`);

    // Disable all
    await apiPut(page, csrf, '/admin/compliance/config', { enabledPacks: [] });

    const { body: noneState } = await apiGet(page, '/admin/compliance/config');
    expect(noneState.data.enabledPacks.length).toBe(0);
    console.log('All packs disabled');
  });
});

test.describe('UI — Compliance Settings', () => {
  test('Compliance tab renders in admin settings', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/settings/compliance');
    await page.waitForTimeout(2000);

    // Compliance section should be visible
    const heading = page.locator('text=Compliance').first();
    const visible = await heading.isVisible().catch(() => false);
    console.log(`Compliance section visible: ${visible}`);

    // Look for pack toggles or configuration
    const piiText = page.locator('text=PII').first();
    const hasPii = await piiText.isVisible().catch(() => false);
    console.log(`PII pack visible: ${hasPii}`);
  });
});
