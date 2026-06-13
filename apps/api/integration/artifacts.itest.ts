/**
 * Artifacts integration tests — create / version / delete, plus the role-gate
 * defects on PATCH/DELETE.
 *
 * Routes under test (mounted at /api/v1/chat, see src/routes/artifacts.ts):
 *   POST   /sessions/:sessionId/artifacts
 *   GET    /sessions/:sessionId/artifacts
 *   GET    /artifacts/:id
 *   PATCH  /artifacts/:id
 *   DELETE /artifacts/:id
 *   GET    /artifacts/:id/versions
 *
 * Access control: every artifact endpoint authorizes purely via
 * chatService.getSession(sessionId, userId) — i.e. *any session reader*
 * (owner, collaborator, or org-visible peer) can mutate. There is no
 * artifact-author or role gate (ARTIFACT-Z-01/02).
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
import { updateArtifact } from '../src/services/artifact-service.js';

let fx: AuthFixture;

beforeEach(async () => {
  await truncateAll();
  fx = await seedAuthFixture();
});

afterAll(async () => {
  await disconnect();
});

/** Create an org-visible session owned by admin and return its id. */
async function orgVisibleSession(): Promise<{ adminId: string; sessionId: string }> {
  const admin = await loginAgent('admin');
  const created = await admin.post('/api/v1/chat/sessions', { title: 'Artifact host' });
  const sessionId = created.body.data.id;
  await admin.patch(`/api/v1/chat/sessions/${sessionId}/visibility`, { visibility: 'org' });
  return { adminId: fx.users.admin.id, sessionId };
}

describe('artifacts — optimistic concurrency (ARTIFACT concurrency defect)', () => {
  it('concurrent updates do not desync version from the version-row count', async () => {
    const admin = await loginAgent('admin');
    const sid = (await admin.post('/api/v1/chat/sessions', {})).body.data.id;
    const id = (await admin.post(`/api/v1/chat/sessions/${sid}/artifacts`, {
      type: 'document', title: 'Doc', content: 'v1',
    })).body.data.id;

    // Fire several updates concurrently. With compare-and-set, each successful
    // update increments the version by exactly 1 and writes exactly one matching
    // version row — no lost updates, no duplicate version numbers.
    const N = 5;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        updateArtifact({ artifactId: id, content: `edit ${i}`, editedBy: fx.users.admin.id }),
      ),
    );
    expect(results.every(Boolean)).toBe(true);

    const finalRow = await prisma.artifact.findUnique({ where: { id } });
    const versionRows = await prisma.artifactVersion.findMany({ where: { artifactId: id } });
    const versions = versionRows.map((v) => v.version).sort((a, b) => a - b);

    // createArtifact wrote the v1 snapshot; N updates → final version = 1 + N,
    // with exactly one version row per version (the v1 row + one per bump).
    expect(finalRow?.version).toBe(1 + N);
    expect(versionRows.length).toBe(1 + N);
    // No duplicate version numbers, and they form a contiguous 1..1+N run.
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toEqual(Array.from({ length: 1 + N }, (_, i) => i + 1));
  });
});

