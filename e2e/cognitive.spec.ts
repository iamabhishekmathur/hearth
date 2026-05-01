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
// Cognitive Profiles / Digital Co-Worker — E2E Tests
//
// Admin config lives at /admin/cognitive/settings (GET + PUT)
// User opt-in/out lives at /chat/cognitive-profile/status (GET + PUT)
// =============================================================================

test.describe('Cognitive Admin Config', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  test('1. Get cognitive config -> returns settings', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const { status, body } = await apiGet(page, '/admin/cognitive/settings');
    expect(status).toBe(200);
    expect(body.data).toBeDefined();
    expect(typeof body.data.enabled).toBe('boolean');
    console.log(`Cognitive config: enabled=${body.data.enabled}`);
  });

  test('2. Enable org-wide cognitive -> persisted', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Save original for cleanup
    const { body: orig } = await apiGet(page, '/admin/cognitive/settings');
    const originalEnabled = orig.data.enabled;
    cleanup.add(async () => {
      const cs = await loginAs(page, 'admin');
      await apiPut(page, cs, '/admin/cognitive/settings', { enabled: originalEnabled });
    });

    // Enable cognitive org-wide
    const putRes = await apiPut(page, csrf, '/admin/cognitive/settings', { enabled: true });
    expect(putRes.status).toBe(200);
    expect(putRes.body.message).toBeTruthy();
    console.log(`Enable cognitive: ${putRes.status}, message=${putRes.body.message}`);

    // Verify it persisted
    const { status, body } = await apiGet(page, '/admin/cognitive/settings');
    expect(status).toBe(200);
    expect(body.data.enabled).toBe(true);
    console.log(`Cognitive config after enable: enabled=${body.data.enabled}`);
  });

  test('3. Disable org-wide cognitive -> persisted', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Save original for cleanup
    const { body: orig } = await apiGet(page, '/admin/cognitive/settings');
    const originalEnabled = orig.data.enabled;
    cleanup.add(async () => {
      const cs = await loginAs(page, 'admin');
      await apiPut(page, cs, '/admin/cognitive/settings', { enabled: originalEnabled });
    });

    // First enable, then disable
    await apiPut(page, csrf, '/admin/cognitive/settings', { enabled: true });
    const putRes = await apiPut(page, csrf, '/admin/cognitive/settings', { enabled: false });
    expect(putRes.status).toBe(200);
    expect(putRes.body.message).toBeTruthy();
    console.log(`Disable cognitive: ${putRes.status}, message=${putRes.body.message}`);

    // Verify it persisted
    const { status, body } = await apiGet(page, '/admin/cognitive/settings');
    expect(status).toBe(200);
    expect(body.data.enabled).toBe(false);
    console.log(`Cognitive config after disable: enabled=${body.data.enabled}`);
  });

  test('10. Non-admin toggle cognitive -> 403', async ({ browser }) => {
    const { page, csrf, cleanup: ctxCleanup } = await loginAsNewContext(browser, 'dev1');
    try {
      const { status } = await apiPut(page, csrf, '/admin/cognitive/settings', {
        enabled: true,
      });
      expect(status).toBe(403);
      console.log(`Non-admin toggle cognitive -> ${status} (expected 403)`);
    } finally {
      await ctxCleanup();
    }
  });
});

// =============================================================================

