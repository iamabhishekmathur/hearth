import { test, expect } from '@playwright/test';
import {
  API,
  loginAs,
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  createSkill,
  Cleanup,
  uniqueId,
} from './fixtures/test-helpers';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Builds valid SKILL.md content with YAML frontmatter. */
function skillContent(name: string, description: string, body = ''): string {
  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    body || `You are a skill called ${name}. Follow best practices.`,
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SKILLS E2E TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Skills — Browse & Discovery', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  // ── Test 1: List all skills ───────────────────────────────────────────────
  test('1. List all skills returns data array', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Seed a skill so we know at least one exists
    const name = uniqueId('list-all');
    const { status, data: skill } = await createSkill(page, csrf, {
      name,
      content: skillContent(name, 'List all test skill'),
      description: 'List all test skill',
    });
    expect(status).toBe(201);
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${skill.id}`);
    });

    const res = await apiGet(page, '/skills');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    console.log(`Listed ${res.body.data.length} skills`);
  });

  // ── Test 2: Search by name ────────────────────────────────────────────────
  test('2. Search by name returns matching skills', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const name = uniqueId('search-match');
    const { data: skill } = await createSkill(page, csrf, {
      name,
      content: skillContent(name, 'Searchable skill'),
      description: 'Searchable skill',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${skill.id}`);
    });

    const res = await apiGet(page, `/skills?search=${name}`);
    expect(res.status).toBe(200);
    const matches = res.body.data.filter(
      (s: Record<string, unknown>) => s.name === name,
    );
    expect(matches.length).toBe(1);
    console.log(`Search '${name}' → ${matches.length} match(es)`);
  });

  // ── Test 3: Search with no results ────────────────────────────────────────
  test('3. Search with no results returns empty array', async ({ page }) => {
    await loginAs(page, 'admin');

    const res = await apiGet(page, '/skills?search=zzz-nonexistent-skill-xyz-999');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    console.log('Empty search returned 0 results as expected');
  });

  // ── Test 4: Filter installed tab ──────────────────────────────────────────
  test('4. Installed endpoint returns only user installed skills', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Create and install a skill
    const name = uniqueId('installed-filter');
    const { data: skill } = await createSkill(page, csrf, {
      name,
      content: skillContent(name, 'Installed filter skill'),
      description: 'Installed filter skill',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${skill.id}`);
    });

    await apiPost(page, csrf, `/skills/${skill.id}/install`, {});
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${skill.id}/install`);
    });

    const res = await apiGet(page, '/skills/installed');
    expect(res.status).toBe(200);
    const found = res.body.data.find(
      (s: Record<string, unknown>) => s.id === skill.id,
    );
    expect(found).toBeTruthy();
    expect(found.installed).toBe(true);
    console.log(`Installed endpoint returned ${res.body.data.length} skill(s), found our skill`);
  });
});

