/**
 * Knowledge loop, Phase 0 — versioned memory and routines, owners, rollback.
 *
 * Test plan area A (docs: Hearth Knowledge Loop → Test plan). Real Postgres
 * with RLS, real Express app, driven per role:
 *   - every content/definition change writes an immutable version row
 *   - metadata, run state and enable/disable do NOT make versions
 *   - rollback writes a NEW version (history is never rewritten), owners only
 *   - optimistic concurrency via expectedVersion → 409
 *   - concurrent writers without expectedVersion both land, no lost versions
 *   - explicit owners (admin-only), validated against org / team / role
 *   - tenant isolation on every new endpoint
 *   - agents cannot edit team/org routines; their personal edits are versioned
 */
import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import bcrypt from 'bcrypt';
import {
  prisma,
  seedAuthFixture,
  loginAgent,
  truncateAll,
  disconnect,
  type AuthFixture,
  type AgentClient,
} from './setup.js';
import { createToolRouter } from '../src/agent/tool-router.js';
import { runWithTenant } from '../src/lib/tenant-context.js';

let fx: AuthFixture;
let admin: AgentClient;
let lead: AgentClient;
let member: AgentClient;
let viewer: AgentClient;
let rival: AgentClient;

beforeEach(async () => {
  await truncateAll();
  fx = await seedAuthFixture();
  [admin, lead, member, viewer, rival] = await Promise.all([
    loginAgent('admin'),
    loginAgent('lead'),
    loginAgent('member'),
    loginAgent('viewer'),
    loginAgent('rival'),
  ]);
});

afterAll(async () => {
  await disconnect();
});