test.describe('Cognitive Profile (User Opt-In/Out)', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  test('4. Get own cognitive profile status -> returns opt-in data', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Ensure cognitive is enabled org-wide first
    await apiPut(page, csrf, '/admin/cognitive/settings', { enabled: true });
    cleanup.add(async () => {
      const cs = await loginAs(page, 'admin');
      await apiPut(page, cs, '/admin/cognitive/settings', { enabled: false });
    });

    const { status, body } = await apiGet(page, '/chat/cognitive-profile/status');
    expect(status).toBe(200);
    expect(body.data).toBeDefined();
    expect(typeof body.data.orgEnabled).toBe('boolean');
    expect(typeof body.data.userEnabled).toBe('boolean');
    console.log(`Cognitive profile status: orgEnabled=${body.data.orgEnabled}, userEnabled=${body.data.userEnabled}`);
  });

  test('5. User opt-out -> userEnabled becomes false', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Ensure cognitive is enabled org-wide
    await apiPut(page, csrf, '/admin/cognitive/settings', { enabled: true });
    cleanup.add(async () => {
      const cs = await loginAs(page, 'admin');
      await apiPut(page, cs, '/admin/cognitive/settings', { enabled: false });
    });

    // Login as dev1 for opt-out
    const dev1Csrf = await loginAs(page, 'dev1');

    // Opt out via PUT with enabled: false
    const optOutRes = await apiPut(page, dev1Csrf, '/chat/cognitive-profile/status', { enabled: false });
    expect(optOutRes.status).toBe(200);
    expect(optOutRes.body.message).toBeTruthy();
    console.log(`User opt-out: ${optOutRes.status}, message=${optOutRes.body.message}`);

    // Verify status shows disabled
    const { status, body } = await apiGet(page, '/chat/cognitive-profile/status');
    expect(status).toBe(200);
    expect(body.data.userEnabled).toBe(false);
    console.log(`Profile after opt-out: userEnabled=${body.data.userEnabled}`);

    // Cleanup: opt back in
    cleanup.add(async () => {
      const cs = await loginAs(page, 'dev1');
      await apiPut(page, cs, '/chat/cognitive-profile/status', { enabled: true });
    });
  });

  test('6. User opt-in -> userEnabled becomes true', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Ensure cognitive is enabled org-wide
    await apiPut(page, csrf, '/admin/cognitive/settings', { enabled: true });
    cleanup.add(async () => {
      const cs = await loginAs(page, 'admin');
      await apiPut(page, cs, '/admin/cognitive/settings', { enabled: false });
    });

    // Login as dev1 for opt-in/out
    const dev1Csrf = await loginAs(page, 'dev1');

    // First opt out, then opt back in
    await apiPut(page, dev1Csrf, '/chat/cognitive-profile/status', { enabled: false });
    const optInRes = await apiPut(page, dev1Csrf, '/chat/cognitive-profile/status', { enabled: true });
    expect(optInRes.status).toBe(200);
    expect(optInRes.body.message).toBeTruthy();
    console.log(`User opt-in: ${optInRes.status}, message=${optInRes.body.message}`);

    // Verify status shows enabled
    const { status, body } = await apiGet(page, '/chat/cognitive-profile/status');
    expect(status).toBe(200);
    expect(body.data.userEnabled).toBe(true);
    console.log(`Profile after opt-in: userEnabled=${body.data.userEnabled}`);
  });

  test('11. Cognitive status when org disables cognitive', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Ensure cognitive is disabled org-wide
    await apiPut(page, csrf, '/admin/cognitive/settings', { enabled: false });

    // Check user status — orgEnabled should be false
    const { status, body } = await apiGet(page, '/chat/cognitive-profile/status');
    expect(status).toBe(200);
    expect(body.data.orgEnabled).toBe(false);
    expect(body.data.userEnabled).toBe(false);
    console.log(`Cognitive status with org disabled: orgEnabled=${body.data.orgEnabled}, userEnabled=${body.data.userEnabled}`);
  });
});

// =============================================================================

test.describe('Cognitive Multi-User Tests', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  test('8. Two users can have different opt-in states', async ({ page, browser }) => {
    const adminCsrf = await loginAs(page, 'admin');

    // Ensure cognitive is enabled org-wide
    await apiPut(page, adminCsrf, '/admin/cognitive/settings', { enabled: true });
    cleanup.add(async () => {
      const cs = await loginAs(page, 'admin');
      await apiPut(page, cs, '/admin/cognitive/settings', { enabled: false });
    });

    // dev1 opts out
    const { page: dev1Page, csrf: dev1Csrf, cleanup: dev1Cleanup } = await loginAsNewContext(browser, 'dev1');
    cleanup.add(dev1Cleanup);
    await apiPut(dev1Page, dev1Csrf, '/chat/cognitive-profile/status', { enabled: false });

    // dev2 opts in
    const { page: dev2Page, csrf: dev2Csrf, cleanup: dev2Cleanup } = await loginAsNewContext(browser, 'dev2');
    cleanup.add(dev2Cleanup);
    await apiPut(dev2Page, dev2Csrf, '/chat/cognitive-profile/status', { enabled: true });

    // Verify each user has their own status
    const dev1Status = await apiGet(dev1Page, '/chat/cognitive-profile/status');
    expect(dev1Status.body.data.userEnabled).toBe(false);
    console.log(`dev1 cognitive: userEnabled=${dev1Status.body.data.userEnabled}`);

    const dev2Status = await apiGet(dev2Page, '/chat/cognitive-profile/status');
    expect(dev2Status.body.data.userEnabled).toBe(true);
    console.log(`dev2 cognitive: userEnabled=${dev2Status.body.data.userEnabled}`);

    // Cleanup: restore dev1 opt-in
    cleanup.add(async () => {
      const cs = await loginAs(page, 'dev1');
      await apiPut(page, cs, '/chat/cognitive-profile/status', { enabled: true });
    });
  });
});