describe('artifacts — create / version / delete (owner happy path)', () => {
  it('owner creates an artifact (201) and lists it', async () => {
    const admin = await loginAgent('admin');
    const created = await admin.post('/api/v1/chat/sessions', {});
    const sessionId = created.body.data.id;

    const res = await admin.post(`/api/v1/chat/sessions/${sessionId}/artifacts`, {
      type: 'document',
      title: 'Spec',
      content: 'v1 body',
    });
    expect(res.status).toBe(201);
    const id = res.body.data.id;
    expect(id).toBeTruthy();

    const list = await admin.get(`/api/v1/chat/sessions/${sessionId}/artifacts`);
    expect(list.status).toBe(200);
    expect((list.body.data ?? []).some((a: { id: string }) => a.id === id)).toBe(true);
  });

  it('rejects unknown type (400) and missing title/content (400)', async () => {
    const admin = await loginAgent('admin');
    const created = await admin.post('/api/v1/chat/sessions', {});
    const sessionId = created.body.data.id;
    expect(
      (await admin.post(`/api/v1/chat/sessions/${sessionId}/artifacts`, {
        type: 'spreadsheet', title: 't', content: 'c',
      })).status,
    ).toBe(400);
    expect(
      (await admin.post(`/api/v1/chat/sessions/${sessionId}/artifacts`, {
        type: 'document', content: 'c',
      })).status,
    ).toBe(400);
  });

  it('owner edit bumps version and records a version row', async () => {
    const admin = await loginAgent('admin');
    const created = await admin.post('/api/v1/chat/sessions', {});
    const sessionId = created.body.data.id;
    const made = await admin.post(`/api/v1/chat/sessions/${sessionId}/artifacts`, {
      type: 'document', title: 'Doc', content: 'v1',
    });
    const id = made.body.data.id;

    const patched = await admin.patch(`/api/v1/chat/artifacts/${id}`, { content: 'v2' });
    expect(patched.status).toBe(200);

    const row = await prisma.artifact.findUnique({ where: { id } });
    expect((row?.version ?? 1)).toBeGreaterThan(1);

    const versions = await admin.get(`/api/v1/chat/artifacts/${id}/versions`);
    expect(versions.status).toBe(200);
    expect((versions.body.data ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('owner deletes an artifact (200) and the row is gone', async () => {
    const admin = await loginAgent('admin');
    const created = await admin.post('/api/v1/chat/sessions', {});
    const sessionId = created.body.data.id;
    const made = await admin.post(`/api/v1/chat/sessions/${sessionId}/artifacts`, {
      type: 'document', title: 'Doc', content: 'x',
    });
    const id = made.body.data.id;

    const del = await admin.del(`/api/v1/chat/artifacts/${id}`);
    expect(del.status).toBe(200);
    expect(await prisma.artifact.findUnique({ where: { id } })).toBeNull();
  });
});

describe('artifacts — missing role gate (ARTIFACT-Z-01/02)', () => {
  it('FIXED (ARTIFACT-Z-02): a read-only viewer cannot PATCH an artifact (403)', async () => {
    const { sessionId } = await orgVisibleSession();
    const admin = await loginAgent('admin');
    const made = await admin.post(`/api/v1/chat/sessions/${sessionId}/artifacts`, {
      type: 'document', title: 'Doc', content: 'owned by admin',
    });
    const id = made.body.data.id;

    // The org `viewer` is read-only: it can SEE the org-visible session but
    // artifact PATCH now requires session WRITE access (getSessionWriteAccess).
    const viewer = await loginAgent('viewer');
    const res = await viewer.patch(`/api/v1/chat/artifacts/${id}`, { content: 'edited by viewer' });
    // FIXED (ARTIFACT-Z-02): write-gated → 403, and the content is unchanged.
    expect(res.status).toBe(403);
    const row = await prisma.artifact.findUnique({ where: { id } });
    expect(row?.content).toBe('owned by admin');
  });

  it('FIXED (ARTIFACT-Z-01): a non-author session reader cannot DELETE the artifact (403)', async () => {
    const { sessionId } = await orgVisibleSession();
    const admin = await loginAgent('admin');
    const made = await admin.post(`/api/v1/chat/sessions/${sessionId}/artifacts`, {
      type: 'document', title: 'Doc', content: 'owned by admin',
    });
    const id = made.body.data.id;

    // A same-org member can read the org-visible session but is not a write
    // collaborator → delete is write-gated.
    const member = await loginAgent('member');
    const res = await member.del(`/api/v1/chat/artifacts/${id}`);
    // FIXED (ARTIFACT-Z-01): write-gated → 403, and the artifact still exists.
    expect(res.status).toBe(403);
    expect(await prisma.artifact.findUnique({ where: { id } })).not.toBeNull();
  });

  it('a user with NO session access still cannot touch the artifact (404)', async () => {
    // Private session this time — member has no read access at all.
    const admin = await loginAgent('admin');
    const created = await admin.post('/api/v1/chat/sessions', {});
    const sessionId = created.body.data.id;
    const made = await admin.post(`/api/v1/chat/sessions/${sessionId}/artifacts`, {
      type: 'document', title: 'Doc', content: 'private',
    });
    const id = made.body.data.id;

    const member = await loginAgent('member');
    expect((await member.patch(`/api/v1/chat/artifacts/${id}`, { content: 'x' })).status).toBe(404);
    expect((await member.del(`/api/v1/chat/artifacts/${id}`)).status).toBe(404);
  });
});
