import { test, expect } from '@playwright/test';
import {
  loginAs,
  apiGet,
  deleteSession,
  Cleanup,
  uniqueId,
} from '../fixtures/test-helpers';

// ═══════════════════════════════════════════════════════════════════════════════
// VERIFY — @mention frontend UX (chat-input.tsx + message-bubble.tsx + globals.css)
//
// The mention autocomplete is mid-message + always-on (no cognitiveEnabled gate).
// Composer:      <textarea placeholder="Type a message..."> (ChatInput)
// Dropdown:      "Mention a teammate" header + per-user buttons (selectMention)
// Sent bubble:   <span class="hearth-mention-on-bubble"> inside the user bubble
//
// Teammate names come from the LIVE /chat/users/search route (which excludes the
// requesting user). Logged in as admin, "Marcus Chen" (cto@hearth.local) is a
// real teammate matching the query "Ma".
// ═══════════════════════════════════════════════════════════════════════════════

const MENTION_QUERY = 'Ma'; // "Marcus Chen", "Marta Klein", etc.

test.describe('VERIFY — @mention UX', () => {
  let cleanup: Cleanup;

  test.beforeEach(() => {
    cleanup = new Cleanup();
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  test('@mention autocomplete: dropdown, selection, mid-message, chip on bubble', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Confirm there IS a teammate matching our query (so this isn't a false negative).
    const search = await apiGet(page, `/chat/users/search?q=${MENTION_QUERY}`);
    expect(Array.isArray(search.body.data)).toBe(true);
    expect(search.body.data.length).toBeGreaterThan(0);
    const teammate = search.body.data[0] as { name: string; email: string };
    console.log(`Teammate for mention: ${teammate.name} <${teammate.email}>`);

    await page.goto('/#/chat');
    const composer = page.getByPlaceholder('Type a message...');
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await page.getByTitle('New chat').click();

    // ── 1. Type "@" + 2 chars at the START → dropdown appears ──────────────────
    await composer.click();
    await composer.pressSequentially(`@${MENTION_QUERY}`, { delay: 40 });

    const dropdownHeader = page.getByText('Mention a teammate');
    await expect(dropdownHeader).toBeVisible({ timeout: 5_000 });

    // The teammate must appear as a selectable row.
    const teammateRow = page.getByRole('button', { name: new RegExp(teammate.name, 'i') });
    await expect(teammateRow.first()).toBeVisible({ timeout: 5_000 });
    console.log('STEP 1 PASS: dropdown appeared with results for a start-of-message @mention');

    // ── 2. Select the teammate → "@Name " inserted ────────────────────────────
    await teammateRow.first().click();
    await expect(composer).toHaveValue(new RegExp(`^@${teammate.name} $`));
    // Dropdown closes after selection.
    await expect(dropdownHeader).not.toBeVisible();
    console.log(`STEP 2 PASS: selecting inserted "@${teammate.name} " and closed the dropdown`);

    // ── 3. Mid-message @mention also triggers the dropdown ─────────────────────
    // Continue typing trailing text, then a second @mention mid-message.
    await composer.pressSequentially(`please review @${MENTION_QUERY}`, { delay: 40 });
    await expect(dropdownHeader).toBeVisible({ timeout: 5_000 });
    await expect(teammateRow.first()).toBeVisible({ timeout: 5_000 });
    console.log('STEP 3 PASS: a MID-message @mention re-opened the autocomplete');

    // Select the mid-message mention too.
    await teammateRow.first().click();
    const finalValue = await composer.inputValue();
    expect(finalValue).toContain(`@${teammate.name}`);
    // Two mentions of the same teammate should both be present.
    const mentionCount = (finalValue.match(new RegExp(`@${teammate.name}`, 'g')) || []).length;
    expect(mentionCount).toBe(2);
    console.log(`STEP 3b PASS: composer holds two mentions: "${finalValue}"`);

    // ── 4. Send → user bubble renders the mention as a styled chip ─────────────
    await composer.press('Enter');

    // The sent bubble's <p> contains span.hearth-mention-on-bubble with @Name.
    const chip = page.locator('.hearth-mention-on-bubble').first();
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(chip).toContainText(`@${teammate.name}`);

    // There should be exactly two chips in the sent bubble (two mentions).
    const chipCount = await page.locator('.hearth-mention-on-bubble').count();
    expect(chipCount).toBe(2);

    // The chip must carry a non-transparent background tint (globals.css).
    const bg = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');
    console.log(`STEP 4 PASS: sent bubble rendered ${chipCount} mention chip(s), bg=${bg}`);

    // Composer cleared after send.
    await expect(composer).toHaveValue('');

    // Cleanup the auto-created session.
    const { body } = await apiGet(page, '/chat/sessions');
    const sessionId = body.data[0]?.id as string | undefined;
    if (sessionId) cleanup.add(() => deleteSession(page, csrf, sessionId));
    console.log(`Session created: ${sessionId}`);
  });
});