async function createMemory(agent: AgentClient, layer: string, content: string): Promise<string> {
  const res = await agent.post('/api/v1/memory', { layer, content });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function versionsOf(memoryId: string) {
  return prisma.memoryVersion.findMany({ where: { memoryId }, orderBy: { version: 'asc' } });
}

// ── Memory: versions ──────────────────────────────────────────────────────

describe('memory versions', () => {
  it('A1: a create writes version 1; a content edit writes version 2 and keeps version 1', async () => {
    const id = await createMemory(lead, 'team', 'Post the weekly update in #customer');
    const edit = await lead.patch(`/api/v1/memory/${id}`, {
      content: 'Post the weekly update in #customer-updates',
    });
    expect(edit.status).toBe(200);
    expect(edit.body.data.version).toBe(2);

    const rows = await versionsOf(id);
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    expect(rows[0].content).toBe('Post the weekly update in #customer');
    expect(rows[1].content).toBe('Post the weekly update in #customer-updates');
    expect(rows.every((r) => r.changeSource === 'user' && r.changedById === fx.users.lead.id)).toBe(
      true,
    );
    expect(rows.every((r) => r.orgId === fx.primary.orgId)).toBe(true);
  });

  it('a metadata-only change (source, expiry) does not make a version', async () => {
    const id = await createMemory(member, 'user', 'I prefer short updates');
    const res = await member.patch(`/api/v1/memory/${id}`, { source: 'manual' });
    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(1);
    expect(await versionsOf(id)).toHaveLength(1);
  });

  it('saving identical content does not make a version', async () => {
    const id = await createMemory(member, 'user', 'Same text');
    await member.patch(`/api/v1/memory/${id}`, { content: 'Same text' });
    expect(await versionsOf(id)).toHaveLength(1);
  });

  it('GET /versions lists newest first with the current version, paged', async () => {
    const id = await createMemory(admin, 'org', 'v1');
    for (const c of ['v2', 'v3', 'v4']) await admin.patch(`/api/v1/memory/${id}`, { content: c });

    const res = await member.get(`/api/v1/memory/${id}/versions?pageSize=2`);
    expect(res.status).toBe(200);
    expect(res.body.currentVersion).toBe(4);
    expect(res.body.total).toBe(4);
    expect(res.body.data.map((v: { version: number }) => v.version)).toEqual([4, 3]);

    const page2 = await member.get(`/api/v1/memory/${id}/versions?pageSize=2&page=2`);
    expect(page2.body.data.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it('A7: deleting a memory entry removes its versions', async () => {
    const id = await createMemory(member, 'user', 'temporary');
    await member.patch(`/api/v1/memory/${id}`, { content: 'temporary 2' });
    expect((await member.del(`/api/v1/memory/${id}`)).status).toBe(200);
    expect(await versionsOf(id)).toHaveLength(0);
  });
});

// ── Memory: rollback ──────────────────────────────────────────────────────

describe('memory rollback', () => {
  it('A2: rollback writes a NEW version with the old content', async () => {
    const id = await createMemory(admin, 'org', 'original');
    await admin.patch(`/api/v1/memory/${id}`, { content: 'second' });
    await admin.patch(`/api/v1/memory/${id}`, { content: 'third' });

    const res = await admin.post(`/api/v1/memory/${id}/rollback`, { version: 1 });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    expect(res.body.data.content).toBe('original');
    expect(res.body.data.version).toBe(4);

    const rows = await versionsOf(id);
    expect(rows.map((r) => r.content)).toEqual(['original', 'second', 'third', 'original']);
    expect(rows[3]).toMatchObject({
      changeSource: 'rollback',
      restoredFrom: 1,
      changedById: fx.users.admin.id,
    });
  });

  it('rollback to the content already current is a no-op', async () => {
    const id = await createMemory(admin, 'org', 'same');
    const res = await admin.post(`/api/v1/memory/${id}/rollback`, { version: 1 });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(false);
    expect(await versionsOf(id)).toHaveLength(1);
  });

  it('A6: rollback to a version that does not exist → 404, nothing changes', async () => {
    const id = await createMemory(admin, 'org', 'only');
    const res = await admin.post(`/api/v1/memory/${id}/rollback`, { version: 9 });
    expect(res.status).toBe(404);
    expect(await versionsOf(id)).toHaveLength(1);
  });

  it.each([{}, { version: 0 }, { version: -1 }, { version: 1.5 }, { version: '1' }])(
    'rejects a bad body %j with 400',
    async (body) => {
      const id = await createMemory(admin, 'org', 'x');
      expect((await admin.post(`/api/v1/memory/${id}/rollback`, body)).status).toBe(400);
    },
  );

  it('A10: role gate — only owners roll back', async () => {
    const orgId = await createMemory(admin, 'org', 'org v1');
    await admin.patch(`/api/v1/memory/${orgId}`, { content: 'org v2' });
    expect((await lead.post(`/api/v1/memory/${orgId}/rollback`, { version: 1 })).status).toBe(403);
    expect((await member.post(`/api/v1/memory/${orgId}/rollback`, { version: 1 })).status).toBe(
      403,
    );
    expect((await viewer.post(`/api/v1/memory/${orgId}/rollback`, { version: 1 })).status).toBe(
      403,
    );

    const teamId = await createMemory(lead, 'team', 'team v1');
    await lead.patch(`/api/v1/memory/${teamId}`, { content: 'team v2' });
    expect((await member.post(`/api/v1/memory/${teamId}/rollback`, { version: 1 })).status).toBe(
      403,
    );
    expect((await lead.post(`/api/v1/memory/${teamId}/rollback`, { version: 1 })).status).toBe(200);

    const userId = await createMemory(member, 'user', 'mine v1');
    await member.patch(`/api/v1/memory/${userId}`, { content: 'mine v2' });
    expect((await member.post(`/api/v1/memory/${userId}/rollback`, { version: 1 })).status).toBe(
      200,
    );
  });

  it('writes an audit log row for a rollback', async () => {
    const id = await createMemory(admin, 'org', 'a');
    await admin.patch(`/api/v1/memory/${id}`, { content: 'b' });
    await admin.post(`/api/v1/memory/${id}/rollback`, { version: 1 });
    await expect
      .poll(() => prisma.auditLog.count({ where: { action: 'knowledge_rollback', entityId: id } }))
      .toBe(1);
  });
});

// ── Memory: concurrency ───────────────────────────────────────────────────

describe('memory concurrency', () => {
  it('A8: a stale expectedVersion gets 409 with the current version', async () => {
    const id = await createMemory(admin, 'org', 'v1');
    expect(
      (await admin.patch(`/api/v1/memory/${id}`, { content: 'v2', expectedVersion: 1 })).status,
    ).toBe(200);

    const stale = await admin.patch(`/api/v1/memory/${id}`, {
      content: 'v2-other',
      expectedVersion: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.currentVersion).toBe(2);
    expect(await versionsOf(id)).toHaveLength(2);
  });

  it('rejects a non-integer expectedVersion with 400', async () => {
    const id = await createMemory(admin, 'org', 'v1');
    expect(
      (await admin.patch(`/api/v1/memory/${id}`, { content: 'v2', expectedVersion: 'one' })).status,
    ).toBe(400);
  });

  it('two writers at once without expectedVersion both land as separate versions', async () => {
    const id = await createMemory(admin, 'org', 'v1');
    const results = await Promise.all([
      admin.patch(`/api/v1/memory/${id}`, { content: 'writer A' }),
      admin.patch(`/api/v1/memory/${id}`, { content: 'writer B' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const rows = await versionsOf(id);
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3]);
    expect(new Set(rows.slice(1).map((r) => r.content))).toEqual(new Set(['writer A', 'writer B']));
  });

  it('two writers at once with the same expectedVersion: exactly one wins', async () => {
    const id = await createMemory(admin, 'org', 'v1');
    const results = await Promise.all([
      admin.patch(`/api/v1/memory/${id}`, { content: 'A', expectedVersion: 1 }),
      admin.patch(`/api/v1/memory/${id}`, { content: 'B', expectedVersion: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await versionsOf(id)).toHaveLength(2);
  });
});

// ── Memory: owners ────────────────────────────────────────────────────────

describe('memory owners', () => {
  it('an admin names a member as owner; the member can then roll back', async () => {
    const id = await createMemory(admin, 'org', 'v1');
    await admin.patch(`/api/v1/memory/${id}`, { content: 'v2' });
    expect((await member.post(`/api/v1/memory/${id}/rollback`, { version: 1 })).status).toBe(403);

    const set = await admin.patch(`/api/v1/memory/${id}/owner`, { ownerId: fx.users.member.id });
    expect(set.status).toBe(200);
    expect(set.body.data.ownerId).toBe(fx.users.member.id);
    expect((await member.post(`/api/v1/memory/${id}/rollback`, { version: 1 })).status).toBe(200);

    // null puts the default owner back
    expect((await admin.patch(`/api/v1/memory/${id}/owner`, { ownerId: null })).status).toBe(200);
    expect((await member.post(`/api/v1/memory/${id}/rollback`, { version: 2 })).status).toBe(403);
  });

  it('only an admin can change the owner', async () => {
    const id = await createMemory(lead, 'team', 'x');
    for (const agent of [lead, member, viewer]) {
      expect(
        (await agent.patch(`/api/v1/memory/${id}/owner`, { ownerId: fx.users.member.id })).status,
      ).toBe(403);
    }
  });

  it('rejects an owner from another org, a viewer, or another team', async () => {
    const id = await createMemory(lead, 'team', 'x');
    expect(
      (await admin.patch(`/api/v1/memory/${id}/owner`, { ownerId: fx.users.rival.id })).status,
    ).toBe(400);
    expect(
      (await admin.patch(`/api/v1/memory/${id}/owner`, { ownerId: fx.users.viewer.id })).status,
    ).toBe(400);
    expect(
      (await admin.patch(`/api/v1/memory/${id}/owner`, { ownerId: 'no-such-user' })).status,
    ).toBe(400);

    const hash = await bcrypt.hash(fx.password, 10);
    const otherTeam = await prisma.team.create({
      data: { name: 'Sales', orgId: fx.primary.orgId },
    });
    const outsider = await prisma.user.create({
      data: {
        email: 'sales@itest.local',
        name: 'Sales',
        role: 'member' as never,
        authProvider: 'email',
        passwordHash: hash,
        teamId: otherTeam.id,
      },
    });
    expect((await admin.patch(`/api/v1/memory/${id}/owner`, { ownerId: outsider.id })).status).toBe(
      400,
    );
  });

  it('rejects a bad owner body with 400', async () => {
    const id = await createMemory(admin, 'org', 'x');
    expect((await admin.patch(`/api/v1/memory/${id}/owner`, {})).status).toBe(400);
    expect((await admin.patch(`/api/v1/memory/${id}/owner`, { ownerId: 5 })).status).toBe(400);
  });

  it('a personal entry cannot be given to someone else', async () => {
    const adminEntry = await prisma.memoryEntry.create({
      data: {
        orgId: fx.primary.orgId,
        userId: fx.users.admin.id,
        layer: 'user',
        content: 'admin note',
      },
    });
    const res = await admin.patch(`/api/v1/memory/${adminEntry.id}/owner`, {
      ownerId: fx.users.member.id,
    });
    expect(res.status).toBe(400);
  });
});

// ── Memory: tenant isolation ──────────────────────────────────────────────

describe('memory — tenant isolation on new endpoints', () => {
  it('a rival admin gets 404 on versions, rollback and owner', async () => {
    const id = await createMemory(admin, 'org', 'secret plan v1');
    await admin.patch(`/api/v1/memory/${id}`, { content: 'secret plan v2' });

    expect((await rival.get(`/api/v1/memory/${id}/versions`)).status).toBe(404);
    expect((await rival.post(`/api/v1/memory/${id}/rollback`, { version: 1 })).status).toBe(404);
    expect(
      (await rival.patch(`/api/v1/memory/${id}/owner`, { ownerId: fx.users.rival.id })).status,
    ).toBe(404);
    const after = await prisma.memoryEntry.findUnique({ where: { id } });
    expect(after?.content).toBe('secret plan v2');
    expect(after?.ownerId).toBeNull();
  });

  it('another member cannot read the history of someone else’s personal memory', async () => {
    const id = await createMemory(member, 'user', 'private note');
    expect((await lead.get(`/api/v1/memory/${id}/versions`)).status).toBe(404);
    expect((await admin.get(`/api/v1/memory/${id}/versions`)).status).toBe(404);
  });

  it('unauthenticated requests get 401', async () => {
    const id = await createMemory(admin, 'org', 'x');
    const { default: request } = await import('supertest');
    const { app } = await import('./setup.js');
    expect((await request(app).get(`/api/v1/memory/${id}/versions`)).status).toBe(401);
  });
});

// ── Routines ──────────────────────────────────────────────────────────────

async function createRoutine(agent: AgentClient, body: Record<string, unknown>): Promise<string> {
  const res = await agent.post('/api/v1/routines', {
    name: 'Weekly update',
    prompt: 'Post in #customer',
    ...body,
  });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function routineVersions(routineId: string) {
  return prisma.routineVersion.findMany({ where: { routineId }, orderBy: { version: 'asc' } });
}

describe('routine versions', () => {
  it('create → v1; prompt edit → v2 with the full snapshot', async () => {
    const id = await createRoutine(lead, { scope: 'team' });
    const res = await lead.patch(`/api/v1/routines/${id}`, { prompt: 'Post in #customer-updates' });
    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(2);

    const rows = await routineVersions(id);
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    expect((rows[0].snapshot as { prompt: string }).prompt).toBe('Post in #customer');
    expect(rows[1].snapshot).toMatchObject({
      prompt: 'Post in #customer-updates',
      scope: 'team',
      name: 'Weekly update',
    });
  });

  it('enable/disable and run state do not make versions', async () => {
    const id = await createRoutine(member, {});
    expect((await member.patch(`/api/v1/routines/${id}`, { enabled: false })).status).toBe(200);
    expect((await member.post(`/api/v1/routines/${id}/toggle`)).status).toBe(200);
    expect(
      (await member.put(`/api/v1/routines/${id}/state`, { state: { cursor: 'x' } })).status,
    ).toBe(200);
    expect(await routineVersions(id)).toHaveLength(1);
    expect((await prisma.routine.findUnique({ where: { id } }))?.version).toBe(1);
  });

  it('a member of the team can read the history of a team routine; another org cannot', async () => {
    const id = await createRoutine(lead, { scope: 'team' });
    await lead.patch(`/api/v1/routines/${id}`, { prompt: 'v2' });
    const res = await member.get(`/api/v1/routines/${id}/versions`);
    expect(res.status).toBe(200);
    expect(res.body.currentVersion).toBe(2);
    expect(res.body.data.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect((await rival.get(`/api/v1/routines/${id}/versions`)).status).toBe(404);
  });

  it('deleting a routine removes its versions', async () => {
    const id = await createRoutine(member, {});
    await member.patch(`/api/v1/routines/${id}`, { prompt: 'v2' });
    expect((await member.del(`/api/v1/routines/${id}`)).status).toBe(204);
    expect(await routineVersions(id)).toHaveLength(0);
  });

  it('a stale expectedVersion gets 409', async () => {
    const id = await createRoutine(member, {});
    await member.patch(`/api/v1/routines/${id}`, { prompt: 'v2', expectedVersion: 1 });
    const stale = await member.patch(`/api/v1/routines/${id}`, {
      prompt: 'v2b',
      expectedVersion: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.currentVersion).toBe(2);
  });
});

describe('routine rollback', () => {
  it('restores the old definition as a new version, but not scope or team', async () => {
    const id = await createRoutine(admin, { scope: 'org', schedule: '0 9 * * 1' });
    await admin.patch(`/api/v1/routines/${id}`, { scope: 'team', teamId: fx.primary.teamId }); // v2
    await admin.patch(`/api/v1/routines/${id}`, { prompt: 'changed', schedule: '0 10 * * 1' }); // v3

    const res = await admin.post(`/api/v1/routines/${id}/rollback`, { version: 1 });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    expect(res.body.data).toMatchObject({
      prompt: 'Post in #customer',
      schedule: '0 9 * * 1',
      scope: 'team',
      version: 4,
    });

    const last = (await routineVersions(id)).at(-1)!;
    expect(last).toMatchObject({
      changeSource: 'rollback',
      restoredFrom: 1,
      changedById: fx.users.admin.id,
    });
  });

  it('role gate: lead rolls back a team routine; member and viewer cannot', async () => {
    const id = await createRoutine(lead, { scope: 'team' });
    await lead.patch(`/api/v1/routines/${id}`, { prompt: 'v2' });
    expect((await member.post(`/api/v1/routines/${id}/rollback`, { version: 1 })).status).toBe(403);
    expect((await viewer.post(`/api/v1/routines/${id}/rollback`, { version: 1 })).status).toBe(403);
    expect((await rival.post(`/api/v1/routines/${id}/rollback`, { version: 1 })).status).toBe(404);
    expect((await lead.post(`/api/v1/routines/${id}/rollback`, { version: 1 })).status).toBe(200);
  });

  it('unknown version → 404; bad body → 400', async () => {
    const id = await createRoutine(member, {});
    expect((await member.post(`/api/v1/routines/${id}/rollback`, { version: 7 })).status).toBe(404);
    expect((await member.post(`/api/v1/routines/${id}/rollback`, { version: 'x' })).status).toBe(
      400,
    );
  });

  it('a named owner can roll back; only admins name owners', async () => {
    const id = await createRoutine(lead, { scope: 'team' });
    await lead.patch(`/api/v1/routines/${id}`, { prompt: 'v2' });
    expect(
      (await lead.patch(`/api/v1/routines/${id}/owner`, { ownerId: fx.users.member.id })).status,
    ).toBe(403);
    expect(
      (await admin.patch(`/api/v1/routines/${id}/owner`, { ownerId: fx.users.member.id })).status,
    ).toBe(200);
    expect((await member.post(`/api/v1/routines/${id}/rollback`, { version: 1 })).status).toBe(200);
    expect(
      (await admin.patch(`/api/v1/routines/${id}/owner`, { ownerId: fx.users.rival.id })).status,
    ).toBe(400);
  });
});

// ── Agent tools ───────────────────────────────────────────────────────────

describe('agent tools and versions', () => {
  async function tools(userId: string) {
    return createToolRouter({
      userId,
      orgId: fx.primary.orgId,
      teamId: fx.primary.teamId,
      sessionId: 'itest-session',
    });
  }
  const asUser = <T>(userId: string, fn: () => Promise<T>) =>
    runWithTenant({ orgId: fx.primary.orgId, userId }, fn);

  it('A9: an agent cannot edit a team routine; nothing changes', async () => {
    const id = await createRoutine(lead, { scope: 'team' });
    const out = await asUser(fx.users.lead.id, async () => {
      const t = await tools(fx.users.lead.id);
      return t.get('update_routine')!.handler({ routine_id: id, prompt: 'agent rewrite' });
    });
    expect(out.error).toMatch(/team routine/i);
    const row = await prisma.routine.findUnique({ where: { id } });
    expect(row?.prompt).toBe('Post in #customer');
    expect(await routineVersions(id)).toHaveLength(1);
  });

  it('an agent edit to a personal routine makes a version marked "agent"', async () => {
    const id = await createRoutine(member, {});
    const out = await asUser(fx.users.member.id, async () => {
      const t = await tools(fx.users.member.id);
      return t.get('update_routine')!.handler({ routine_id: id, prompt: 'agent rewrite' });
    });
    expect(out.error).toBeUndefined();
    const rows = await routineVersions(id);
    expect(rows.at(-1)).toMatchObject({
      version: 2,
      changeSource: 'agent',
      changedById: fx.users.member.id,
    });
  });

  it('create_routine sets the org and writes version 1', async () => {
    const out = await asUser(fx.users.member.id, async () => {
      const t = await tools(fx.users.member.id);
      return t
        .get('create_routine')!
        .handler({ name: 'Agent routine', prompt: 'Do it', schedule: '0 9 * * *' });
    });
    const routineId = (out.output as { routineId: string }).routineId;
    const row = await prisma.routine.findUnique({ where: { id: routineId } });
    expect(row).toMatchObject({ orgId: fx.primary.orgId, createdVia: 'agent', version: 1 });
    expect(await routineVersions(routineId)).toHaveLength(1);
  });

  it('save_memory writes a version marked "agent"; session_note writes none', async () => {
    const saved = await asUser(fx.users.member.id, async () => {
      const t = await tools(fx.users.member.id);
      const a = await t.get('save_memory')!.handler({ content: 'Prefers bullet points' });
      const b = await t.get('session_note')!.handler({ content: 'Working on Q3 deck' });
      return { a, b };
    });
    const memId = (saved.a.output as { id: string }).id;
    const noteId = (saved.b.output as { id: string }).id;
    expect(await versionsOf(memId)).toEqual([
      expect.objectContaining({
        version: 1,
        changeSource: 'agent',
        changedById: fx.users.member.id,
      }),
    ]);
    expect(await versionsOf(noteId)).toHaveLength(0);
  });
});