// =============================================================================

test.describe('Cognitive Product Gaps', () => {
  test('Product gap: no UI for viewing own cognitive profile', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Navigate to settings - verify no cognitive profile viewer exists
    await page.goto('/#/settings/profile');
    await page.waitForTimeout(1000);

    const profileViewer = page.locator('text=My Cognitive Profile');
    const visible = await profileViewer.isVisible().catch(() => false);
    console.log(`PRODUCT GAP: Cognitive profile viewer UI exists: ${visible}`);
    console.log('  -> Users have no way to see how the AI perceives their communication style.');
    console.log('  -> Recommendation: Add a "Cognitive Profile" section to settings/profile page');
    console.log('     showing discovered patterns, strengths, preferred communication style.');

    // This test documents the gap - it passes either way
    expect(true).toBe(true); // Gap documented
  });

  test('Product gap: no way to correct wrong patterns', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Check cognitive-profile/status endpoint exists
    const { status: statusCode } = await apiGet(page, '/chat/cognitive-profile/status');
    console.log(`PRODUCT GAP: Cognitive profile status endpoint exists: ${statusCode === 200}`);

    // Try to navigate to a pattern editing UI
    await page.goto('/#/settings/cognitive');
    await page.waitForTimeout(1000);

    const editButton = page.locator('text=Edit Pattern');
    const editVisible = await editButton.isVisible().catch(() => false);
    const correctButton = page.locator('text=Correct');
    const correctVisible = await correctButton.isVisible().catch(() => false);

    console.log(`PRODUCT GAP: Pattern edit UI exists: ${editVisible}`);
    console.log(`PRODUCT GAP: Pattern correct button exists: ${correctVisible}`);
    console.log('  -> Users cannot dispute or correct incorrect cognitive patterns.');
    console.log('  -> Recommendation: Add pattern feedback mechanism (thumbs up/down, "This is wrong")');
    console.log('     and allow users to provide corrections that retrain the model.');

    expect(true).toBe(true); // Gap documented
  });

  test('Product gap: no @mention autocomplete UI for cognitive context', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Create a chat session and navigate to it
    const sessionRes = await apiPost(page, csrf, '/chat/sessions', {
      title: `Cognitive Autocomplete Test ${Date.now()}`,
    });
    expect(sessionRes.status).toBe(201);
    const sessionId = sessionRes.body.data.id;

    await page.goto(`/#/chat/${sessionId}`);
    await page.waitForTimeout(2000);

    // Try typing @ in the chat input to see if autocomplete appears
    const chatInput = page.locator('textarea, [contenteditable="true"], input[type="text"]').last();
    const inputVisible = await chatInput.isVisible().catch(() => false);

    if (inputVisible) {
      await chatInput.fill('@');
      await page.waitForTimeout(500);

      const autocomplete = page.locator('[data-testid="mention-autocomplete"], .mention-dropdown, .autocomplete-list');
      const autocompleteVisible = await autocomplete.isVisible().catch(() => false);

      console.log(`PRODUCT GAP: @mention autocomplete UI exists: ${autocompleteVisible}`);
    } else {
      console.log('PRODUCT GAP: Could not find chat input to test @mention autocomplete');
    }

    console.log('  -> No @mention autocomplete that shows cognitive context for mentioned users.');
    console.log('  -> Recommendation: When user types @, show dropdown with team members and a');
    console.log('     cognitive summary (e.g., "prefers concise updates", "visual thinker")');
    console.log('     so the author can tailor their message.');

    // Cleanup session
    await page.request.delete(`${API}/chat/sessions/${sessionId}`, {
      headers: { 'x-csrf-token': csrf },
    });

    expect(true).toBe(true); // Gap documented
  });
});
