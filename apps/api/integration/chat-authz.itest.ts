/**
 * Security regression tests for chat/artifact authorization defects found by
 * the E2E harness (wave 2). Each test asserts the CORRECT behavior — they fail
 * (🔴) against the pre-fix code and pass (🟢) once the authz holes are closed.
 *
 *   1. A viewer (read-only collaborator) must NOT create artifacts.
 *   2. A non-creator must NOT delete another user's artifact.
 *   3. listCollaborators must require session access (no IDOR of names/emails).
 *   4. An owner must NOT add a cross-org user as a collaborator (tenancy).
 */
import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import { prisma, seedAuthFixture, loginAgent, truncateAll, disconnect, type AuthFixture } from './setup.js';

let fx: AuthFixture;

beforeEach(async () => {
  await truncateAll();
  fx = await seedAuthFixture();
});
afterAll(disconnect);

async function ownerSessionWithViewer(): Promise<{ ownerSid: string }> {
  const owner = await loginAgent('member');
  const sid = (await owner.post('/api/v1/chat/sessions', { title: 'Spec review' })).body.data.id;
  await owner.patch(`/api/v1/chat/sessions/${sid}/visibility`, { visibility: 'org' });
  await owner.post(`/api/v1/chat/sessions/${sid}/collaborators`, { userId: fx.users.viewer.id, role: 'viewer' });
  return { ownerSid: sid };
}

describe('chat/artifact authorization', () => {
  it('a viewer collaborator cannot create an artifact', async () => {
    const { ownerSid } = await ownerSessionWithViewer();
    const viewer = await loginAgent('viewer');
    const res = await viewer.post(`/api/v1/chat/sessions/${ownerSid}/artifacts`, { type: 'document', title: 'sneaky', content: '# hi' });
    expect(res.status).toBe(403);
  });

  it("a viewer cannot delete the owner's artifact", async () => {
    const owner = await loginAgent('member');
    const sid = (await owner.post('/api/v1/chat/sessions', { title: 's' })).body.data.id;
    await owner.post(`/api/v1/chat/sessions/${sid}/visibility`, { visibility: 'org' });
    await owner.post(`/api/v1/chat/sessions/${sid}/collaborators`, { userId: fx.users.viewer.id, role: 'viewer' });
    const artId = (await owner.post(`/api/v1/chat/sessions/${sid}/artifacts`, { type: 'document', title: 'owned', content: '# owned' })).body.data.id;
    const viewer = await loginAgent('viewer');
    const res = await viewer.del(`/api/v1/chat/artifacts/${artId}`);
    expect(res.status).toBe(403);
    // and it must still exist
    expect(await prisma.artifact.count({ where: { id: artId } })).toBe(1);
  });

  it('listing collaborators on a PRIVATE session a stranger cannot access is blocked (no IDOR)', async () => {
    // The IDOR case: a private session the stranger can neither own, collaborate
    // on, nor see via org-visibility. (For an org-visible session a same-org
    // member legitimately can read it and its collaborator list — by design.)
    const owner = await loginAgent('member');
    const sid = (await owner.post('/api/v1/chat/sessions', { title: 'private notes' })).body.data.id;
    const stranger = await loginAgent('rival'); // different org — definitely no access
    const res = await stranger.get(`/api/v1/chat/sessions/${sid}/collaborators`);
    expect([403, 404]).toContain(res.status);
  });

  it('an owner cannot add a cross-org user as a collaborator', async () => {
    const owner = await loginAgent('member');
    const sid = (await owner.post('/api/v1/chat/sessions', { title: 's' })).body.data.id;
    const res = await owner.post(`/api/v1/chat/sessions/${sid}/collaborators`, { userId: fx.users.rival.id, role: 'contributor' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.sessionCollaborator.count({ where: { sessionId: sid, userId: fx.users.rival.id } })).toBe(0);
  });
});
