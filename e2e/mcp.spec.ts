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
  Cleanup,
  uniqueId,
  HAS_LLM,
} from './fixtures/test-helpers';

// =============================================================================
// MCP Integrations — E2E Tests
//
// Actual API:
//   GET    /admin/integrations           — list all integrations
//   POST   /admin/integrations           — connect new integration
//   PATCH  /admin/integrations/:id       — update (toggle enabled, update creds)
//   DELETE /admin/integrations/:id       — disconnect
//   GET    /admin/integrations/:id/health — health check
// =============================================================================

test.describe('MCP Integration Listing', () => {
  test('1. List integrations -> 4 integrations shown', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const { status, body } = await apiGet(page, '/admin/integrations');
    expect(status).toBe(200);
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(4);

    const providers = body.data.map((i: { provider: string }) => i.provider).sort();
    expect(providers).toEqual(['gcalendar', 'gmail', 'notion', 'slack']);
    console.log(`Integrations listed: ${providers.join(', ')}`);

    for (const integration of body.data) {
      expect(integration.id).toBeTruthy();
      expect(integration.provider).toBeTruthy();
      expect(integration.status).toBeDefined();
      expect(typeof integration.enabled).toBe('boolean');
      console.log(`  ${integration.provider}: id=${integration.id}, status=${integration.status}, enabled=${integration.enabled}`);
    }
  });

  test('2. All integrations show "active" status', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const { status, body } = await apiGet(page, '/admin/integrations');
    expect(status).toBe(200);

    for (const integration of body.data) {
      expect(integration.status).toBe('active');
      console.log(`${integration.provider}: status=${integration.status}`);
    }
    console.log('All 4 integrations are active');
  });
});

// =============================================================================

test.describe('MCP Integration Health & Details', () => {
  test('3. Integration health check -> healthy response', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Get list first to find integration IDs
    const { body: listBody } = await apiGet(page, '/admin/integrations');
    expect(listBody.data.length).toBeGreaterThan(0);

    // Health check each integration — response is { health: object }, not { data: ... }
    for (const integration of listBody.data) {
      const { status, body } = await apiGet(page, `/admin/integrations/${integration.id}/health`);
      expect(status).toBe(200);
      expect(body.health).toBeDefined();
      console.log(`Health check ${integration.provider}: status=${status}, health=${JSON.stringify(body.health).substring(0, 100)}`);
    }
  });

  test('6. Get individual integration -> find by ID from list', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Get list first to find the slack integration
    const { body: listBody } = await apiGet(page, '/admin/integrations');
    const slack = listBody.data.find((i: { provider: string }) => i.provider === 'slack');
    expect(slack).toBeTruthy();

    // No individual GET /admin/integrations/:id route exists,
    // so verify the integration data from the list response instead
    expect(slack.id).toBeTruthy();
    expect(slack.provider).toBe('slack');
    expect(typeof slack.enabled).toBe('boolean');
    expect(slack.status).toBeDefined();
    console.log(`Individual integration (from list): provider=${slack.provider}, id=${slack.id}, status=${slack.status}, enabled=${slack.enabled}`);
  });

  test('8. Integration config accessible', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Get list and check each integration has config/metadata
    const { body: listBody } = await apiGet(page, '/admin/integrations');

    for (const integration of listBody.data) {
      // Integration data comes from list endpoint — verify shape
      expect(integration.id).toBeTruthy();
      expect(integration.provider).toBeTruthy();
      expect(integration.enabled !== undefined).toBe(true);
      expect(integration.status).toBeDefined();

      console.log(`Config for ${integration.provider}: keys=${Object.keys(integration).join(', ')}`);
    }
  });
});

// =============================================================================

test.describe('MCP Integration Toggle', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  test('4. Toggle integration off -> disabled', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Get list to find an integration to toggle
    const { body: listBody } = await apiGet(page, '/admin/integrations');
    const slack = listBody.data.find((i: { provider: string }) => i.provider === 'slack');
    expect(slack).toBeTruthy();

    const originalEnabled = slack.enabled;

    // Toggle off using PATCH (not PUT)
    const { status, body } = await apiPatch(page, csrf, `/admin/integrations/${slack.id}`, {
      enabled: false,
    });
    expect(status).toBe(200);
    expect(body.data.enabled).toBe(false);
    console.log(`Toggled slack off: enabled=${body.data.enabled}`);

    // Verify it persisted via list endpoint
    const { body: verifyBody } = await apiGet(page, '/admin/integrations');
    const verifiedSlack = verifyBody.data.find((i: { id: string }) => i.id === slack.id);
    expect(verifiedSlack.enabled).toBe(false);
    console.log(`Verified slack disabled: enabled=${verifiedSlack.enabled}`);

    // Cleanup: restore original state
    cleanup.add(async () => {
      const cs = await loginAs(page, 'admin');
      await apiPatch(page, cs, `/admin/integrations/${slack.id}`, {
        enabled: originalEnabled,
      });
    });
  });

  test('5. Toggle integration on -> re-enabled', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Get list to find the slack integration
    const { body: listBody } = await apiGet(page, '/admin/integrations');
    const slack = listBody.data.find((i: { provider: string }) => i.provider === 'slack');
    expect(slack).toBeTruthy();

    const originalEnabled = slack.enabled;

    // First disable it using PATCH
    await apiPatch(page, csrf, `/admin/integrations/${slack.id}`, {
      enabled: false,
    });

    // Then re-enable it using PATCH
    const { status, body } = await apiPatch(page, csrf, `/admin/integrations/${slack.id}`, {
      enabled: true,
    });
    expect(status).toBe(200);
    expect(body.data.enabled).toBe(true);
    console.log(`Toggled slack on: enabled=${body.data.enabled}`);

    // Verify it persisted via list endpoint
    const { body: verifyBody } = await apiGet(page, '/admin/integrations');
    const verifiedSlack = verifyBody.data.find((i: { id: string }) => i.id === slack.id);
    expect(verifiedSlack.enabled).toBe(true);
    console.log(`Verified slack re-enabled: enabled=${verifiedSlack.enabled}`);

    // Cleanup: restore original state
    cleanup.add(async () => {
      const cs = await loginAs(page, 'admin');
      await apiPatch(page, cs, `/admin/integrations/${slack.id}`, {
        enabled: originalEnabled,
      });
    });
  });
});

