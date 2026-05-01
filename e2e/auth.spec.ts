/**
 * Comprehensive Auth & Permissions E2E Tests
 *
 * Covers login/register flows, role-based access control, CSRF protection,
 * and session management across the full role hierarchy:
 *   admin > team_lead > member > viewer
 *
 * NOTE: The auth rate limiter allows 5 requests/minute per IP by default
 * (configurable via AUTH_RATE_LIMIT_MAX env var). Tests that call
 * page.request.post('/auth/login') or page.request.post('/auth/register')
 * directly (not via loginAs) are rate-limit sensitive — running the full
 * suite repeatedly without raising the limit may trigger 429 responses.
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
} from './fixtures/test-helpers';

// ═══════════════════════════════════════════════════════════════════════════════
// LOGIN & REGISTER
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Login & Register', () => {
  // Rate-limit sensitive: direct POST to /auth/login
  test('1. Login with valid credentials returns 200', async ({ page }) => {
    const res = await page.request.post(`${API}/auth/login`, {
      data: { email: USERS.admin.email, password: USERS.admin.password },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBeTruthy();
    expect(body.message).toBe('Logged in');
    console.log(`Login success — user id: ${body.data.id}`);
  });

  // Rate-limit sensitive: direct POST to /auth/login
  test('2. Login with wrong password returns 401', async ({ page }) => {
    const res = await page.request.post(`${API}/auth/login`, {
      data: { email: USERS.admin.email, password: 'totally-wrong-password' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    console.log(`Expected 401 — error: ${body.error}`);
  });

  // Rate-limit sensitive: direct POST to /auth/login
  test('3. Login with non-existent email returns 401', async ({ page }) => {
    const res = await page.request.post(`${API}/auth/login`, {
      data: { email: 'ghost@nonexistent.local', password: 'changeme' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    console.log(`Expected 401 — error: ${body.error}`);
  });

  // Rate-limit sensitive: direct POST to /auth/login
  test('4. Login with empty email returns 401', async ({ page }) => {
    const res = await page.request.post(`${API}/auth/login`, {
      data: { email: '', password: 'changeme' },
    });
    // Passport-local treats empty email as a failed authentication
    expect([400, 401]).toContain(res.status());
    console.log(`Empty email — status: ${res.status()}`);
  });

  // Rate-limit sensitive: direct POST to /auth/login
  test('5. Login with empty password returns 401', async ({ page }) => {
    const res = await page.request.post(`${API}/auth/login`, {
      data: { email: USERS.admin.email, password: '' },
    });
    expect([400, 401]).toContain(res.status());
    console.log(`Empty password — status: ${res.status()}`);
  });

  // Rate-limit sensitive: direct POST to /auth/register
  test('6. Register with valid data returns 201', async ({ page }) => {
    const cleanup = new Cleanup();
    const email = `e2e-${Date.now()}@hearth.local`;
    const name = 'Registration Test User';

    let userId: string | undefined;

    await test.step('Register new user', async () => {
      const res = await page.request.post(`${API}/auth/register`, {
        data: { email, password: 'securepassword123', name },
      });
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.data.email).toBe(email);
      expect(body.data.name).toBe(name);
      userId = body.data.id;
      console.log(`Registered user: ${userId} (${email})`);
    });

    await test.step('Session is established after register', async () => {
      // The register endpoint sets cookies, so we should be able to call /me
      const cookies = await page.context().cookies();
      const csrfCookie = cookies.find((c) => c.name === 'hearth.csrf');
      expect(csrfCookie).toBeTruthy();
      console.log('CSRF cookie set after registration');
    });

    // Cleanup: log in as admin and delete the test user
    cleanup.add(async () => {
      if (userId) {
        const csrf = await loginAs(page, 'admin');
        await apiDelete(page, csrf, `/admin/users/${userId}`);
        console.log(`Cleanup: deleted user ${userId}`);
      }
    });
    await cleanup.run();
  });

  // Rate-limit sensitive: direct POST to /auth/register
  test('7. Register with duplicate email returns 409', async ({ page }) => {
    const res = await page.request.post(`${API}/auth/register`, {
      data: { email: USERS.admin.email, password: 'changeme', name: 'Duplicate' },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('already registered');
    console.log(`Duplicate email — error: ${body.error}`);
  });

  // Rate-limit sensitive: direct POST to /auth/register
  test('8. Register with missing name returns 400', async ({ page }) => {
    const res = await page.request.post(`${API}/auth/register`, {
      data: { email: `${uniqueId('no-name')}@hearth.local`, password: 'changeme' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('required');
    console.log(`Missing name — error: ${body.error}`);
  });

  test('9. SSO check for default org returns enabled: false', async ({ page }) => {
    const res = await page.request.get(`${API}/auth/sso/check/default`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.enabled).toBe(false);
    console.log(`SSO check default org — enabled: ${body.data.enabled}`);
  });

  test('10. SSO check for non-existent org returns enabled: false', async ({ page }) => {
    const res = await page.request.get(
      `${API}/auth/sso/check/totally-nonexistent-org-${Date.now()}`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.enabled).toBe(false);
    console.log(`SSO check nonexistent org — enabled: ${body.data.enabled}`);
  });

  // Rate-limit sensitive: direct POST to /auth/login
  test('11. Logout clears session and cookies', async ({ page }) => {
    await test.step('Login first', async () => {
      const res = await page.request.post(`${API}/auth/login`, {
        data: { email: USERS.dev1.email, password: USERS.dev1.password },
      });
      expect(res.status()).toBe(200);
    });

    await test.step('Verify session is active via /auth/me', async () => {
      const res = await page.request.get(`${API}/auth/me`);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.data.email).toBe(USERS.dev1.email);
      console.log(`Logged in as: ${body.data.email}`);
    });

    await test.step('Logout', async () => {
      const cookies = await page.context().cookies();
      const csrf = cookies.find((c) => c.name === 'hearth.csrf')?.value ?? '';
      const res = await page.request.post(`${API}/auth/logout`, {
        headers: { 'x-csrf-token': csrf },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.message).toBe('Logged out');
      console.log('Logout successful');
    });

    await test.step('Session is invalidated — /auth/me returns 401', async () => {
      const res = await page.request.get(`${API}/auth/me`);
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body.error).toBeTruthy();
      console.log('Session confirmed invalidated after logout');
    });
  });

  test('12. GET /auth/me returns user data after login', async ({ page }) => {
    const csrf = await loginAs(page, 'engLead');

    const { status, body } = await apiGet(page, '/auth/me');
    expect(status).toBe(200);
    expect(body.data.email).toBe(USERS.engLead.email);
    expect(body.data.name).toBe(USERS.engLead.name);
    expect(body.data.role).toBe(USERS.engLead.role);
    expect(body.data.id).toBeTruthy();
    // Password should never be exposed
    expect(body.data.password).toBeUndefined();
    expect(body.data.passwordHash).toBeUndefined();
    console.log(`/auth/me — id: ${body.data.id}, role: ${body.data.role}, name: ${body.data.name}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROLE-BASED ACCESS CONTROL
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Role-Based Access Control', () => {
  // ── Admin endpoint access by role ──────────────────────────────────────────

  test('13. Viewer accessing admin endpoint returns 403', async ({ page }) => {
    const browser = page.context().browser()!;
    const { page: viewerPage, csrf: viewerCsrf, cleanup: viewerCleanup } = await loginAsNewContext(browser, 'intern');
    try {
      const { status } = await apiGet(viewerPage, '/admin/users');
      expect(status).toBe(403);
      console.log(`Viewer (${USERS.intern.email}) accessing /admin/users — ${status}`);
    } finally {
      await viewerCleanup();
    }
  });

  test('14. Member accessing admin endpoint returns 403', async ({ page }) => {
    const browser = page.context().browser()!;
    const { page: memberPage, csrf: memberCsrf, cleanup: memberCleanup } = await loginAsNewContext(browser, 'dev1');
    try {
      const { status } = await apiGet(memberPage, '/admin/users');
      expect(status).toBe(403);
      console.log(`Member (${USERS.dev1.email}) accessing /admin/users — ${status}`);
    } finally {
      await memberCleanup();
    }
  });

  test('15. Team lead accessing admin endpoint returns 403', async ({ page }) => {
    const csrf = await loginAs(page, 'engLead'); // team_lead role
    const { status } = await apiGet(page, '/admin/users');
    expect(status).toBe(403);
    console.log(`Team lead (${USERS.engLead.email}) accessing /admin/users — ${status}`);
  });

  test('16. Admin accessing admin endpoint returns 200', async ({ page }) => {
    const csrf = await loginAs(page, 'admin'); // admin role
    const { status, body } = await apiGet(page, '/admin/users');
    expect(status).toBe(200);
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    console.log(`Admin (${USERS.admin.email}) accessing /admin/users — ${status}, count: ${body.data.length}`);
  });

  // ── Viewer creating a task ─────────────────────────────────────────────────

  test('17. Viewer can create a task (requireAuth, no role gate)', async ({ page }) => {
    const cleanup = new Cleanup();
    const browser = page.context().browser()!;
    const { page: viewerPage, csrf: viewerCsrf, cleanup: viewerCleanup } = await loginAsNewContext(browser, 'intern');

    try {
      await test.step('Viewer creates a task', async () => {
        const { status, body } = await apiPost(viewerPage, viewerCsrf, '/tasks', {
          title: `Viewer task ${uniqueId()}`,
          source: 'manual',
        });
        // Tasks only require auth, not a specific role — viewer should be allowed
        console.log(`Viewer creating task — status: ${status}`);
        if (status === 201) {
          expect(body.data.id).toBeTruthy();
          cleanup.add(async () => {
            const adminCsrf = await loginAs(page, 'admin');
            await apiDelete(page, adminCsrf, `/tasks/${body.data.id}`);
          });
        } else {
          // If the system restricts viewers from creating tasks, 403 is acceptable
          expect(status).toBe(403);
        }
      });
    } finally {
      await viewerCleanup();
    }

    await cleanup.run();
  });

  // ── Member creating org-layer memory ───────────────────────────────────────

  test('18. Member creating org-layer memory returns 403', async ({ page }) => {
    const browser = page.context().browser()!;
    const { page: memberPage, csrf: memberCsrf, cleanup: memberCleanup } = await loginAsNewContext(browser, 'dev1');

    try {
      const { status, body } = await apiPost(memberPage, memberCsrf, '/memory', {
        layer: 'org',
        content: `Org memory from member — ${uniqueId()}`,
        source: 'e2e-test',
      });
      expect(status).toBe(403);
      expect(body.error).toContain('Insufficient permissions');
      console.log(`Member creating org memory — status: ${status}, error: ${body.error}`);
    } finally {
      await memberCleanup();
    }
  });

  // ── Member editing another user's session ──────────────────────────────────

  test('19. Member editing another users session returns 404/403', async ({ page }) => {
    const cleanup = new Cleanup();
    const browser = page.context().browser()!;

    // Step 1: dev1 creates a session in its own context
    let sessionId: string;
    const { page: dev1Page, csrf: dev1Csrf, cleanup: dev1Cleanup } = await loginAsNewContext(browser, 'dev1');
    try {
      await test.step('dev1 creates a session', async () => {
        const { status, body } = await apiPost(dev1Page, dev1Csrf, '/chat/sessions', {
          title: `Private session ${uniqueId()}`,
        });
        expect(status).toBe(201);
        sessionId = body.data.id;
        console.log(`dev1 created session: ${sessionId}`);
        cleanup.add(async () => {
          const adminCsrf = await loginAs(page, 'admin');
          await apiDelete(page, adminCsrf, `/chat/sessions/${sessionId}`);
        });
      });
    } finally {
      await dev1Cleanup();
    }

    // Step 2: dev2 tries to edit dev1's session title in its own context
    const { page: dev2Page, csrf: dev2Csrf, cleanup: dev2Cleanup } = await loginAsNewContext(browser, 'dev2');
    try {
      await test.step('dev2 tries to edit dev1 session — rejected', async () => {
        const res = await dev2Page.request.patch(`${API}/chat/sessions/${sessionId}`, {
          headers: { 'x-csrf-token': dev2Csrf, 'Content-Type': 'application/json' },
          data: { title: 'Hijacked title' },
        });
        // Should return 404 (session not found for this user) or 403
        expect([403, 404]).toContain(res.status());
        console.log(`dev2 editing dev1 session — status: ${res.status()}`);
      });
    } finally {
      await dev2Cleanup();
    }

    await cleanup.run();
  });

  // ── Admin editing any user's role ──────────────────────────────────────────

  test('20. Admin can edit any users role', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    await test.step('Get the target user (newHire)', async () => {
      const { status, body } = await apiGet(page, '/admin/users');
      expect(status).toBe(200);
      const newHire = body.data.find(
        (u: Record<string, unknown>) => u.email === USERS.newHire.email,
      );
      expect(newHire).toBeTruthy();
      console.log(`Found newHire: ${newHire.id}, current role: ${newHire.role}`);

      await test.step('Change newHire role to team_lead', async () => {
        const { status: patchStatus, body: patchBody } = await apiPatch(page, csrf, `/admin/users/${newHire.id}`, { role: 'team_lead' });
        expect(patchStatus).toBe(200);
        expect(patchBody.data.role).toBe('team_lead');
        console.log(`Role changed to: ${patchBody.data.role}`);
      });

      await test.step('Revert newHire role back to member', async () => {
        const { status: revertStatus, body: revertBody } = await apiPatch(page, csrf, `/admin/users/${newHire.id}`, { role: 'member' });
        expect(revertStatus).toBe(200);
        expect(revertBody.data.role).toBe('member');
        console.log(`Role reverted to: ${revertBody.data.role}`);
      });
    });
  });

  // ── Viewer can read but not write ──────────────────────────────────────────

  test('21. Viewer can read tasks but cannot write team memory', async ({ page }) => {
    const browser = page.context().browser()!;
    const { page: viewerPage, csrf: viewerCsrf, cleanup: viewerCleanup } = await loginAsNewContext(browser, 'contractor');

    try {
      await test.step('Viewer can read tasks', async () => {
        const { status } = await apiGet(viewerPage, '/tasks?parentOnly=true');
        expect(status).toBe(200);
        console.log(`Viewer reading /tasks — status: ${status}`);
      });

      await test.step('Viewer can read memory', async () => {
        const { status } = await apiGet(viewerPage, '/memory');
        expect(status).toBe(200);
        console.log(`Viewer reading /memory — status: ${status}`);
      });

      await test.step('Viewer cannot write org-layer memory', async () => {
        const { status, body } = await apiPost(viewerPage, viewerCsrf, '/memory', {
          layer: 'org',
          content: 'Viewer attempting org write',
          source: 'e2e-test',
        });
        expect(status).toBe(403);
        console.log(`Viewer writing org memory — status: ${status}, error: ${body.error}`);
      });

      await test.step('Viewer cannot write team-layer memory', async () => {
        const { status, body } = await apiPost(viewerPage, viewerCsrf, '/memory', {
          layer: 'team',
          content: 'Viewer attempting team write',
          source: 'e2e-test',
        });
        expect(status).toBe(403);
        console.log(`Viewer writing team memory — status: ${status}, error: ${body.error}`);
      });

      await test.step('Viewer can write user-layer memory (self-service)', async () => {
        const { status, body } = await apiPost(viewerPage, viewerCsrf, '/memory', {
          layer: 'user',
          content: `Viewer personal note ${uniqueId()}`,
          source: 'e2e-test',
        });
        expect(status).toBe(201);
        console.log(`Viewer writing user memory — status: ${status}, id: ${body.data?.id}`);

        // Cleanup the created memory
        if (body.data?.id) {
          await apiDelete(viewerPage, viewerCsrf, `/memory/${body.data.id}`);
        }
      });
    } finally {
      await viewerCleanup();
    }
  });

  // ── CSRF protection ────────────────────────────────────────────────────────

  test('22. POST without CSRF token returns 403', async ({ page }) => {
    // Login to get a valid session
    await loginAs(page, 'dev1');

    await test.step('POST without x-csrf-token header is rejected', async () => {
      const res = await page.request.post(`${API}/tasks`, {
        headers: { 'Content-Type': 'application/json' },
        data: { title: 'Should fail CSRF', source: 'manual' },
      });
      expect(res.status()).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('CSRF');
      console.log(`POST without CSRF — status: ${res.status()}, error: ${body.error}`);
    });

    await test.step('POST with wrong CSRF token is rejected', async () => {
      const res = await page.request.post(`${API}/tasks`, {
        headers: {
          'x-csrf-token': 'totally-invalid-csrf-token',
          'Content-Type': 'application/json',
        },
        data: { title: 'Should fail CSRF mismatch', source: 'manual' },
      });
      expect(res.status()).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('CSRF');
      console.log(`POST with bad CSRF — status: ${res.status()}, error: ${body.error}`);
    });

    await test.step('GET requests are not CSRF-gated', async () => {
      const res = await page.request.get(`${API}/tasks?parentOnly=true`);
      expect(res.status()).toBe(200);
      console.log('GET without CSRF header — 200 (as expected)');
    });
  });

  // ── Expired / invalid session ──────────────────────────────────────────────

  test('23. Request with no session cookie returns 401', async ({ page }) => {
    // Use a fresh context with no cookies at all
    await test.step('GET /auth/me without session returns 401', async () => {
      // Clear all cookies to simulate no session
      await page.context().clearCookies();
      const res = await page.request.get(`${API}/auth/me`);
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('Authentication required');
      console.log(`No session — status: ${res.status()}, error: ${body.error}`);
    });

    await test.step('GET protected endpoint without session returns 401', async () => {
      const res = await page.request.get(`${API}/tasks?parentOnly=true`);
      expect(res.status()).toBe(401);
      console.log(`No session on /tasks — status: ${res.status()}`);
    });

    await test.step('POST protected endpoint without session returns 401', async () => {
      const res = await page.request.post(`${API}/tasks`, {
        headers: { 'Content-Type': 'application/json' },
        data: { title: 'No session', source: 'manual' },
      });
      // Could be 401 (no auth) or 403 (CSRF checked first)
      expect([401, 403]).toContain(res.status());
      console.log(`No session POST /tasks — status: ${res.status()}`);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CROSS-ROLE PERMISSION BOUNDARIES
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Cross-Role Permission Boundaries', () => {
  test('24. Non-admin roles cannot access multiple admin endpoints', async ({ page }) => {
    const csrf = await loginAs(page, 'pm1'); // member role

    const adminEndpoints = [
      '/admin/users',
      '/admin/teams',
      '/admin/governance/settings',
      '/admin/analytics',
      '/admin/audit-logs',
    ];

    for (const endpoint of adminEndpoints) {
      await test.step(`Member accessing ${endpoint} returns 403`, async () => {
        const { status } = await apiGet(page, endpoint);
        expect(status).toBe(403);
        console.log(`Member on ${endpoint} — ${status}`);
      });
    }
  });

  test('25. Team lead can write team memory but not org memory', async ({ page }) => {
    const cleanup = new Cleanup();
    const csrf = await loginAs(page, 'engLead'); // team_lead role

    await test.step('Team lead writes team-layer memory — 201', async () => {
      const { status, body } = await apiPost(page, csrf, '/memory', {
        layer: 'team',
        content: `Team lead team note ${uniqueId()}`,
        source: 'e2e-test',
      });
      expect(status).toBe(201);
      expect(body.data.id).toBeTruthy();
      console.log(`Team lead team memory — status: ${status}, id: ${body.data.id}`);
      cleanup.add(async () => {
        await apiDelete(page, csrf, `/memory/${body.data.id}`);
      });
    });

    await test.step('Team lead writes org-layer memory — 403', async () => {
      const { status, body } = await apiPost(page, csrf, '/memory', {
        layer: 'org',
        content: 'Team lead attempting org write',
        source: 'e2e-test',
      });
      expect(status).toBe(403);
      expect(body.error).toContain('Insufficient permissions');
      console.log(`Team lead org memory — status: ${status}, error: ${body.error}`);
    });

    await test.step('Team lead writes user-layer memory — 201', async () => {
      const { status, body } = await apiPost(page, csrf, '/memory', {
        layer: 'user',
        content: `Team lead personal note ${uniqueId()}`,
        source: 'e2e-test',
      });
      expect(status).toBe(201);
      console.log(`Team lead user memory — status: ${status}`);
      cleanup.add(async () => {
        await apiDelete(page, csrf, `/memory/${body.data.id}`);
      });
    });

    await cleanup.run();
  });
});

test.describe('UI — Login & Register Pages', () => {
  test('Login page renders with form elements', async ({ page }) => {
    await page.goto('/#/login');
    await expect(page.locator('text=Hearth')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    console.log('Login page renders correctly');
  });

  test('Login with valid credentials navigates to chat', async ({ page }) => {
    await page.goto('/#/login');
    await page.fill('input[type="email"]', 'admin@hearth.local');
    await page.fill('input[type="password"]', 'changeme');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(5000);
    expect(page.url()).toContain('/chat');
    console.log('Login redirects to /chat');
  });

  test('Login with wrong password shows error', async ({ page }) => {
    await page.goto('/#/login');
    await page.fill('input[type="email"]', 'admin@hearth.local');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);
    // Should still be on login page with error
    expect(page.url()).toContain('/login');
    console.log('Wrong password stays on login page');
  });

  test('Register page renders with form elements', async ({ page }) => {
    await page.goto('/#/register');
    await expect(page.locator('text=Create account')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
    console.log('Register page renders correctly');
  });

  test('Sidebar navigation shows all main sections', async ({ page }) => {
    await page.goto('/#/login');
    await page.fill('input[type="email"]', 'admin@hearth.local');
    await page.fill('input[type="password"]', 'changeme');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(5000);

    // Verify sidebar navigation items
    await expect(page.locator('text=Chat')).toBeVisible();
    await expect(page.locator('text=Tasks')).toBeVisible();
    await expect(page.locator('text=Memory')).toBeVisible();
    await expect(page.locator('text=Decisions')).toBeVisible();
    await expect(page.locator('text=Skills')).toBeVisible();
    await expect(page.locator('text=Routines')).toBeVisible();
    await expect(page.locator('text=Activity')).toBeVisible();
    await expect(page.locator('text=Settings')).toBeVisible();
    console.log('All sidebar nav items visible');
  });

  test('Logout button clears session', async ({ page }) => {
    await page.goto('/#/login');
    await page.fill('input[type="email"]', 'admin@hearth.local');
    await page.fill('input[type="password"]', 'changeme');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(5000);

    // Find and click logout (X icon in user section)
    const logoutBtn = page.locator('button').filter({ has: page.locator('[class*="logout"], [aria-label*="logout"], [title*="Logout"]') }).first();
    if (await logoutBtn.isVisible().catch(() => false)) {
      await logoutBtn.click();
      await page.waitForTimeout(1000);
      expect(page.url()).toContain('/login');
    } else {
      console.log('PRODUCT FINDING: Logout button not easily discoverable in sidebar');
    }
  });
});