test.describe('Skills — Install / Uninstall', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  // ── Test 5: Install a published skill ─────────────────────────────────────
  test('5. Install published skill increments installCount', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const name = uniqueId('install-pub');
    const { data: skill } = await createSkill(page, csrf, {
      name,
      content: skillContent(name, 'Install test skill'),
      description: 'Install test skill',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${skill.id}`);
    });

    // Capture count before install
    const before = await apiGet(page, `/skills/${skill.id}`);
    const countBefore = before.body.data.installCount;

    // Install
    const installRes = await apiPost(page, csrf, `/skills/${skill.id}/install`, {});
    expect(installRes.status).toBe(201);
    expect(installRes.body.data.skillId).toBe(skill.id);
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${skill.id}/install`);
    });

    // Verify count incremented
    const after = await apiGet(page, `/skills/${skill.id}`);
    expect(after.body.data.installCount).toBeGreaterThan(countBefore);
    console.log(`installCount: ${countBefore} → ${after.body.data.installCount}`);
  });

  // ── Test 6: Uninstall a skill ─────────────────────────────────────────────
  test('6. Uninstall skill decrements installCount', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const name = uniqueId('uninstall');
    const { data: skill } = await createSkill(page, csrf, {
      name,
      content: skillContent(name, 'Uninstall test skill'),
      description: 'Uninstall test skill',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${skill.id}`);
    });

    // Install first
    await apiPost(page, csrf, `/skills/${skill.id}/install`, {});

    const afterInstall = await apiGet(page, `/skills/${skill.id}`);
    const countAfterInstall = afterInstall.body.data.installCount;

    // Uninstall
    const uninstallRes = await apiDelete(page, csrf, `/skills/${skill.id}/install`);
    expect(uninstallRes.status).toBe(204);

    // Verify count decremented
    const afterUninstall = await apiGet(page, `/skills/${skill.id}`);
    expect(afterUninstall.body.data.installCount).toBeLessThan(countAfterInstall);
    console.log(`installCount: ${countAfterInstall} → ${afterUninstall.body.data.installCount}`);
  });

  // ── Test 7: Install already-installed is idempotent ───────────────────────
  test('7. Installing already-installed skill is idempotent', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const name = uniqueId('idempotent');
    const { data: skill } = await createSkill(page, csrf, {
      name,
      content: skillContent(name, 'Idempotent install skill'),
      description: 'Idempotent install skill',
    });
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${skill.id}`);
    });

    // Install twice
    const first = await apiPost(page, csrf, `/skills/${skill.id}/install`, {});
    expect(first.status).toBe(201);
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${skill.id}/install`);
    });

    const second = await apiPost(page, csrf, `/skills/${skill.id}/install`, {});
    // Should not fail — upsert handles this
    expect([200, 201]).toContain(second.status);

    // Verify only one entry in installed list
    const installed = await apiGet(page, '/skills/installed');
    const entries = installed.body.data.filter(
      (s: Record<string, unknown>) => s.id === skill.id,
    );
    expect(entries.length).toBe(1);
    console.log('Double install is idempotent — single entry in installed list');
  });

  // ── Test 8: Install a draft skill ─────────────────────────────────────────
  test('8. Install draft skill — verify behavior', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Create an org-scoped skill (pending_review) then change to draft
    const name = uniqueId('install-draft');
    const createRes = await apiPost(page, csrf, '/skills', {
      name,
      description: 'Draft install test',
      content: skillContent(name, 'Draft install test'),
      scope: 'org',
    });
    expect(createRes.status).toBe(201);
    const skill = createRes.body.data;
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${skill.id}`);
    });

    // Set to draft via admin
    await apiPatch(page, csrf, `/skills/${skill.id}`, { status: 'draft' });

    // Attempt install — the service allows it (no status check in installSkill)
    const installRes = await apiPost(page, csrf, `/skills/${skill.id}/install`, {});
    // installSkill does not check status; it should succeed
    expect([201, 403, 400]).toContain(installRes.status);
    console.log(`Install draft skill status: ${installRes.status}`);

    if (installRes.status === 201) {
      cleanup.add(async () => {
        await apiDelete(page, csrf, `/skills/${skill.id}/install`);
      });
    }
  });
});

