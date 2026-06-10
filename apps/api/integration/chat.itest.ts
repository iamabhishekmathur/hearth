/**
 * Chat sessions integration tests — CRUD, visibility (private/org), message
 * send (202), collaborators, and cross-user access semantics.
 *
 * Routes under test (mounted at /api/v1/chat, see src/routes/chat.ts):
 *   POST   /sessions
 *   GET    /sessions/:id
 *   PATCH  /sessions/:id            (rename)
 *   PATCH  /sessions/:id/visibility
 *   DELETE /sessions/:id            (archive)
 *   POST   /sessions/:id/messages   (202 + async agent)
 *   POST   /sessions/:id/collaborators
 *   GET    /sessions/:id/collaborators
 *   POST   /sessions/:id/join
 *
 * We never assert on agent/LLM output (no API key in the test env). The agent
 * loop runs fire-and-forget after the 202; we assert only on session/message
 * rows + status codes.
 */
import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import {
  prisma,
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

describe('chat sessions — CRUD', () => {
  it('creates a session (201) owned by the caller', async () => {
    const member = await loginAgent('member');
    const res = await member.post('/api/v1/chat/sessions', { title: 'Hello' });
    expect(res.status).toBe(201);
    const id = res.body.data.id;
    expect(id).toBeTruthy();

    const row = await prisma.chatSession.findUnique({ where: { id } });
    expect(row?.userId).toBe(fx.users.member.id);
    expect(row?.visibility).toBe('private');
    expect(row?.status).toBe('active');
  });

  it('owner can GET / rename / archive its own session', async () => {
    const member = await loginAgent('member');
    const created = await member.post('/api/v1/chat/sessions', {});
    const id = created.body.data.id;

    const got = await member.get(`/api/v1/chat/sessions/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.data.id).toBe(id);

    const renamed = await member.patch(`/api/v1/chat/sessions/${id}`, { title: 'Renamed' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.title).toBe('Renamed');

    const archived = await member.del(`/api/v1/chat/sessions/${id}`);
    expect(archived.status).toBe(200);
    const row = await prisma.chatSession.findUnique({ where: { id } });
    expect(row?.status).toBe('archived');
  });

  it('rename with empty title is 400', async () => {
    const member = await loginAgent('member');
    const created = await member.post('/api/v1/chat/sessions', {});
    const id = created.body.data.id;
    const res = await member.patch(`/api/v1/chat/sessions/${id}`, { title: '  ' });
    expect(res.status).toBe(400);
  });
});

describe('chat sessions — visibility & cross-user access', () => {
  it('member opening an org-visible session owned by admin → 200', async () => {
    const admin = await loginAgent('admin');
    const created = await admin.post('/api/v1/chat/sessions', { title: 'Shared' });
    const id = created.body.data.id;

    // Make it org-visible
    const vis = await admin.patch(`/api/v1/chat/sessions/${id}/visibility`, { visibility: 'org' });
    expect(vis.status).toBe(200);
    expect(vis.body.data.visibility).toBe('org');

    const member = await loginAgent('member');
    const got = await member.get(`/api/v1/chat/sessions/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.data.id).toBe(id);
  });

  it('member opening a PRIVATE session owned by admin → 404', async () => {
    const admin = await loginAgent('admin');
    const created = await admin.post('/api/v1/chat/sessions', { title: 'Secret' });
    const id = created.body.data.id;

    const member = await loginAgent('member');
    const got = await member.get(`/api/v1/chat/sessions/${id}`);
    expect(got.status).toBe(404);
  });

  it('a rival-org user cannot see an org-visible primary session → 404', async () => {
    const admin = await loginAgent('admin');
    const created = await admin.post('/api/v1/chat/sessions', { title: 'Org Shared' });
    const id = created.body.data.id;
    await admin.patch(`/api/v1/chat/sessions/${id}/visibility`, { visibility: 'org' });

    const rival = await loginAgent('rival');
    const got = await rival.get(`/api/v1/chat/sessions/${id}`);
    expect(got.status).toBe(404);
  });

  it('visibility rejects bad value (400) and non-owner cannot change it (404)', async () => {
    const admin = await loginAgent('admin');
    const created = await admin.post('/api/v1/chat/sessions', {});
    const id = created.body.data.id;

    const bad = await admin.patch(`/api/v1/chat/sessions/${id}/visibility`, { visibility: 'public' });
    expect(bad.status).toBe(400);

    const member = await loginAgent('member');
    const denied = await member.patch(`/api/v1/chat/sessions/${id}/visibility`, { visibility: 'org' });
    expect(denied.status).toBe(404);
  });

  it('org-shared list excludes the caller’s own sessions and other-org sessions', async () => {
    const admin = await loginAgent('admin');
    const created = await admin.post('/api/v1/chat/sessions', { title: 'A' });
    const id = created.body.data.id;
    await admin.patch(`/api/v1/chat/sessions/${id}/visibility`, { visibility: 'org' });

    // Member sees it in shared list
    const member = await loginAgent('member');
    const shared = await member.get('/api/v1/chat/sessions/shared');
    expect(shared.status).toBe(200);
    const ids: string[] = (shared.body.data ?? []).map((s: { id: string }) => s.id);
    expect(ids).toContain(id);

    // Admin (owner) does NOT see its own session in the shared list
    const adminShared = await admin.get('/api/v1/chat/sessions/shared');
    const adminIds: string[] = (adminShared.body.data ?? []).map((s: { id: string }) => s.id);
    expect(adminIds).not.toContain(id);
  });
});

describe('chat — send message', () => {
  it('owner sending a message returns 202 and persists the user row', async () => {
    const member = await loginAgent('member');
    const created = await member.post('/api/v1/chat/sessions', {});
    const id = created.body.data.id;

    const res = await member.post(`/api/v1/chat/sessions/${id}/messages`, {
      content: 'first message',
    });
    expect(res.status).toBe(202);
    const messageId = res.body.data.messageId;
    expect(messageId).toBeTruthy();

    const row = await prisma.chatMessage.findUnique({ where: { id: messageId } });
    expect(row?.role).toBe('user');
    expect(row?.content).toBe('first message');
    expect(row?.createdBy).toBe(fx.users.member.id);
  });

  it('empty content is 400', async () => {
    const member = await loginAgent('member');
    const created = await member.post('/api/v1/chat/sessions', {});
    const id = created.body.data.id;
    const res = await member.post(`/api/v1/chat/sessions/${id}/messages`, {});
    expect(res.status).toBe(400);
  });

  it('a non-collaborator cannot send to someone else’s private session → 404', async () => {
    const admin = await loginAgent('admin');
    const created = await admin.post('/api/v1/chat/sessions', {});
    const id = created.body.data.id;

    const member = await loginAgent('member');
    const res = await member.post(`/api/v1/chat/sessions/${id}/messages`, { content: 'sneaky' });
    expect(res.status).toBe(404);
  });
});

describe('chat — collaborators', () => {
  it('owner adds a collaborator (201) and lists it; contributor can then send (202)', async () => {
    const admin = await loginAgent('admin');
    const created = await admin.post('/api/v1/chat/sessions', { title: 'Pair' });
    const id = created.body.data.id;

    const add = await admin.post(`/api/v1/chat/sessions/${id}/collaborators`, {
      userId: fx.users.member.id,
      role: 'contributor',
    });
    expect(add.status).toBe(201);

    const list = await admin.get(`/api/v1/chat/sessions/${id}/collaborators`);
    expect(list.status).toBe(200);
    const collabIds: string[] = (list.body.data ?? []).map((c: { userId: string }) => c.userId);
    expect(collabIds).toContain(fx.users.member.id);

    // Contributor can now read + send.
    const member = await loginAgent('member');
    const got = await member.get(`/api/v1/chat/sessions/${id}`);
    expect(got.status).toBe(200);
    const sent = await member.post(`/api/v1/chat/sessions/${id}/messages`, { content: 'collab msg' });
    expect(sent.status).toBe(202);
  });

  it('adding a collaborator requires userId (400)', async () => {
    const admin = await loginAgent('admin');
    const created = await admin.post('/api/v1/chat/sessions', {});
    const id = created.body.data.id;
    const res = await admin.post(`/api/v1/chat/sessions/${id}/collaborators`, { role: 'contributor' });
    expect(res.status).toBe(400);
  });

  it('a member joins an org-visible session as a contributor (201)', async () => {
    const admin = await loginAgent('admin');
    const created = await admin.post('/api/v1/chat/sessions', {});
    const id = created.body.data.id;
    await admin.patch(`/api/v1/chat/sessions/${id}/visibility`, { visibility: 'org' });

    const member = await loginAgent('member');
    const joined = await member.post(`/api/v1/chat/sessions/${id}/join`, {});
    expect(joined.status).toBe(201);

    const collab = await prisma.sessionCollaborator.findFirst({
      where: { sessionId: id, userId: fx.users.member.id },
    });
    expect(collab?.role).toBe('contributor');
  });
});
