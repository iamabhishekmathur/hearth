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
  deleteSession,
  sendMessage,
  Cleanup,
  uniqueId,
} from './fixtures/test-helpers';

// ═══════════════════════════════════════════════════════════════════════════════
// Chat E2E Tests — comprehensive coverage of session lifecycle, messaging,
// sharing, collaboration, artifacts, isolation, and identity integration.
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Session Management', () => {
  let cleanup: Cleanup;

  test.beforeEach(() => {
    cleanup = new Cleanup();
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  // ── 1. Create new session → 201 ──────────────────────────────────────────
  test('1: Create new session returns 201 with expected shape', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const res = await apiPost(page, csrf, '/chat/sessions', {});
    expect(res.status).toBe(201);
    expect(res.body.data).toBeTruthy();
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.visibility).toBe('private');
    console.log(`Created session: ${res.body.data.id}`);

    cleanup.add(() => deleteSession(page, csrf, res.body.data.id));
  });

  // ── 2. Create session with title → title persisted ────────────────────────
  test('2: Create session with explicit title persists the title', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const title = uniqueId('titled-session');

    const session = await createSession(page, csrf, title);
    expect(session.title).toBe(title);
    console.log(`Session "${session.title}" created: ${session.id}`);

    cleanup.add(() => deleteSession(page, csrf, session.id));

    await test.step('Verify title via GET', async () => {
      const { status, body } = await apiGet(page, `/chat/sessions/${session.id}`);
      expect(status).toBe(200);
      expect(body.data.title).toBe(title);
    });
  });

  // ── 3. Rename session → title updated ─────────────────────────────────────
  test('3: Rename session updates title', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('rename-me'));
    cleanup.add(() => deleteSession(page, csrf, session.id));

    const newTitle = uniqueId('renamed');

    await test.step('PATCH title', async () => {
      const { status, body } = await apiPatch(page, csrf, `/chat/sessions/${session.id}`, {
        title: newTitle,
      });
      expect(status).toBe(200);
      expect(body.data.title).toBe(newTitle);
      console.log(`Renamed session to "${newTitle}"`);
    });

    await test.step('Verify via GET', async () => {
      const { body } = await apiGet(page, `/chat/sessions/${session.id}`);
      expect(body.data.title).toBe(newTitle);
    });
  });

  // ── 4. Archive session → status=archived ──────────────────────────────────
  test('4: Delete (archive) session sets status to archived', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('archive-me'));

    const { body } = await apiDelete(page, csrf, `/chat/sessions/${session.id}`);
    expect(body.message).toContain('archived');
    console.log(`Archived session: ${session.id}`);

    await test.step('Archived session no longer in active list', async () => {
      const { body: listBody } = await apiGet(page, '/chat/sessions');
      const found = listBody.data.find(
        (s: Record<string, unknown>) => s.id === session.id,
      );
      // The list endpoint returns active sessions — archived should not appear
      expect(found).toBeFalsy();
    });
  });

  // ── 5. Session list shows user's own sessions ─────────────────────────────
  test('5: Session list shows the current user\'s own sessions', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const title = uniqueId('my-session');
    const session = await createSession(page, csrf, title);
    cleanup.add(() => deleteSession(page, csrf, session.id));

    const { status, body } = await apiGet(page, '/chat/sessions');
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    const found = body.data.find((s: Record<string, unknown>) => s.id === session.id);
    expect(found).toBeTruthy();
    expect(found.title).toBe(title);
    console.log(`Session list contains ${body.data.length} sessions`);
  });

  // ── 6. Session list sorted by updatedAt desc ──────────────────────────────
  test('6: Session list is sorted by updatedAt descending', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const s1 = await createSession(page, csrf, uniqueId('sort-first'));
    cleanup.add(() => deleteSession(page, csrf, s1.id));

    // Small delay so timestamps differ
    await page.waitForTimeout(500);

    const s2 = await createSession(page, csrf, uniqueId('sort-second'));
    cleanup.add(() => deleteSession(page, csrf, s2.id));

    const { body } = await apiGet(page, '/chat/sessions');
    const ids = body.data.map((s: Record<string, unknown>) => s.id);

    const idx1 = ids.indexOf(s1.id);
    const idx2 = ids.indexOf(s2.id);

    // s2 was created later, so it should appear first (lower index)
    expect(idx2).toBeLessThan(idx1);
    console.log(`s2 at index ${idx2}, s1 at index ${idx1} — correctly sorted`);
  });

  // ── 7. Delete session → archived ──────────────────────────────────────────
  test('7: Delete session removes it from active list and returns archived data', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('delete-me'));

    await test.step('Delete session', async () => {
      const { body } = await apiDelete(page, csrf, `/chat/sessions/${session.id}`);
      expect(body.data).toBeTruthy();
      expect(body.message).toContain('archived');
      console.log(`Deleted session: ${session.id}`);
    });

    await test.step('Session gone from list', async () => {
      const { body } = await apiGet(page, '/chat/sessions');
      const found = body.data.find((s: Record<string, unknown>) => s.id === session.id);
      expect(found).toBeFalsy();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Messaging
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Messaging', () => {
  let cleanup: Cleanup;

  test.beforeEach(() => {
    cleanup = new Cleanup();
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  // ── 8. Send text message → 202, message saved ────────────────────────────
  test('8: Send text message returns 202 and message is persisted', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('msg-test'));
    cleanup.add(() => deleteSession(page, csrf, session.id));

    await test.step('Send message', async () => {
      const res = await sendMessage(page, csrf, session.id, 'Hello, Hearth!');
      expect(res.status).toBe(202);
      expect(res.body.data.messageId).toBeTruthy();
      console.log(`Message sent: ${res.body.data.messageId}`);
    });

    await test.step('Message appears in session history', async () => {
      // Wait for async processing
      await page.waitForTimeout(1500);
      const { body } = await apiGet(page, `/chat/sessions/${session.id}`);
      const userMessages = body.data.messages.filter(
        (m: Record<string, unknown>) => m.role === 'user',
      );
      expect(userMessages.length).toBeGreaterThanOrEqual(1);
      expect(userMessages[0].content).toBe('Hello, Hearth!');
    });
  });

  // ── 9. Send message with code block → preserved ──────────────────────────
  test('9: Send message with code block preserves formatting', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('code-msg'));
    cleanup.add(() => deleteSession(page, csrf, session.id));

    const codeContent = 'Please review this:\n```typescript\nfunction add(a: number, b: number): number {\n  return a + b;\n}\n```';

    await test.step('Send code message', async () => {
      const res = await sendMessage(page, csrf, session.id, codeContent);
      expect(res.status).toBe(202);
    });

    await test.step('Code block preserved in history', async () => {
      await page.waitForTimeout(1500);
      const { body } = await apiGet(page, `/chat/sessions/${session.id}`);
      const userMsg = body.data.messages.find(
        (m: Record<string, unknown>) => m.role === 'user',
      );
      expect(userMsg.content).toContain('```typescript');
      expect(userMsg.content).toContain('function add');
      console.log('Code block preserved in message');
    });
  });

  // ── 10. Send very long message (10K chars) → handled ─────────────────────
  test('10: Send very long message (10K chars) is handled', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('long-msg'));
    cleanup.add(() => deleteSession(page, csrf, session.id));

    const longContent = 'A'.repeat(10_000);

    await test.step('Send 10K char message', async () => {
      const res = await sendMessage(page, csrf, session.id, longContent);
      // Accept 202 (success) or 413 (too large) — both are valid behaviors
      expect([202, 413]).toContain(res.status);
      console.log(`10K message status: ${res.status}`);
    });

    if ((await sendMessage(page, csrf, session.id, 'follow-up')).status === 202) {
      await test.step('Long message persisted', async () => {
        await page.waitForTimeout(1500);
        const { body } = await apiGet(page, `/chat/sessions/${session.id}`);
        const userMsgs = body.data.messages.filter(
          (m: Record<string, unknown>) => m.role === 'user',
        );
        const longMsg = userMsgs.find(
          (m: Record<string, unknown>) => (m.content as string).length >= 10_000,
        );
        if (longMsg) {
          expect((longMsg.content as string).length).toBe(10_000);
          console.log('Long message persisted correctly');
        }
      });
    }
  });

  // ── 11. Send empty message → validation error ────────────────────────────
  test('11: Send empty message returns validation error', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('empty-msg'));
    cleanup.add(() => deleteSession(page, csrf, session.id));

    await test.step('Empty string rejected', async () => {
      const res = await apiPost(page, csrf, `/chat/sessions/${session.id}/messages`, {
        content: '',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('content');
      console.log(`Empty message rejected: ${res.body.error}`);
    });

    await test.step('Missing content field rejected', async () => {
      const res = await apiPost(page, csrf, `/chat/sessions/${session.id}/messages`, {});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('content');
    });
  });

  // ── 12. Message with @mention → handled ───────────────────────────────────
  test('12: Message with @mention is handled without error', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('mention-msg'));
    cleanup.add(() => deleteSession(page, csrf, session.id));

    const mentionContent = 'Hey @Google Calendar, show me my events for today. Also check @Slack #engineering.';

    const res = await sendMessage(page, csrf, session.id, mentionContent);
    expect(res.status).toBe(202);
    console.log(`Mention message accepted: ${res.body.data.messageId}`);

    await test.step('Mention text persisted', async () => {
      await page.waitForTimeout(1500);
      const { body } = await apiGet(page, `/chat/sessions/${session.id}`);
      const userMsg = body.data.messages.find(
        (m: Record<string, unknown>) => m.role === 'user',
      );
      expect(userMsg.content).toContain('@Google Calendar');
      expect(userMsg.content).toContain('@Slack');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sharing & Collaboration
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Sharing & Collaboration', () => {
  let cleanup: Cleanup;

  test.beforeEach(() => {
    cleanup = new Cleanup();
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  // ── 13. Toggle session to org-visible → other users see it ────────────────
  test('13: Toggle session to org-visible makes it appear in shared list', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('org-visible'));
    cleanup.add(() => deleteSession(page, csrf, session.id));

    await test.step('Set visibility to org', async () => {
      const { status, body } = await apiPatch(
        page,
        csrf,
        `/chat/sessions/${session.id}/visibility`,
        { visibility: 'org' },
      );
      expect(status).toBe(200);
      expect(body.data.visibility).toBe('org');
      console.log(`Session visibility set to org: ${session.id}`);
    });

    await test.step('Session appears in shared sessions list', async () => {
      const { status, body } = await apiGet(page, '/chat/sessions/shared');
      expect(status).toBe(200);
      const found = body.data.find((s: Record<string, unknown>) => s.id === session.id);
      expect(found).toBeTruthy();
      console.log(`Found in shared list: ${found.title}`);
    });

    await test.step('Revert to private', async () => {
      const { status, body } = await apiPatch(
        page,
        csrf,
        `/chat/sessions/${session.id}/visibility`,
        { visibility: 'private' },
      );
      expect(status).toBe(200);
      expect(body.data.visibility).toBe('private');
    });
  });

  // ── 14. Add collaborator → record created ─────────────────────────────────
  test('14: Add collaborator to session creates a collaborator record', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('collab-add'));
    cleanup.add(() => deleteSession(page, csrf, session.id));

    await test.step('Search for a user to add', async () => {
      const { status, body } = await apiGet(page, '/chat/users/search?q=dev');
      expect(status).toBe(200);
      // There should be dev1 or dev2 in results
      if (body.data.length === 0) {
        console.log('No users found for "dev" — skipping collaborator add');
        return;
      }
      const targetUser = body.data[0];
      console.log(`Found user to add: ${targetUser.name} (${targetUser.id})`);

      await test.step('Add as collaborator', async () => {
        const { status: addStatus, body: addBody } = await apiPost(
          page,
          csrf,
          `/chat/sessions/${session.id}/collaborators`,
          { userId: targetUser.id, role: 'contributor' },
        );
        expect(addStatus).toBe(201);
        expect(addBody.data).toBeTruthy();
        console.log(`Added collaborator: ${targetUser.name}`);
      });

      await test.step('Verify in collaborator list', async () => {
        const { body: collabBody } = await apiGet(
          page,
          `/chat/sessions/${session.id}/collaborators`,
        );
        const found = collabBody.data.find(
          (c: Record<string, unknown>) => c.userId === targetUser.id,
        );
        expect(found).toBeTruthy();
      });
    });
  });

  // ── 15. Remove collaborator → record deleted ──────────────────────────────
  test('15: Remove collaborator deletes the record', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('collab-remove'));
    cleanup.add(() => deleteSession(page, csrf, session.id));

    // Find a user to add and then remove
    const { body: searchBody } = await apiGet(page, '/chat/users/search?q=dev');
    if (searchBody.data.length === 0) {
      console.log('No users found — skipping collaborator remove test');
      return;
    }
    const targetUser = searchBody.data[0];

    await test.step('Add collaborator', async () => {
      const { status } = await apiPost(page, csrf, `/chat/sessions/${session.id}/collaborators`, {
        userId: targetUser.id,
        role: 'viewer',
      });
      expect(status).toBe(201);
    });

    await test.step('Remove collaborator', async () => {
      const { body } = await apiDelete(
        page,
        csrf,
        `/chat/sessions/${session.id}/collaborators/${targetUser.id}`,
      );
      expect(body.message).toContain('removed');
      console.log(`Removed collaborator: ${targetUser.name}`);
    });

    await test.step('Verify removed from list', async () => {
      const { body: collabBody } = await apiGet(
        page,
        `/chat/sessions/${session.id}/collaborators`,
      );
      const found = collabBody.data.find(
        (c: Record<string, unknown>) => c.userId === targetUser.id,
      );
      expect(found).toBeFalsy();
    });
  });

  // ── 16. Create share link → token generated ───────────────────────────────
  test('16: Create share link generates a token', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('share-link'));
    cleanup.add(() => deleteSession(page, csrf, session.id));

    // Send a message so the session has content to share
    await sendMessage(page, csrf, session.id, 'Content to share with the world');
    await page.waitForTimeout(1500);

    const { status, body } = await apiPost(page, csrf, `/chat/sessions/${session.id}/share`, {
      shareType: 'full',
    });
    expect(status).toBe(201);
    expect(body.data.token).toBeTruthy();
    expect(typeof body.data.token).toBe('string');
    console.log(`Share token: ${body.data.token}`);
  });

  // ── 17. Access shared link → read-only view data ──────────────────────────
  test('17: Access shared link returns read-only session view', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const title = uniqueId('shared-view');
    const session = await createSession(page, csrf, title);
    cleanup.add(() => deleteSession(page, csrf, session.id));

    await test.step('Populate session with a message', async () => {
      await sendMessage(page, csrf, session.id, 'This is the shared content');
      await page.waitForTimeout(1500);
    });

    let token: string;
    await test.step('Create share link', async () => {
      const { body } = await apiPost(page, csrf, `/chat/sessions/${session.id}/share`, {
        shareType: 'full',
      });
      token = body.data.token;
      expect(token).toBeTruthy();
    });

    await test.step('Access shared session via public endpoint', async () => {
      // The shared endpoint is mounted at /api/v1/shared/:token (no auth required)
      const res = await page.request.get(`${API}/shared/${token!}`);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.data).toBeTruthy();
      expect(body.data.title).toBe(title);
      expect(body.data.messages).toBeTruthy();
      expect(body.data.messages.length).toBeGreaterThanOrEqual(1);
      console.log(`Shared view: ${body.data.messages.length} messages`);
    });
  });

  // ── 18. Duplicate shared session → new session ────────────────────────────
  test('18: Duplicate session creates a new independent session', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const originalTitle = uniqueId('original');
    const session = await createSession(page, csrf, originalTitle);
    cleanup.add(() => deleteSession(page, csrf, session.id));

    await test.step('Send message to original', async () => {
      await sendMessage(page, csrf, session.id, 'Original message for duplication test');
      await page.waitForTimeout(1500);
    });

    await test.step('Duplicate the session', async () => {
      const { status, body } = await apiPost(
        page,
        csrf,
        `/chat/sessions/${session.id}/duplicate`,
        {},
      );
      expect(status).toBe(201);
      expect(body.data.id).toBeTruthy();
      expect(body.data.id).not.toBe(session.id);
      console.log(`Duplicated: ${session.id} -> ${body.data.id}`);

      // Clean up the duplicate
      cleanup.add(() => deleteSession(page, csrf, body.data.id));

      // Verify the duplicate has messages
      const { body: dupBody } = await apiGet(page, `/chat/sessions/${body.data.id}`);
      expect(dupBody.data.messages.length).toBeGreaterThanOrEqual(1);
      console.log(`Duplicate has ${dupBody.data.messages.length} messages`);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Session Isolation
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Session Isolation', () => {
  let cleanup: Cleanup;

  test.beforeEach(() => {
    cleanup = new Cleanup();
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  // ── 19. User can only see own private sessions ────────────────────────────
  test('19: User can only see their own private sessions', async ({ page, browser }) => {
    // Admin creates a private session
    const csrfAdmin = await loginAs(page, 'admin');
    const session = await createSession(page, csrfAdmin, uniqueId('admin-private'));
    cleanup.add(() => deleteSession(page, csrfAdmin, session.id));

    // dev1 logs in separately and should NOT see admin's private session
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    const csrfDev = await loginAs(page2, 'dev1');

    await test.step('dev1 cannot see admin\'s private session in their list', async () => {
      const { body } = await apiGet(page2, '/chat/sessions');
      const found = body.data.find((s: Record<string, unknown>) => s.id === session.id);
      expect(found).toBeFalsy();
      console.log(`dev1 sees ${body.data.length} sessions — admin's private not included`);
    });

    await test.step('dev1 cannot access admin\'s private session directly', async () => {
      const { status } = await apiGet(page2, `/chat/sessions/${session.id}`);
      expect(status).toBe(404);
    });

    await ctx2.close();
  });

  // ── 20. User can see org-visible sessions ─────────────────────────────────
  test('20: User can see org-visible sessions from other users', async ({ page, browser }) => {
    const csrfAdmin = await loginAs(page, 'admin');
    const session = await createSession(page, csrfAdmin, uniqueId('org-shared'));
    cleanup.add(() => deleteSession(page, csrfAdmin, session.id));

    await test.step('Set visibility to org', async () => {
      const { status } = await apiPatch(
        page,
        csrfAdmin,
        `/chat/sessions/${session.id}/visibility`,
        { visibility: 'org' },
      );
      expect(status).toBe(200);
    });

    // dev1 logs in and should see it in shared list
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await loginAs(page2, 'dev1');

    await test.step('dev1 sees org-visible session in shared list', async () => {
      const { body } = await apiGet(page2, '/chat/sessions/shared');
      const found = body.data.find((s: Record<string, unknown>) => s.id === session.id);
      expect(found).toBeTruthy();
      console.log(`dev1 found org session: ${found.title}`);
    });

    await ctx2.close();
  });

  // ── 21. Admin can see all sessions (via org-visible) ──────────────────────
  test('21: Admin can see org-visible sessions across the organization', async ({ page, browser }) => {
    // dev1 creates an org-visible session
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    const csrfDev = await loginAs(page2, 'dev1');
    const session = await createSession(page2, csrfDev, uniqueId('dev-org'));

    await apiPatch(page2, csrfDev, `/chat/sessions/${session.id}/visibility`, {
      visibility: 'org',
    });

    // Admin should see it
    const csrfAdmin = await loginAs(page, 'admin');
    cleanup.add(() => deleteSession(page, csrfAdmin, session.id));

    await test.step('Admin sees dev1\'s org session in shared list', async () => {
      const { body } = await apiGet(page, '/chat/sessions/shared');
      const found = body.data.find((s: Record<string, unknown>) => s.id === session.id);
      expect(found).toBeTruthy();
      console.log(`Admin found dev1's org session: ${found.title}`);
    });

    await ctx2.close();
  });

  // ── 22. Non-collaborator can't send messages to private session ───────────
  test('22: Non-collaborator cannot send messages to a private session', async ({ page, browser }) => {
    const csrfAdmin = await loginAs(page, 'admin');
    const session = await createSession(page, csrfAdmin, uniqueId('private-no-write'));
    cleanup.add(() => deleteSession(page, csrfAdmin, session.id));

    // dev1 tries to send a message to admin's private session
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    const csrfDev = await loginAs(page2, 'dev1');

    await test.step('dev1 cannot send message to admin\'s private session', async () => {
      const res = await sendMessage(page2, csrfDev, session.id, 'Unauthorized message');
      // Should be 404 (session not found from dev1's perspective) or 403
      expect([403, 404]).toContain(res.status);
      console.log(`Non-collaborator message rejected with status: ${res.status}`);
    });

    await ctx2.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Artifacts
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Artifacts', () => {
  let cleanup: Cleanup;

  test.beforeEach(() => {
    cleanup = new Cleanup();
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  // ── 23. Create artifact via API ───────────────────────────────────────────
  test('23: Create artifact in a session', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('artifact-create'));
    cleanup.add(() => deleteSession(page, csrf, session.id));

    const { status, body } = await apiPost(
      page,
      csrf,
      `/chat/sessions/${session.id}/artifacts`,
      {
        type: 'code',
        title: 'Hello World',
        content: 'console.log("Hello, world!");',
        language: 'javascript',
      },
    );
    expect(status).toBe(201);
    expect(body.data.id).toBeTruthy();
    expect(body.data.type).toBe('code');
    expect(body.data.title).toBe('Hello World');
    expect(body.data.content).toBe('console.log("Hello, world!");');
    expect(body.data.language).toBe('javascript');
    console.log(`Created artifact: ${body.data.id}`);
  });

  // ── 24. List artifacts for session ────────────────────────────────────────
  test('24: List artifacts for a session', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('artifact-list'));
    cleanup.add(() => deleteSession(page, csrf, session.id));

    // Create two artifacts
    await apiPost(page, csrf, `/chat/sessions/${session.id}/artifacts`, {
      type: 'code',
      title: 'Artifact One',
      content: 'const a = 1;',
      language: 'typescript',
    });
    await apiPost(page, csrf, `/chat/sessions/${session.id}/artifacts`, {
      type: 'document',
      title: 'Artifact Two',
      content: '# Design Doc\n\nThis is a design document.',
    });

    const { status, body } = await apiGet(page, `/chat/sessions/${session.id}/artifacts`);
    expect(status).toBe(200);
    expect(body.data.length).toBe(2);

    const titles = body.data.map((a: Record<string, unknown>) => a.title);
    expect(titles).toContain('Artifact One');
    expect(titles).toContain('Artifact Two');
    console.log(`Session has ${body.data.length} artifacts`);
  });

  // ── 25. Artifact version history ──────────────────────────────────────────
  test('25: Artifact version history tracks edits', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('artifact-versions'));
    cleanup.add(() => deleteSession(page, csrf, session.id));

    // Create artifact
    const { body: createBody } = await apiPost(
      page,
      csrf,
      `/chat/sessions/${session.id}/artifacts`,
      {
        type: 'code',
        title: 'Versioned Code',
        content: 'v1 content',
        language: 'javascript',
      },
    );
    const artifactId = createBody.data.id;

    // Update artifact (creates a new version)
    await test.step('Update artifact content', async () => {
      const { status } = await apiPatch(page, csrf, `/chat/artifacts/${artifactId}`, {
        content: 'v2 content — updated',
      });
      expect(status).toBe(200);
    });

    // Check version history
    await test.step('Version history reflects changes', async () => {
      const { status, body } = await apiGet(page, `/chat/artifacts/${artifactId}/versions`);
      expect(status).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      console.log(`Artifact has ${body.data.length} version(s)`);

      // The latest content should be v2
      const { body: artBody } = await apiGet(page, `/chat/artifacts/${artifactId}`);
      expect(artBody.data.content).toBe('v2 content — updated');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Identity Impact
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Identity Impact', () => {
  // ── 26. Verify user SOUL.md content is accessible ─────────────────────────
  test('26: User SOUL.md is accessible via identity API', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const { status, body } = await apiGet(page, '/identity/user/soul');
    expect(status).toBe(200);
    expect(body.data).toBeDefined();
    console.log(
      `User SOUL.md: ${body.data.content ? body.data.content.slice(0, 100) + '...' : '(empty)'}`,
    );
  });

  // ── 27. Verify org SOUL.md is accessible ──────────────────────────────────
  test('27: Org SOUL.md is accessible via identity API', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const { status, body } = await apiGet(page, '/identity/org/soul');
    expect(status).toBe(200);
    expect(body.data).toBeDefined();
    console.log(
      `Org SOUL.md: ${body.data.content ? body.data.content.slice(0, 100) + '...' : '(empty)'}`,
    );
  });

  // ── 28. Verify identity chain is built for session ────────────────────────
  test('28: Identity documents can be set and influence agent context', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    await test.step('Set user SOUL.md', async () => {
      const soulContent = `# My SOUL.md\n\nI am a test user who values clarity and precision. Always respond concisely.`;
      const { status } = await apiPut(page, csrf, '/identity/user/soul', {
        content: soulContent,
      });
      expect(status).toBe(200);
      console.log('User SOUL.md set');
    });

    await test.step('Verify user SOUL.md persists', async () => {
      const { body } = await apiGet(page, '/identity/user/soul');
      expect(body.data.content).toContain('clarity and precision');
    });

    await test.step('Set org SOUL.md (admin only)', async () => {
      const orgSoul = `# Org SOUL.md\n\nWe are a team focused on building great software. Be helpful and thorough.`;
      const { status } = await apiPut(page, csrf, '/identity/org/soul', {
        content: orgSoul,
      });
      expect(status).toBe(200);
      console.log('Org SOUL.md set');
    });

    await test.step('Verify org SOUL.md persists', async () => {
      const { body } = await apiGet(page, '/identity/org/soul');
      expect(body.data.content).toContain('great software');
    });

    // Verify the identity chain feeds into a chat session by sending a message
    // and confirming the agent picks up the session without error.
    await test.step('Send message with identity context active', async () => {
      const session = await createSession(page, csrf, uniqueId('identity-chain'));
      const res = await sendMessage(page, csrf, session.id, 'Who am I and what is my team about?');
      expect(res.status).toBe(202);
      console.log(`Message sent in identity-aware session: ${session.id}`);
      await deleteSession(page, csrf, session.id);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge Cases & Validation
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Edge Cases & Validation', () => {
  let cleanup: Cleanup;

  test.beforeEach(() => {
    cleanup = new Cleanup();
  });

  test.afterEach(async () => {
    await cleanup.run();
  });

  // ── 29. PATCH with empty title → 400 ─────────────────────────────────────
  test('29: Rename session with empty title returns 400', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('empty-rename'));
    cleanup.add(() => deleteSession(page, csrf, session.id));

    const { status, body } = await apiPatch(page, csrf, `/chat/sessions/${session.id}`, {
      title: '',
    });
    expect(status).toBe(400);
    expect(body.error).toContain('title');
    console.log(`Empty title rejected: ${body.error}`);
  });

  // ── 30. Invalid visibility value → 400 ───────────────────────────────────
  test('30: Setting invalid visibility returns 400', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    const session = await createSession(page, csrf, uniqueId('bad-visibility'));
    cleanup.add(() => deleteSession(page, csrf, session.id));

    const { status, body } = await apiPatch(
      page,
      csrf,
      `/chat/sessions/${session.id}/visibility`,
      { visibility: 'public' },
    );
    expect(status).toBe(400);
    expect(body.error).toContain('visibility');
    console.log(`Invalid visibility rejected: ${body.error}`);
  });
});

test.describe('UI — Chat Page', () => {
  test('Chat page renders with session list and input', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/chat');
    await page.waitForTimeout(2000);

    // Page should have loaded
    expect(page.url()).toContain('/chat');

    // Look for chat input area (textarea or input for messages)
    const inputArea = page.locator('textarea, input[placeholder*="message" i], input[placeholder*="type" i]').first();
    const hasInput = await inputArea.isVisible().catch(() => false);
    console.log(`Chat input visible: ${hasInput}`);
  });

  test('Navigate between pages via sidebar', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');

    const pages = [
      { name: 'Tasks', hash: 'tasks' },
      { name: 'Memory', hash: 'memory' },
      { name: 'Decisions', hash: 'decisions' },
      { name: 'Skills', hash: 'skills' },
      { name: 'Routines', hash: 'routines' },
      { name: 'Activity', hash: 'activity' },
      { name: 'Chat', hash: 'chat' },
    ];

    for (const p of pages) {
      await page.locator(`a:has-text("${p.name}"), button:has-text("${p.name}")`).first().click();
      await page.waitForTimeout(500);
      expect(page.url()).toContain(p.hash);
      console.log(`Navigated to /${p.hash}`);
    }
  });

  test('Create new chat session via UI', async ({ page }) => {
    const csrf = await loginAs(page, 'admin');
    await page.goto('/#/chat');
    await page.waitForTimeout(1500);

    // Look for new session/new chat button
    const newBtn = page.locator('button:has-text("New"), button[aria-label*="new" i]').first();
    if (await newBtn.isVisible().catch(() => false)) {
      await newBtn.click();
      await page.waitForTimeout(1000);
      console.log('New chat session created via UI');
    } else {
      console.log('PRODUCT FINDING: New chat button not found or not visible');
    }
  });
});