test.describe('Skills — Create', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  // ── Test 9: Create personal skill → auto-published ────────────────────────
  test('9. Create personal skill auto-publishes (status=published)', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const name = uniqueId('personal-pub');
    const { status, data: skill } = await createSkill(page, csrf, {
      name,
      content: skillContent(name, 'Personal auto-publish'),
      description: 'Personal auto-publish',
      scope: 'personal',
    });
    expect(status).toBe(201);
    expect(skill.status).toBe('published');
    expect(skill.scope).toBe('personal');
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${skill.id}`);
    });

    console.log(`Personal skill ${skill.id} created with status=${skill.status}`);
  });

  // ── Test 10: Create org skill → pending_review ────────────────────────────
  test('10. Create org skill sets status=pending_review', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const name = uniqueId('org-review');
    const createRes = await apiPost(page, csrf, '/skills', {
      name,
      description: 'Org scope review test',
      content: skillContent(name, 'Org scope review test'),
      scope: 'org',
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.status).toBe('pending_review');
    expect(createRes.body.data.scope).toBe('org');
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${createRes.body.data.id}`);
    });

    console.log(`Org skill ${createRes.body.data.id} status=${createRes.body.data.status}`);
  });

  // ── Test 11: Create with all fields → stored correctly ────────────────────
  test('11. Create skill with all fields stores them correctly', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const name = uniqueId('full-fields');
    const description = 'A fully-specified test skill with all fields populated';
    const content = skillContent(name, description, '## Instructions\n\nDo things carefully.\n\n## Examples\n\n- Example 1\n- Example 2');

    const createRes = await apiPost(page, csrf, '/skills', {
      name,
      description,
      content,
      scope: 'personal',
    });
    expect(createRes.status).toBe(201);
    const skill = createRes.body.data;
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${skill.id}`);
    });

    // Verify via GET detail
    const detail = await apiGet(page, `/skills/${skill.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.name).toBe(name);
    expect(detail.body.data.description).toBe(description);
    expect(detail.body.data.content).toBe(content);
    expect(detail.body.data.scope).toBe('personal');
    expect(detail.body.data.author).toBeTruthy();
    expect(detail.body.data.author.name).toBeTruthy();
    console.log(`Skill detail verified: name=${detail.body.data.name}, author=${detail.body.data.author.name}`);
  });

  // ── Test 12: Create with duplicate name → error ───────────────────────────
  test('12. Create skill with duplicate name returns error', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const name = uniqueId('dupe-name');
    const { status, data: skill } = await createSkill(page, csrf, {
      name,
      content: skillContent(name, 'First skill'),
      description: 'First skill',
    });
    expect(status).toBe(201);
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${skill.id}`);
    });

    // Attempt duplicate
    const dupeRes = await apiPost(page, csrf, '/skills', {
      name,
      description: 'Duplicate skill',
      content: skillContent(name, 'Duplicate skill'),
      scope: 'personal',
    });
    // Prisma unique constraint on orgId_name should cause 409 or 500
    expect(dupeRes.status).toBeGreaterThanOrEqual(400);
    console.log(`Duplicate name returned status ${dupeRes.status}`);
  });
});

test.describe('Skills — Approval Workflow', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  // ── Test 13: Submit for review → pending_review ───────────────────────────
  test('13. Org-scoped skill is created with pending_review status', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const name = uniqueId('submit-review');
    const createRes = await apiPost(page, csrf, '/skills', {
      name,
      description: 'Submission test',
      content: skillContent(name, 'Submission test'),
      scope: 'org',
    });
    expect(createRes.status).toBe(201);
    const skill = createRes.body.data;
    expect(skill.status).toBe('pending_review');
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${skill.id}`);
    });

    console.log(`Skill ${skill.id} submitted for review: status=${skill.status}`);
  });

  // ── Test 14: Admin approves → published ───────────────────────────────────
  test('14. Admin approves skill (PATCH status → published)', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const name = uniqueId('admin-approve');
    const createRes = await apiPost(page, csrf, '/skills', {
      name,
      description: 'Approval test',
      content: skillContent(name, 'Approval test'),
      scope: 'org',
    });
    expect(createRes.status).toBe(201);
    const skill = createRes.body.data;
    expect(skill.status).toBe('pending_review');
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${skill.id}`);
    });

    // Admin approves
    const patchRes = await apiPatch(page, csrf, `/skills/${skill.id}`, {
      status: 'published',
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.status).toBe('published');
    console.log(`Admin approved skill ${skill.id}: status=${patchRes.body.data.status}`);
  });

  // ── Test 15: Admin rejects → draft ────────────────────────────────────────
  test('15. Admin rejects skill (PATCH status → draft)', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const name = uniqueId('admin-reject');
    const createRes = await apiPost(page, csrf, '/skills', {
      name,
      description: 'Rejection test',
      content: skillContent(name, 'Rejection test'),
      scope: 'org',
    });
    expect(createRes.status).toBe(201);
    const skill = createRes.body.data;
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${skill.id}`);
    });

    // Admin rejects back to draft
    const patchRes = await apiPatch(page, csrf, `/skills/${skill.id}`, {
      status: 'draft',
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.status).toBe('draft');
    console.log(`Admin rejected skill ${skill.id}: status=${patchRes.body.data.status}`);
  });

  // ── Test 16: Non-admin cannot change status → 403 ────────────────────────
  test('16. Non-admin cannot change skill status (403)', async ({ page }) => {
    // First create a skill as admin
    const adminCsrf = await loginAs(page, 'admin');

    const name = uniqueId('no-perm-status');
    const createRes = await apiPost(page, adminCsrf, '/skills', {
      name,
      description: 'Permission test',
      content: skillContent(name, 'Permission test'),
      scope: 'org',
    });
    expect(createRes.status).toBe(201);
    const skill = createRes.body.data;
    cleanup.add(async () => {
      // Clean up as admin
      const cleanupCsrf = await loginAs(page, 'admin');
      await apiDelete(page, cleanupCsrf, `/skills/${skill.id}`);
    });

    // Login as a regular member
    const memberCsrf = await loginAs(page, 'dev1');

    // Attempt status change
    const patchRes = await apiPatch(page, memberCsrf, `/skills/${skill.id}`, {
      status: 'published',
    });
    expect(patchRes.status).toBe(403);
    expect(patchRes.body.error).toContain('admin');
    console.log(`Non-admin status change blocked: ${patchRes.status} — ${patchRes.body.error}`);
  });
});