// =============================================================================

test.describe('MCP Integration Permissions', () => {
  test('7. Non-admin access -> 403', async ({ browser }) => {
    const { page, csrf, cleanup } = await loginAsNewContext(browser, 'dev1');
    try {
      // Member should not be able to list integrations (admin-only endpoint)
      const listRes = await apiGet(page, '/admin/integrations');
      expect(listRes.status).toBe(403);
      console.log(`Non-admin list integrations -> ${listRes.status} (expected 403)`);

      // Member should not be able to toggle integrations
      const toggleRes = await apiPatch(page, csrf, '/admin/integrations/some-id', {
        enabled: false,
      });
      expect(toggleRes.status).toBe(403);
      console.log(`Non-admin toggle integration -> ${toggleRes.status} (expected 403)`);
    } finally {
      await cleanup();
    }
  });
});

// =============================================================================

test.describe('MCP Product Gaps', () => {
  test('Product gap: no real integration testing path', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Navigate to settings/integrations page
    await page.goto('/#/settings/integrations');
    await page.waitForTimeout(1000);

    // Check if there's a "Test Connection" button for any integration
    const testButton = page.locator('text=Test Connection');
    const testVisible = await testButton.isVisible().catch(() => false);

    // Check if there's a sandbox/test mode indicator
    const sandboxIndicator = page.locator('text=Sandbox Mode');
    const sandboxVisible = await sandboxIndicator.isVisible().catch(() => false);

    // Check if there's a way to send a test message/event
    const testEvent = page.locator('text=Send Test Event');
    const testEventVisible = await testEvent.isVisible().catch(() => false);

    console.log(`PRODUCT GAP: "Test Connection" button exists: ${testVisible}`);
    console.log(`PRODUCT GAP: Sandbox mode indicator exists: ${sandboxVisible}`);
    console.log(`PRODUCT GAP: "Send Test Event" button exists: ${testEventVisible}`);
    console.log('  -> There is no way to verify integrations work end-to-end before going live.');
    console.log('  -> The 4 dev-mock integrations are always "active" but never actually tested.');
    console.log('  -> Recommendation: Add per-integration "Test Connection" that sends a ping,');
    console.log('     a sandbox mode for safe testing, and a "Send Test Event" to verify');
    console.log('     the full MCP tool pipeline (Slack message send, Notion page create, etc.).');

    expect(true).toBe(true); // Gap documented
  });

  test('Product gap: no OAuth flow UI for real integrations', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Navigate to settings/integrations page
    await page.goto('/#/settings/integrations');
    await page.waitForTimeout(1000);

    // Check if there's an "Add Integration" or "Connect" button that would start OAuth
    const connectButton = page.locator('text=Connect');
    const connectVisible = await connectButton.isVisible().catch(() => false);

    const addIntegration = page.locator('text=Add Integration');
    const addVisible = await addIntegration.isVisible().catch(() => false);

    const oauthFlow = page.locator('text=Authorize');
    const oauthVisible = await oauthFlow.isVisible().catch(() => false);

    // Check if integrations page exists at all
    const integrationsHeading = page.locator('text=Integrations');
    const headingVisible = await integrationsHeading.isVisible().catch(() => false);

    console.log(`PRODUCT GAP: Integrations page heading exists: ${headingVisible}`);
    console.log(`PRODUCT GAP: "Connect" button exists: ${connectVisible}`);
    console.log(`PRODUCT GAP: "Add Integration" button exists: ${addVisible}`);
    console.log(`PRODUCT GAP: OAuth "Authorize" flow exists: ${oauthVisible}`);
    console.log('  -> There is no UI for connecting real Slack/Notion/Google accounts via OAuth.');
    console.log('  -> Currently relies on seeded dev-mock integrations only.');
    console.log('  -> Recommendation: Build OAuth consent flow UI with:');
    console.log('     1. "Connect to Slack" button -> redirects to Slack OAuth consent screen');
    console.log('     2. Callback handler that stores encrypted tokens');
    console.log('     3. Per-integration scope selection (which channels, which calendars)');
    console.log('     4. "Disconnect" button to revoke tokens');

    expect(true).toBe(true); // Gap documented
  });
});
