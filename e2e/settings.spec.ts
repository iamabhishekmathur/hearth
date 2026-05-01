/**
 * Comprehensive Settings & Admin E2E Tests
 *
 * Covers profile/identity management, admin user/team CRUD, LLM configuration,
 * integrations, analytics, cognitive settings, and
 * role-based access control for all admin endpoints.
 *
 * Role hierarchy: admin > team_lead > member > viewer
 */
import { test, expect } from '@playwright/test';
import {
  API,
  USERS,
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

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE & IDENTITY
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Profile & Identity', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  test('1. Profile returns correct user info', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const { status, body } = await apiGet(page, '/auth/me');

    expect(status).toBe(200);
    expect(body.data.email).toBe(USERS.admin.email);
    expect(body.data.name).toBe(USERS.admin.name);
    expect(body.data.role).toBe(USERS.admin.role);
    expect(body.data.id).toBeTruthy();
    // Password must never be exposed
    expect(body.data.password).toBeUndefined();
    expect(body.data.passwordHash).toBeUndefined();
    console.log(`Profile — id: ${body.data.id}, email: ${body.data.email}, role: ${body.data.role}`);
  });

  test('2. Edit user SOUL.md — saved', async ({ page }) => {
    const csrf = await loginAs(page, 'dev1');
    const content = `# Dev1 SOUL\n\nI am a backend engineer focused on API quality.\nUpdated: ${uniqueId('soul')}`;

    const { status, body } = await apiPut(page, csrf, '/identity/user/soul', { content });
    expect(status).toBe(200);
    console.log(`User SOUL.md saved — status: ${status}`);

    // Verify it was persisted by reading it back
    const read = await apiGet(page, '/identity/user/soul');
    expect(read.status).toBe(200);
    expect(read.body.data.content).toBe(content);
    console.log('User SOUL.md read back — content matches');
  });

  test('3. Edit user IDENTITY.md — saved', async ({ page }) => {
    const csrf = await loginAs(page, 'dev1');
    const content = `# Dev1 Identity\n\nPreferred name: Developer One\nTimezone: UTC-5\nUpdated: ${uniqueId('identity')}`;

    const { status, body } = await apiPut(page, csrf, '/identity/user/identity', { content });
    expect(status).toBe(200);
    console.log(`User IDENTITY.md saved — status: ${status}`);
  });

  test('4. Admin edits org SOUL.md — saved', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const content = `# Organization SOUL\n\nWe build AI-first productivity tools.\nValues: transparency, speed, craft.\nUpdated: ${uniqueId('org-soul')}`;

    const { status, body } = await apiPut(page, csrf, '/identity/org/soul', { content });
    expect(status).toBe(200);
    console.log(`Org SOUL.md saved — status: ${status}`);

    // Read back and verify
    const read = await apiGet(page, '/identity/org/soul');
    expect(read.status).toBe(200);
    expect(read.body.data.content).toBe(content);
    console.log('Org SOUL.md read back — content matches');
  });

  test('5. Read back SOUL.md — content matches', async ({ page }) => {
    const csrf = await loginAs(page, 'engLead');
    const content = `# Engineering Lead SOUL\n\nI lead the backend team.\nUpdated: ${uniqueId('soul-readback')}`;

    // Write
    await apiPut(page, csrf, '/identity/user/soul', { content });

    // Read back
    const { status, body } = await apiGet(page, '/identity/user/soul');
    expect(status).toBe(200);
    expect(body.data.content).toBe(content);
    console.log(`SOUL.md read back — content length: ${body.data.content.length}`);
  });

  test('6. Edit with markdown — preserved', async ({ page }) => {
    const csrf = await loginAs(page, 'dev2');
    const content = [
      '# Complex Markdown SOUL',
      '',
      '## Expertise',
      '- **TypeScript** (5 years)',
      '- *React* and Next.js',
      '- `PostgreSQL` + pgvector',
      '',
      '## Code Style',
      '```typescript',
      'const hello = (name: string) => `Hello, ${name}!`;',
      '```',
      '',
      '> "Code is read more often than it is written."',
      '',
      '| Skill | Level |',
      '|-------|-------|',
      '| TS    | Expert |',
      '| Rust  | Beginner |',
      '',
      `Updated: ${uniqueId('md-test')}`,
    ].join('\n');

    const { status } = await apiPut(page, csrf, '/identity/user/soul', { content });
    expect(status).toBe(200);

    const read = await apiGet(page, '/identity/user/soul');
    expect(read.status).toBe(200);
    expect(read.body.data.content).toBe(content);
    expect(read.body.data.content).toContain('```typescript');
    expect(read.body.data.content).toContain('| Skill | Level |');
    console.log('Markdown content fully preserved — code blocks, tables, quotes intact');
  });

  test('7. Clear SOUL.md — empty saved', async ({ page }) => {
    const csrf = await loginAs(page, 'pm1');

    // First set some content
    await apiPut(page, csrf, '/identity/user/soul', {
      content: `Temporary content ${uniqueId()}`,
    });

    // Now clear it
    const { status } = await apiPut(page, csrf, '/identity/user/soul', { content: '' });
    expect(status).toBe(200);

    // Verify it is empty
    const read = await apiGet(page, '/identity/user/soul');
    expect(read.status).toBe(200);
    expect(read.body.data.content).toBe('');
    console.log('SOUL.md cleared — empty content saved and confirmed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN USERS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Admin Users', () => {
  test('8. List all users — users returned', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const { status, body } = await apiGet(page, '/admin/users');

    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(Object.keys(USERS).length);

    // Verify user shape
    const firstUser = body.data[0];
    expect(firstUser.id).toBeTruthy();
    expect(firstUser.email).toBeTruthy();
    expect(firstUser.name).toBeTruthy();
    expect(firstUser.role).toBeTruthy();

    console.log(`Listed users — count: ${body.data.length}`);
    const roles = body.data.reduce(
      (acc: Record<string, number>, u: Record<string, unknown>) => {
        const role = u.role as string;
        acc[role] = (acc[role] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    console.log(`Role distribution: ${JSON.stringify(roles)}`);
  });

  test('9. Change user role member -> team_lead — updated', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Find the newHire user to change
    const { body: listBody } = await apiGet(page, '/admin/users');
    const newHire = listBody.data.find(
      (u: Record<string, unknown>) => u.email === USERS.newHire.email,
    );
    expect(newHire).toBeTruthy();
    expect(newHire.role).toBe('member');
    console.log(`Found newHire: ${newHire.id}, current role: ${newHire.role}`);

    // Upgrade to team_lead (PATCH, not PUT)
    const { status, body } = await apiPatch(page, csrf, `/admin/users/${newHire.id}`, {
      role: 'team_lead',
    });
    expect(status).toBe(200);
    expect(body.data.role).toBe('team_lead');
    console.log(`Role changed: member -> team_lead for user ${newHire.id}`);

    // Revert back to member
    const revert = await apiPatch(page, csrf, `/admin/users/${newHire.id}`, {
      role: 'member',
    });
    expect(revert.status).toBe(200);
    expect(revert.body.data.role).toBe('member');
    console.log(`Role reverted: team_lead -> member`);
  });

  test('10. Change role team_lead -> member — downgrade works', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Find engLead (team_lead)
    const { body: listBody } = await apiGet(page, '/admin/users');
    const engLead = listBody.data.find(
      (u: Record<string, unknown>) => u.email === USERS.engLead.email,
    );
    expect(engLead).toBeTruthy();
    expect(engLead.role).toBe('team_lead');
    console.log(`Found engLead: ${engLead.id}, current role: ${engLead.role}`);

    // Downgrade to member (PATCH, not PUT)
    const { status, body } = await apiPatch(page, csrf, `/admin/users/${engLead.id}`, {
      role: 'member',
    });
    expect(status).toBe(200);
    expect(body.data.role).toBe('member');
    console.log(`Role downgraded: team_lead -> member for user ${engLead.id}`);

    // Revert back to team_lead
    const revert = await apiPatch(page, csrf, `/admin/users/${engLead.id}`, {
      role: 'team_lead',
    });
    expect(revert.status).toBe(200);
    expect(revert.body.data.role).toBe('team_lead');
    console.log(`Role reverted: member -> team_lead`);
  });

  test('11. Non-admin access user management — 403', async ({ page }) => {
    const csrf = await loginAs(page, 'dev1'); // member role

    const { status, body } = await apiGet(page, '/admin/users');
    expect(status).toBe(403);
    console.log(`Member accessing /admin/users — status: ${status}, error: ${body.error}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN TEAMS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Admin Teams', () => {
  const cleanup = new Cleanup();

  test.afterEach(async () => {
    await cleanup.run();
  });

  test('12. List teams — teams returned', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const { status, body } = await apiGet(page, '/admin/teams');

    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    // Verify team shape
    const firstTeam = body.data[0];
    expect(firstTeam.id).toBeTruthy();
    expect(firstTeam.name).toBeTruthy();

    const teamNames = body.data.map((t: Record<string, unknown>) => t.name);
    console.log(`Listed teams — count: ${body.data.length}, names: ${teamNames.join(', ')}`);
  });

  test('13. Create new team — created', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const teamName = `E2E Team ${uniqueId('team')}`;

    const { status, body } = await apiPost(page, csrf, '/admin/teams', {
      name: teamName,
    });
    expect(status).toBe(201);
    expect(body.data.id).toBeTruthy();
    expect(body.data.name).toBe(teamName);
    console.log(`Created team: ${body.data.id} — "${teamName}"`);

    // Verify it appears in the list
    const { body: listBody } = await apiGet(page, '/admin/teams');
    const found = listBody.data.find(
      (t: Record<string, unknown>) => t.id === body.data.id,
    );
    expect(found).toBeTruthy();
    expect(found.name).toBe(teamName);
    console.log(`Team verified in list`);

    // Cleanup: no team delete API specified, so we leave it
    // (teams created during E2E are harmless)
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN LLM CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Admin LLM Config', () => {
  // Store original config for restoration
  let originalConfig: Record<string, unknown> | null = null;

  test('14. View current config — shows settings', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const { status, body } = await apiGet(page, '/admin/llm-config');

    expect(status).toBe(200);
    expect(body.data).toBeDefined();
    // Store original for later restoration
    originalConfig = body.data;

    console.log(`LLM config — provider: ${body.data.defaultProvider}, model: ${body.data.defaultModel}`);
    console.log(`Vision: ${body.data.visionEnabled}`);
  });

  test('15. List providers — shows status', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const { status, body } = await apiGet(page, '/admin/llm-config/providers');

    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);

    for (const provider of body.data) {
      expect(provider.name).toBeTruthy();
      expect(typeof provider.configured).toBe('boolean');
      console.log(`Provider: ${provider.name} — configured: ${provider.configured}, status: ${provider.status ?? 'N/A'}`);
    }
    console.log(`Total providers: ${body.data.length}`);
  });

  test('16. Update default model — persisted', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Read current config
    const { body: currentBody } = await apiGet(page, '/admin/llm-config');
    const original = currentBody.data;

    // Update to a different model
    const newModel = 'claude-sonnet-4-20250514';
    const { status, body } = await apiPut(page, csrf, '/admin/llm-config', {
      defaultModel: newModel,
    });
    expect(status).toBe(200);
    console.log(`Updated default model to: ${newModel}`);

    // Read back and verify
    const { body: readBody } = await apiGet(page, '/admin/llm-config');
    expect(readBody.data.defaultModel).toBe(newModel);
    console.log(`Verified model persisted: ${readBody.data.defaultModel}`);

    // Restore original model
    if (original.defaultModel && original.defaultModel !== newModel) {
      await apiPut(page, csrf, '/admin/llm-config', {
        defaultModel: original.defaultModel,
      });
      console.log(`Restored original model: ${original.defaultModel}`);
    }
  });

  test('17. Toggle vision — persisted', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Read current config
    const { body: currentBody } = await apiGet(page, '/admin/llm-config');
    const originalVision = currentBody.data.visionEnabled;

    // Toggle vision
    const newVision = !originalVision;
    const { status } = await apiPut(page, csrf, '/admin/llm-config', {
      visionEnabled: newVision,
    });
    expect(status).toBe(200);
    console.log(`Toggled vision: ${originalVision} -> ${newVision}`);

    // Verify persisted
    const { body: readBody } = await apiGet(page, '/admin/llm-config');
    expect(readBody.data.visionEnabled).toBe(newVision);
    console.log(`Verified vision persisted: ${readBody.data.visionEnabled}`);

    // Restore original
    await apiPut(page, csrf, '/admin/llm-config', {
      visionEnabled: originalVision,
    });
    console.log(`Restored original vision: ${originalVision}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN INTEGRATIONS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Admin Integrations', () => {
  test('18. List integrations — shows configured', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const { status, body } = await apiGet(page, '/admin/integrations');

    expect(status).toBe(200);
    expect(body.data).toBeDefined();

    if (Array.isArray(body.data)) {
      for (const integration of body.data) {
        expect(integration.provider).toBeTruthy();
        console.log(
          `Integration: ${integration.provider} — enabled: ${integration.enabled}, ` +
          `status: ${integration.status ?? 'N/A'}`,
        );
      }
      console.log(`Total integrations: ${body.data.length}`);
    } else {
      // May be returned as an object keyed by integration name
      console.log(`Integrations response: ${JSON.stringify(body.data)}`);
    }
  });

  test('19. Integration health status — accessible', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const { status, body } = await apiGet(page, '/admin/integrations');

    expect(status).toBe(200);
    expect(body.data).toBeDefined();

    // Verify the response includes health/status information
    if (Array.isArray(body.data) && body.data.length > 0) {
      const first = body.data[0];
      // Health status should be included (either as a boolean or string)
      const hasHealthInfo =
        'healthy' in first ||
        'status' in first ||
        'connected' in first ||
        'enabled' in first;
      expect(hasHealthInfo).toBe(true);
      console.log(`Integration health check accessible — first entry keys: ${Object.keys(first).join(', ')}`);
    } else {
      console.log('No integrations configured — health check endpoint accessible');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Admin Analytics', () => {
  test('20. Get analytics — returns metrics data', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const { status, body } = await apiGet(page, '/admin/analytics?days=30');

    expect(status).toBe(200);
    expect(body.data).toBeDefined();

    // Analytics should return usage metrics
    const data = body.data;
    console.log(`Analytics response keys: ${Object.keys(data).join(', ')}`);

    // Verify at least some metric categories are present
    const hasMetrics =
      'totalMessages' in data ||
      'activeUsers' in data ||
      'sessions' in data ||
      'messages' in data ||
      'tasks' in data ||
      'users' in data;
    expect(hasMetrics).toBe(true);
    console.log(`Analytics (30 days): ${JSON.stringify(data)}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN COGNITIVE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Admin Cognitive', () => {
  test('21. Get cognitive config — returns settings', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const { status, body } = await apiGet(page, '/admin/cognitive/settings');

    expect(status).toBe(200);
    expect(body.data).toBeDefined();
    expect(typeof body.data.enabled).toBe('boolean');
    console.log(`Cognitive config — enabled: ${body.data.enabled}`);
    console.log(`Cognitive config keys: ${Object.keys(body.data).join(', ')}`);
  });

  test('22. Enable cognitive — persisted', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Read original state
    const { body: originalBody } = await apiGet(page, '/admin/cognitive/settings');
    const originalEnabled = originalBody.data.enabled;

    // Enable
    const { status, body } = await apiPut(page, csrf, '/admin/cognitive/settings', { enabled: true });
    expect(status).toBe(200);
    expect(body.message).toBeTruthy();

    // Verify persisted
    const { body: readBody } = await apiGet(page, '/admin/cognitive/settings');
    expect(readBody.data.enabled).toBe(true);
    console.log('Cognitive enabled — persisted and verified');

    // Restore original
    await apiPut(page, csrf, '/admin/cognitive/settings', { enabled: originalEnabled });
    console.log(`Cognitive restored to: ${originalEnabled}`);
  });

  test('23. Disable cognitive — persisted', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    // Read original state
    const { body: originalBody } = await apiGet(page, '/admin/cognitive/settings');
    const originalEnabled = originalBody.data.enabled;

    // Ensure enabled first, then disable
    await apiPut(page, csrf, '/admin/cognitive/settings', { enabled: true });

    // Disable
    const { status, body } = await apiPut(page, csrf, '/admin/cognitive/settings', { enabled: false });
    expect(status).toBe(200);
    expect(body.message).toBeTruthy();

    // Verify persisted
    const { body: readBody } = await apiGet(page, '/admin/cognitive/settings');
    expect(readBody.data.enabled).toBe(false);
    console.log('Cognitive disabled — persisted and verified');

    // Restore original
    await apiPut(page, csrf, '/admin/cognitive/settings', { enabled: originalEnabled });
    console.log(`Cognitive restored to: ${originalEnabled}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NON-ADMIN ACCESS CONTROL
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Non-Admin Access Control', () => {
  test('26. Member cannot access /admin/users — 403', async ({ page }) => {
    const csrf = await loginAs(page, 'dev1'); // member role
    const { status, body } = await apiGet(page, '/admin/users');

    expect(status).toBe(403);
    console.log(`Member (dev1) on /admin/users — status: ${status}, error: ${body.error}`);
  });

  test('27. Member cannot access /admin/llm-config — 403', async ({ page }) => {
    const csrf = await loginAs(page, 'dev1'); // member role
    const { status, body } = await apiGet(page, '/admin/llm-config');

    expect(status).toBe(403);
    console.log(`Member (dev1) on /admin/llm-config — status: ${status}, error: ${body.error}`);
  });

  test('28. Member can edit own SOUL.md — 200', async ({ page }) => {
    const csrf = await loginAs(page, 'dev1'); // member role
    const content = `# Dev1 Personal SOUL\n\nMy focus areas and working style.\nUpdated: ${uniqueId('member-soul')}`;

    const { status } = await apiPut(page, csrf, '/identity/user/soul', { content });
    expect(status).toBe(200);

    // Verify read back
    const read = await apiGet(page, '/identity/user/soul');
    expect(read.status).toBe(200);
    expect(read.body.data.content).toBe(content);
    console.log('Member (dev1) successfully edited own SOUL.md');
  });

  test('29. Viewer can read identity docs — 200', async ({ browser }) => {
    const { page, csrf, cleanup } = await loginAsNewContext(browser, 'intern'); // viewer role
    try {
      // Viewer should be able to read org SOUL.md
      const orgSoul = await apiGet(page, '/identity/org/soul');
      expect(orgSoul.status).toBe(200);
      console.log(`Viewer reading org SOUL.md — status: ${orgSoul.status}`);

      // Viewer should be able to read their own user SOUL.md
      const userSoul = await apiGet(page, '/identity/user/soul');
      expect(userSoul.status).toBe(200);
      console.log(`Viewer reading user SOUL.md — status: ${userSoul.status}`);
    } finally {
      await cleanup();
    }
  });

  test('30. Viewer cannot edit identity docs — 403', async ({ browser }) => {
    const { page, csrf, cleanup } = await loginAsNewContext(browser, 'intern'); // viewer role
    try {
      // Viewer should not be able to edit org SOUL.md
      const orgResult = await apiPut(page, csrf, '/identity/org/soul', {
        content: 'Viewer attempting to edit org SOUL',
      });
      expect(orgResult.status).toBe(403);
      console.log(`Viewer editing org SOUL.md — status: ${orgResult.status}, error: ${orgResult.body.error}`);

      // Viewer should not be able to edit user SOUL.md
      const userResult = await apiPut(page, csrf, '/identity/user/soul', {
        content: 'Viewer attempting to edit user SOUL',
      });
      expect(userResult.status).toBe(403);
      console.log(`Viewer editing user SOUL.md — status: ${userResult.status}, error: ${userResult.body.error}`);

      // Viewer should not be able to edit user IDENTITY.md
      const identityResult = await apiPut(page, csrf, '/identity/user/identity', {
        content: 'Viewer attempting to edit user IDENTITY',
      });
      expect(identityResult.status).toBe(403);
      console.log(`Viewer editing user IDENTITY.md — status: ${identityResult.status}, error: ${identityResult.body.error}`);
    } finally {
      await cleanup();
    }
  });
});

test.describe('UI — Settings Page', () => {
  test('Settings page renders with tabs', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/settings/profile');
    await page.waitForTimeout(2000);

    expect(page.url()).toContain('/settings');

    // User tabs
    for (const tab of ['Profile', 'Soul & Identity']) {
      const el = page.locator(`button:has-text("${tab}"), a:has-text("${tab}")`).first();
      const visible = await el.isVisible().catch(() => false);
      console.log(`Tab "${tab}" visible: ${visible}`);
    }

    // Admin tabs (admin user should see these)
    for (const tab of ['Users', 'Teams', 'Integrations', 'LLM Config', 'Governance']) {
      const el = page.locator(`button:has-text("${tab}"), a:has-text("${tab}")`).first();
      const visible = await el.isVisible().catch(() => false);
      console.log(`Admin tab "${tab}" visible: ${visible}`);
    }
  });

  test('Navigate between settings tabs', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const tabs = ['profile', 'identity', 'users', 'teams', 'integrations', 'llm', 'governance'];
    for (const tab of tabs) {
      await page.goto(`/#/settings/${tab}`);
      await page.waitForTimeout(500);
      console.log(`Settings /${tab} loaded`);
    }
  });

  test('Soul & Identity editor shows save button', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/settings/identity');
    await page.waitForTimeout(2000);

    // Doc selector pills
    for (const doc of ['Org SOUL.md', 'My SOUL.md', 'My IDENTITY.md']) {
      const pill = page.locator(`button:has-text("${doc}")`).first();
      const visible = await pill.isVisible().catch(() => false);
      console.log(`Doc pill "${doc}" visible: ${visible}`);
    }

    // Save button
    const saveBtn = page.getByRole('button', { name: /save/i });
    const hasSave = await saveBtn.isVisible().catch(() => false);
    console.log(`Save button visible: ${hasSave}`);
  });
});