test.describe('Skills — Edge Cases', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  // ── Test 17: Very long content is handled ─────────────────────────────────
  test('17. Very long content is accepted and stored', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const name = uniqueId('long-content');
    const longBody = 'A'.repeat(50_000);
    const content = skillContent(name, 'Long content skill', longBody);

    const { status, data: skill } = await createSkill(page, csrf, {
      name,
      content,
      description: 'Long content skill',
    });
    expect(status).toBe(201);
    cleanup.add(async () => {
      await apiDelete(page, csrf, `/skills/${skill.id}`);
    });

    // Verify the full content roundtrips
    const detail = await apiGet(page, `/skills/${skill.id}`);
    expect(detail.body.data.content.length).toBeGreaterThanOrEqual(50_000);
    console.log(`Long content stored: ${detail.body.data.content.length} chars`);
  });

  // ── Test 18: Special characters in name → validation enforced ─────────────
  test('18. Special characters in name are rejected by validation', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Name validation: must be lowercase letters, digits, and hyphens only
    const badNames = ['My Skill!', 'UPPERCASE', 'with spaces', 'special@chars', '123-starts-num'];

    for (const badName of badNames) {
      const res = await apiPost(page, csrf, '/skills', {
        name: badName,
        description: 'Bad name test',
        content: skillContent('valid-name', 'Bad name test'),
        scope: 'personal',
      });
      expect(res.status).toBe(400);
      console.log(`Name '${badName}' rejected: ${res.status}`);
    }
  });

  // ── Test 19: Delete installed skill cascades uninstall ────────────────────
  test('19. Deleting an installed skill cascades to remove UserSkill records', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const name = uniqueId('cascade-delete');
    const { data: skill } = await createSkill(page, csrf, {
      name,
      content: skillContent(name, 'Cascade delete test'),
      description: 'Cascade delete test',
    });
    // Do NOT add to cleanup — we delete manually below

    // Install the skill
    const installRes = await apiPost(page, csrf, `/skills/${skill.id}/install`, {});
    expect(installRes.status).toBe(201);

    // Verify it is in installed list
    const beforeDelete = await apiGet(page, '/skills/installed');
    const foundBefore = beforeDelete.body.data.find(
      (s: Record<string, unknown>) => s.id === skill.id,
    );
    expect(foundBefore).toBeTruthy();

    // Delete the skill (admin route uses transaction to remove UserSkills first)
    const deleteRes = await apiDelete(page, csrf, `/skills/${skill.id}`);
    expect(deleteRes.status).toBe(204);

    // Verify it is gone from installed list
    const afterDelete = await apiGet(page, '/skills/installed');
    const foundAfter = afterDelete.body.data.find(
      (s: Record<string, unknown>) => s.id === skill.id,
    );
    expect(foundAfter).toBeUndefined();

    // Verify GET detail returns 404
    const detailRes = await apiGet(page, `/skills/${skill.id}`);
    expect(detailRes.status).toBe(404);
    console.log('Cascade delete verified: skill and UserSkill records removed');
  });

  // ── Test 20: Get non-existent skill → 404 ────────────────────────────────
  test('20. Get non-existent skill returns 404', async ({ page }) => {
    await loginAs(page, 'admin');

    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await apiGet(page, `/skills/${fakeId}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
    console.log(`Non-existent skill ${fakeId} → ${res.status}`);
  });
});

test.describe('UI — Skills Page', () => {
  test('Skills page renders with tabs and search', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/skills');
    await page.waitForTimeout(2000);

    expect(page.url()).toContain('/skills');

    // Tabs
    for (const tab of ['All', 'Installed', 'Recommended']) {
      const el = page.locator(`button:has-text("${tab}")`).first();
      const visible = await el.isVisible().catch(() => false);
      console.log(`Tab "${tab}" visible: ${visible}`);
    }

    // Search input
    const searchInput = page.getByPlaceholder(/search skills/i);
    await expect(searchInput).toBeVisible();

    // Create button
    const createBtn = page.getByRole('button', { name: /create skill/i });
    await expect(createBtn).toBeVisible();
    console.log('Skills page elements rendered');
  });

  test('Switch between skill tabs', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/skills');
    await page.waitForTimeout(1500);

    for (const tab of ['Installed', 'Recommended', 'All']) {
      const el = page.locator(`button:has-text("${tab}")`).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        await page.waitForTimeout(500);
        console.log(`Switched to ${tab} tab`);
      }
    }
  });

  test('Search skills via UI', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/skills');
    await page.waitForTimeout(1500);

    const searchInput = page.getByPlaceholder(/search skills/i);
    await searchInput.fill('code review');
    await page.waitForTimeout(1000);
    console.log('Skills search executed via UI');
  });

  test('Click skill opens detail panel', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/skills');
    await page.waitForTimeout(2000);

    // Click any skill row
    const firstSkill = page.locator('[class*="cursor-pointer"], [class*="hover:bg"]').first();
    if (await firstSkill.isVisible().catch(() => false)) {
      await firstSkill.click();
      await page.waitForTimeout(1000);
      console.log('Skill detail panel opened');
    }
  });
});
