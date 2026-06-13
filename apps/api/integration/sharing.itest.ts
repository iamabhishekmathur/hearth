/**
 * Sharing integration tests — create a public share link and resolve it
 * anonymously, plus the share-lifecycle defects.
 *
 * Routes under test (sharing router is mounted at /api/v1, see src/routes/sharing.ts):
 *   POST /api/v1/chat/sessions/:id/share   (auth; owner only)
 *   GET  /api/v1/shared/:token             (PUBLIC, no auth)
 *
 * Defects pinned:
 *   SHARE-E-02   — archiving a shared session does NOT invalidate the link
 *                  (getSharedSession never checks session.status)
 *   SHARE-ERR-02 — there is no revoke/DELETE endpoint for a share link
 */
import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import {
  prisma,
  anonAgent,
  seedAuthFixture,
  loginAgent,
  truncateAll,
  disconnect,
  type AuthFixture,
} from './setup.js';

let fx: AuthFixture;

beforeEach(async () => {
  await truncateAll();
  fx = await seedAuthFixture();
});

afterAll(async () => {
  await disconnect();
});

/** Owner creates a session with one message and a share link; returns ids/token. */
async function makeSharedSession() {
  const admin = await loginAgent('admin');
  const created = await admin.post('/api/v1/chat/sessions', { title: 'Shareworthy' });
  const sessionId = created.body.data.id;
  // Seed a message row directly so the share has content to render.
  await prisma.chatMessage.create({
    data: { orgId: fx.primary.orgId, sessionId, role: 'user' as never, content: 'hello world' },
  });
  const share = await admin.post(`/api/v1/chat/sessions/${sessionId}/share`, { contentFilter: 'all' });
  expect(share.status).toBe(201);
  const token = share.body.data.token;
  expect(token).toBeTruthy();
  return { admin, sessionId, token };
}

describe('sharing — create & anonymous resolve', () => {
  it('owner creates a share link (201); anon GET /shared/:token returns the session (200)', async () => {
    const { token } = await makeSharedSession();

    const anon = anonAgent();
    const res = await anon.get(`/api/v1/shared/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.session).toBeTruthy();
    expect(res.body.data.messages.length).toBeGreaterThanOrEqual(1);
  });

  it('a non-owner cannot create a share link for someone else’s session (404)', async () => {
    const admin = await loginAgent('admin');
    const created = await admin.post('/api/v1/chat/sessions', {});
    const sessionId = created.body.data.id;

    const member = await loginAgent('member');
    const res = await member.post(`/api/v1/chat/sessions/${sessionId}/share`, { contentFilter: 'all' });
    expect(res.status).toBe(404);
  });

  it('an unknown token returns 404', async () => {
    const anon = anonAgent();
    const res = await anon.get('/api/v1/shared/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('an expired share link returns 404', async () => {
    const { sessionId } = await makeSharedSession();
    // Create an already-expired share directly.
    const expired = await prisma.sessionShare.create({
      data: {
        orgId: fx.primary.orgId,
        sessionId,
        shareType: 'full',
        createdBy: fx.users.admin.id,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const anon = anonAgent();
    const res = await anon.get(`/api/v1/shared/${expired.token}`);
    expect(res.status).toBe(404);
  });
});

describe('sharing — lifecycle defects', () => {
  it('FIXED (SHARE-E-02): archiving the session invalidates the share link', async () => {
    const { admin, sessionId, token } = await makeSharedSession();

    // Owner archives the session.
    const archived = await admin.del(`/api/v1/chat/sessions/${sessionId}`);
    expect(archived.status).toBe(200);
    expect((await prisma.chatSession.findUnique({ where: { id: sessionId } }))?.status).toBe('archived');

    // getSharedSession now rejects a non-active underlying session, so the
    // public link no longer leaks an archived conversation.
    const anon = anonAgent();
    const res = await anon.get(`/api/v1/shared/${token}`);
    // FIXED (SHARE-E-02): archived session is no longer publicly viewable.
    expect(res.status).toBe(404);
  });

  it('FIXED (SHARE-ERR-02): an owner can revoke a share link (DELETE /:id/share)', async () => {
    const { admin, sessionId, token } = await makeSharedSession();

    // The link works before revocation.
    expect((await anonAgent().get(`/api/v1/shared/${token}`)).status).toBe(200);

    // There's still no per-token DELETE route (404), but the session-scoped
    // revoke endpoint now exists and revokes every link for the session.
    expect((await admin.del(`/api/v1/shared/${token}`)).status).toBe(404);
    const delBySession = await admin.del(`/api/v1/chat/sessions/${sessionId}/share`);
    expect(delBySession.status).toBe(200);

    // FIXED (SHARE-ERR-02): the link no longer resolves after revocation.
    const anon = anonAgent();
    expect((await anon.get(`/api/v1/shared/${token}`)).status).toBe(404);
  });
});
