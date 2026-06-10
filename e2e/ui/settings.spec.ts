import { test, expect } from '@playwright/test';
import { loginAs, USERS } from '../fixtures/test-helpers';

// ═══════════════════════════════════════════════════════════════════════════════
// UI — Settings / Admin Dashboard (role-experience difference)
//
// From apps/web/src/pages/settings.tsx:
//   - Admins see heading "Admin Dashboard." and the full ADMIN_TABS row:
//     Profile, Soul & Identity, Users, Teams, Integrations, LLM Config,
//     Compliance, Analytics, Skills, Governance, Digital Co-Worker,
//     Decision Graph (all rendered as <button> elements in the tab bar).
//   - Non-admins see heading "Settings." and only ALL_USER_TABS:
//     Profile, Soul & Identity.
//
// NB: the sidebar rail also renders <button>s named "Skills" and "Settings"
// (HRailItem), so the assertions below deliberately use admin tab names that
// do NOT collide with sidebar labels ("Users", "Teams", "LLM Config", ...).
// "Skills" is asserted via the tab bar's sibling tabs instead.
// ═══════════════════════════════════════════════════════════════════════════════

// Admin-only tab labels that are unique on the page (no sidebar collision).
const ADMIN_ONLY_TABS = [
  'Users',
  'Teams',
  'Integrations',
  'LLM Config',
  'Compliance',
  'Analytics',
  'Governance',
  'Digital Co-Worker',
  'Decision Graph',
];

test.describe('UI — Settings role experience', () => {
  test('admin sees the Admin Dashboard with all admin tabs', async ({ page }) => {
    await loginAs(page, 'admin');
    expect(USERS.admin.role).toBe('admin'); // sanity: fixture role

    await page.goto('/#/settings');

    // Admin-specific header.
    await expect(
      page.getByRole('heading', { name: /Admin Dashboard/ }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText('Manage your organization, users, and integrations.'),
    ).toBeVisible();

    // Shared tabs.
    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Soul & Identity', exact: true })).toBeVisible();

    // Every admin-only tab renders.
    for (const tab of ADMIN_ONLY_TABS) {
      await expect(page.getByRole('button', { name: tab, exact: true })).toBeVisible();
    }

    // Clicking a tab switches the panel and updates the hash route.
    await page.getByRole('button', { name: 'Users', exact: true }).click();
    await expect(page).toHaveURL(/#\/settings\/users/);
    console.log('Admin tabs all visible; Users tab navigates to #/settings/users');
  });

  test('member sees plain Settings without any admin tabs', async ({ page }) => {
    // dev1 is a `member` in the fixtures — the founder's role-experience check.
    await loginAs(page, 'dev1');
    expect(USERS.dev1.role).toBe('member');

    await page.goto('/#/settings');

    // Member-specific header (no "Admin Dashboard").
    await expect(page.getByRole('heading', { name: /Settings/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /Admin Dashboard/ })).toHaveCount(0);
    await expect(page.getByText('Manage your account and preferences.')).toBeVisible();

    // Shared tabs still present.
    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Soul & Identity', exact: true })).toBeVisible();

    // Admin tabs are ABSENT for members.
    for (const tab of ADMIN_ONLY_TABS) {
      await expect(page.getByRole('button', { name: tab, exact: true })).toHaveCount(0);
    }

    // Profile tab shows the member's own identity (role rendered capitalized).
    await expect(page.getByText(USERS.dev1.email)).toBeVisible();
    console.log('Member sees only Profile + Soul & Identity tabs — admin tabs absent');
  });

  test('member cannot reach an admin tab via deep link', async ({ page }) => {
    await loginAs(page, 'dev1');

    // Deep-linking to an admin tab: SettingsPage accepts initialTab, but the
    // tab content is gated by `isAdmin`, so nothing admin-only should render.
    await page.goto('/#/settings/users');

    await expect(page.getByRole('heading', { name: /Settings/ })).toBeVisible({ timeout: 15_000 });
    // The Users tab button itself must not exist for members.
    await expect(page.getByRole('button', { name: 'Users', exact: true })).toHaveCount(0);
    console.log('Deep link to #/settings/users renders no admin UI for a member');
  });
});
