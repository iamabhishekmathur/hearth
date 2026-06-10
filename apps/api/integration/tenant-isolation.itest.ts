/**
 * TENANT ISOLATION — primary org (member) vs rival org (rival-org admin).
 *
 * Asserts a rival-org user cannot read/patch/delete primary-org resources by
 * id, and that primary-org lists never leak rival data, across:
 *   chat sessions · tasks · memory · decisions · routines · skills · artifacts ·
 *   integrations.
 *
 * Several P0 defects from the audit (Part 3) are PINNED here: the assertion
 * documents the CURRENT (leaky) behavior and is marked `// DEFECT (<id>)`.
 * These tests intentionally expect the leak so the suite both documents and
 * detects it; a future fix will flip the expectation. We do NOT change product
 * code here.
 *
 * Pattern from smoke.itest.ts: import from './setup.js', truncate+seed each
 * test, drive with loginAgent(role). The harness's plain `prisma` (bypasses the
 * tenant extension) is used to seed rival-org rows directly and to read back
 * the side effects of leak-y writes.
 */
import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import {
  prisma,
  seedAuthFixture,
  loginAgent,
  truncateAll,
  disconnect,
  type AuthFixture,
  type AgentClient,
} from './setup.js';

let fx: AuthFixture;
let member: AgentClient; // primary-org member
let admin: AgentClient; // primary-org admin
let rival: AgentClient; // rival-org admin (the isolation foil)

const ID = (res: { body: { data?: { id?: string }; id?: string } }): string => {
  const id = res.body.data?.id ?? res.body.id;
  if (!id) throw new Error('expected an id in response body');
  return id;
};

beforeEach(async () => {
  await truncateAll();
  fx = await seedAuthFixture();
  member = await loginAgent('member');
  admin = await loginAgent('admin');
  rival = await loginAgent('rival');
});

afterAll(async () => {
  await disconnect();
});

// ───────────────────────── Chat sessions ─────────────────────────
describe('tenant isolation — chat sessions', () => {
  it('rival cannot GET a primary-org private session (404)', async () => {
    const created = await member.post('/api/v1/chat/sessions', { title: 'primary secret' });
    expect([200, 201]).toContain(created.status);
    const id = ID(created);

    const res = await rival.get(`/api/v1/chat/sessions/${id}`);
    expect(res.status).toBe(404);
  });

  it('rival cannot DELETE a primary-org session (404)', async () => {
    const created = await member.post('/api/v1/chat/sessions', { title: 'primary secret 2' });
    const id = ID(created);
    const res = await rival.del(`/api/v1/chat/sessions/${id}`);
    expect(res.status).toBe(404);
    // Still present for the owner.
    const owner = await member.get(`/api/v1/chat/sessions/${id}`);
    expect(owner.status).toBe(200);
  });

  it("primary session list never contains rival sessions", async () => {
    await rival.post('/api/v1/chat/sessions', { title: 'rival session' });
    await member.post('/api/v1/chat/sessions', { title: 'mine' });
    const list = await member.get('/api/v1/chat/sessions');
    expect(list.status).toBe(200);
    const sessions: Array<{ title: string }> = list.body.data ?? [];
    expect(sessions.some((s) => s.title === 'rival session')).toBe(false);
  });
});

// ───────────────────────── Tasks ─────────────────────────
describe('tenant isolation — tasks', () => {
  it('rival cannot GET a primary-org task (404)', async () => {
    const created = await member.post('/api/v1/tasks/', { title: 'primary task', source: 'manual' });
    expect([200, 201]).toContain(created.status);
    const id = ID(created);
    const res = await rival.get(`/api/v1/tasks/${id}`);
    expect(res.status).toBe(404);
  });

  it('rival cannot PATCH a primary-org task (404)', async () => {
    const created = await member.post('/api/v1/tasks/', { title: 'primary task 2', source: 'manual' });
    const id = ID(created);
    const res = await rival.patch(`/api/v1/tasks/${id}`, { title: 'hijacked' });
    expect(res.status).toBe(404);
  });

  it('rival cannot DELETE a primary-org task (404)', async () => {
    const created = await member.post('/api/v1/tasks/', { title: 'primary task 3', source: 'manual' });
    const id = ID(created);
    const res = await rival.del(`/api/v1/tasks/${id}`);
    expect(res.status).toBe(404);
  });

  it('primary task list never contains rival tasks', async () => {
    await rival.post('/api/v1/tasks/', { title: 'rival task', source: 'manual' });
    await member.post('/api/v1/tasks/', { title: 'mine', source: 'manual' });
    const list = await member.get('/api/v1/tasks/');
    expect(list.status).toBe(200);
    const tasks: Array<{ title: string }> = list.body.data ?? [];
    expect(tasks.some((t) => t.title === 'rival task')).toBe(false);
  });
});

// ───────────────────────── Memory ─────────────────────────
describe('tenant isolation — memory', () => {
  it('rival cannot GET a primary-org user-layer memory entry (404)', async () => {
    const created = await member.post('/api/v1/memory', { layer: 'user', content: 'primary memory' });
    expect([200, 201]).toContain(created.status);
    const id = ID(created);
    const res = await rival.get(`/api/v1/memory/${id}`);
    expect(res.status).toBe(404);
  });

  it('rival cannot DELETE a primary-org memory entry (404)', async () => {
    const created = await member.post('/api/v1/memory', { layer: 'user', content: 'primary memory 2' });
    const id = ID(created);
    const res = await rival.del(`/api/v1/memory/${id}`);
    expect(res.status).toBe(404);
  });

  it('rival memory search returns 0 primary-org results (cross-org isolation)', async () => {
    await member.post('/api/v1/memory', { layer: 'org', content: 'PRIMARY-ANCHOR-STRING quarterly plan' });
    // admin writes an org-layer entry too (admin is the only one who can).
    const search = await rival.post('/api/v1/memory/search', { query: 'PRIMARY-ANCHOR-STRING' });
    expect(search.status).toBe(200);
    const results: Array<{ content?: string }> = search.body.data ?? [];
    expect(results.some((r) => r.content?.includes('PRIMARY-ANCHOR-STRING'))).toBe(false);
  });

  it('primary memory list never contains rival entries', async () => {
    await rival.post('/api/v1/memory', { layer: 'user', content: 'rival-only-memory' });
    await member.post('/api/v1/memory', { layer: 'user', content: 'mine' });
    const list = await member.get('/api/v1/memory?layer=user');
    expect(list.status).toBe(200);
    const items: Array<{ content: string }> = list.body.data ?? [];
    expect(items.some((m) => m.content === 'rival-only-memory')).toBe(false);
  });
});

// ───────────────────────── Decisions ─────────────────────────
describe('tenant isolation — decisions', () => {
  it('rival cannot GET a primary-org decision by id (404 — getDecision is org-scoped)', async () => {
    const created = await member.post('/api/v1/decisions/', {
      title: 'primary decision',
      reasoning: 'because',
    });
    expect([200, 201]).toContain(created.status);
    const id = ID(created);
    const res = await rival.get(`/api/v1/decisions/${id}`);
    expect(res.status).toBe(404);
  });

  it('primary decision list never contains rival decisions', async () => {
    await rival.post('/api/v1/decisions/', { title: 'rival decision', reasoning: 'r' });
    await member.post('/api/v1/decisions/', { title: 'mine', reasoning: 'm' });
    const list = await member.get('/api/v1/decisions/');
    expect(list.status).toBe(200);
    const items: Array<{ title?: string }> = list.body.data ?? list.body.items ?? [];
    expect(items.some((d) => d.title === 'rival decision')).toBe(false);
  });

  // FIXED (DEC-Z-06): GET /decisions/:id/outcomes is now org-scoped — the route
  // first verifies the decision belongs to the caller's org (getDecision is
  // org-scoped) before returning outcomes, so a rival-org admin gets a 404.
  it('FIXED (DEC-Z-06): rival CANNOT read a primary-org decision outcomes by id', async () => {
    const decision = await prisma.decision.create({
      data: {
        orgId: fx.primary.orgId,
        createdById: fx.users.member.id,
        title: 'primary decision with outcome',
        reasoning: 'seeded',
      },
    });
    await prisma.decisionOutcome.create({
      data: {
        decisionId: decision.id,
        observedById: fx.users.member.id,
        verdict: 'positive',
        description: 'LEAKED-OUTCOME-DETAIL',
      },
    });

    const res = await rival.get(`/api/v1/decisions/${decision.id}/outcomes`);
    // FIXED: cross-org outcomes read → 404, no leak.
    expect(res.status).toBe(404);
  });
});

// ───────────────────────── Routines ─────────────────────────
describe('tenant isolation — routines', () => {
  // Seed a routine owned by the rival admin; the primary member is the attacker
  // here (and vice-versa) — the routes ignore ownership/org on these paths.
  async function seedRivalRoutine() {
    return prisma.routine.create({
      data: {
        userId: fx.users.rival.id,
        name: 'rival routine',
        prompt: 'do rival things',
        delivery: { channels: ['in_app'] },
        state: { cursor: 'RIVAL-SECRET-CURSOR' },
      },
    });
  }

  it('primary routine list never contains rival routines', async () => {
    await seedRivalRoutine();
    const list = await member.get('/api/v1/routines/');
    expect(list.status).toBe(200);
    const items: Array<{ name?: string }> = list.body.data ?? [];
    expect(items.some((r) => r.name === 'rival routine')).toBe(false);
  });

  // FIXED (ROUT-Z-03): GET /routines/:id/state now enforces routine scope/org —
  // getState takes the caller's PermissionContext, so a non-owner reading another
  // (personal, foreign-owner) routine's state is denied.
  it('FIXED (ROUT-Z-03): non-owner CANNOT read another org routine /state', async () => {
    const routine = await seedRivalRoutine();
    const res = await member.get(`/api/v1/routines/${routine.id}/state`);
    // FIXED: cross-owner state read → 404, secret cursor not exposed.
    expect(res.status).toBe(404);
  });

  // FIXED (ROUT-Z-04): PUT /routines/:id/state now enforces edit scope/org —
  // updateState takes the caller's PermissionContext, so a non-owner cannot
  // overwrite another routine's state.
  it('FIXED (ROUT-Z-04): non-owner CANNOT overwrite another org routine /state', async () => {
    const routine = await seedRivalRoutine();
    const res = await member.put(`/api/v1/routines/${routine.id}/state`, { cursor: 'TAMPERED' });
    // FIXED: cross-owner state write → 404, original state untouched.
    expect(res.status).toBe(404);
    const after = await prisma.routine.findUnique({ where: { id: routine.id }, select: { state: true } });
    expect((after?.state as { cursor?: string }).cursor).toBe('RIVAL-SECRET-CURSOR');
  });
});

// ───────────────────────── Skills ─────────────────────────
describe('tenant isolation — skills', () => {
  async function seedRivalSkill(status: 'published' | 'pending_review' = 'published') {
    return prisma.skill.create({
      data: {
        orgId: fx.rival.orgId,
        authorId: fx.users.rival.id,
        name: 'rival skill',
        description: 'rival-only capability',
        content: '---\nname: rival skill\ndescription: rival-only capability\n---\nbody',
        scope: 'org',
        status,
      },
    });
  }

  it('primary skill list never contains rival-org skills', async () => {
    await seedRivalSkill();
    const list = await member.get('/api/v1/skills/');
    expect(list.status).toBe(200);
    const items: Array<{ name?: string }> = list.body.data ?? [];
    expect(items.some((s) => s.name === 'rival skill')).toBe(false);
  });

  // FIXED (SKILL-Z-09): GET /skills/:id now passes the caller's org to getSkill,
  // which returns null for a skill belonging to another org → 404.
  it('FIXED (SKILL-Z-09): member CANNOT read a rival-org skill by id', async () => {
    const skill = await seedRivalSkill();
    const res = await member.get(`/api/v1/skills/${skill.id}`);
    // FIXED: cross-org skill read → 404, body not exposed.
    expect(res.status).toBe(404);
  });

  // FIXED (SKILL-Z-10): POST /skills/:id/install now passes the caller's org to
  // installSkill, which rejects a cross-org skill as not-found → 404, no row.
  it('FIXED (SKILL-Z-10): member CANNOT install a rival-org skill', async () => {
    const skill = await seedRivalSkill();
    const res = await member.post(`/api/v1/skills/${skill.id}/install`, {});
    // FIXED: cross-org install → 404 and no UserSkill row is created.
    expect(res.status).toBe(404);
    const userSkill = await prisma.userSkill.findUnique({
      where: { userId_skillId: { userId: fx.users.member.id, skillId: skill.id } },
    });
    expect(userSkill).toBeNull();
  });
});

// ───────────────────────── Artifacts ─────────────────────────
describe('tenant isolation — artifacts', () => {
  it('rival cannot GET a primary-org artifact (404 — gated by session access)', async () => {
    const session = await member.post('/api/v1/chat/sessions', { title: 'artifact host' });
    const sessionId = ID(session);
    const created = await member.post(`/api/v1/chat/sessions/${sessionId}/artifacts`, {
      type: 'code',
      title: 'primary artifact',
      content: 'console.log(1)',
    });
    expect([200, 201]).toContain(created.status);
    const artifactId = ID(created);

    const res = await rival.get(`/api/v1/chat/artifacts/${artifactId}`);
    expect(res.status).toBe(404);
  });

  it('rival cannot DELETE a primary-org artifact (404)', async () => {
    const session = await member.post('/api/v1/chat/sessions', { title: 'artifact host 2' });
    const sessionId = ID(session);
    const created = await member.post(`/api/v1/chat/sessions/${sessionId}/artifacts`, {
      type: 'code',
      title: 'primary artifact 2',
      content: 'console.log(2)',
    });
    const artifactId = ID(created);
    const res = await rival.del(`/api/v1/chat/artifacts/${artifactId}`);
    expect(res.status).toBe(404);
  });
});

// ───────────────────────── Integrations ─────────────────────────
describe('tenant isolation — integrations', () => {
  async function seedRivalIntegration() {
    return prisma.integration.create({
      data: {
        orgId: fx.rival.orgId,
        provider: 'slack',
        config: {},
        status: 'active',
        enabled: true,
      },
    });
  }

  it('primary admin integration list never contains rival integrations', async () => {
    await seedRivalIntegration();
    const list = await admin.get('/api/v1/admin/integrations/');
    expect(list.status).toBe(200);
    const items: Array<{ orgId?: string }> = list.body.data ?? [];
    expect(items.some((i) => i.orgId === fx.rival.orgId)).toBe(false);
  });

  it('rival cannot PATCH a primary-org integration (404 — route org check)', async () => {
    const primaryIntegration = await prisma.integration.create({
      data: { orgId: fx.primary.orgId, provider: 'slack', config: {}, status: 'active', enabled: true },
    });
    const res = await rival.patch(`/api/v1/admin/integrations/${primaryIntegration.id}`, {
      enabled: false,
    });
    expect(res.status).toBe(404);
  });

  it('rival cannot DELETE a primary-org integration (404 — route org check)', async () => {
    const primaryIntegration = await prisma.integration.create({
      data: { orgId: fx.primary.orgId, provider: 'github', config: {}, status: 'active', enabled: true },
    });
    const res = await rival.del(`/api/v1/admin/integrations/${primaryIntegration.id}`);
    expect(res.status).toBe(404);
  });
});

// ───────────────────────── Approvals ─────────────────────────
describe('tenant isolation — approvals', () => {
  // Seeds a full rival-org approval chain: routine → run → checkpoint → request.
  async function seedRivalApproval() {
    const routine = await prisma.routine.create({
      data: {
        userId: fx.users.rival.id,
        name: 'rival approval routine',
        prompt: 'p',
        delivery: { channels: ['in_app'] },
      },
    });
    const run = await prisma.routineRun.create({
      data: { routineId: routine.id, status: 'awaiting_approval' },
    });
    const checkpoint = await prisma.approvalCheckpoint.create({
      data: { routineId: routine.id, name: 'gate', position: 0 },
    });
    const approval = await prisma.approvalRequest.create({
      data: {
        runId: run.id,
        checkpointId: checkpoint.id,
        status: 'pending',
        agentOutput: 'RIVAL-PENDING-OUTPUT',
      },
    });
    return { routine, run, checkpoint, approval };
  }

  // FIXED (APPR-Z-02): GET /approvals/:id now passes the caller's org to
  // getApprovalRequest, which derives the approval's org (routine.orgId or the
  // owner's team org) and returns null for a foreign org → 404.
  it('FIXED (APPR-Z-02): primary member CANNOT read a rival-org approval by id', async () => {
    const { approval } = await seedRivalApproval();
    const res = await member.get(`/api/v1/approvals/${approval.id}`);
    // FIXED: cross-org approval read → 404, payload not exposed.
    expect(res.status).toBe(404);
  });

  // FIXED (APPR-Z-02): POST /approvals/:id/resolve now passes the caller's org to
  // resolveApproval, which rejects a cross-org resolve as not-found → 404. (The
  // in-org approverPolicy role-check remains a flagged product decision — see
  // APPR-Z-01.)
  it('FIXED (APPR-Z-02): primary member CANNOT resolve a rival-org approval by id', async () => {
    const { approval } = await seedRivalApproval();
    const res = await member.post(`/api/v1/approvals/${approval.id}/resolve`, {
      decision: 'approved',
      comment: 'cross-tenant resolve',
    });
    // FIXED: cross-org resolve → 404 and the request stays pending.
    expect(res.status).toBe(404);
    const after = await prisma.approvalRequest.findUnique({ where: { id: approval.id } });
    expect(after?.status).toBe('pending');
    expect(after?.reviewerId).toBeNull();
  });
});

// ───────────────────── Admin users cross-org (USERS-E-08) ─────────────────────
describe('tenant isolation — admin users', () => {
  // FIXED (USERS-E-08): listUsers now filters by the caller's org (team.orgId),
  // so GET /admin/users only returns the admin's own org's users.
  it('FIXED (USERS-E-08): primary admin GET /admin/users does NOT leak rival-org users', async () => {
    const list = await admin.get('/api/v1/admin/users/?pageSize=100');
    expect(list.status).toBe(200);
    const users: Array<{ id?: string; email?: string }> = list.body.data ?? [];
    // FIXED: the rival-org admin user is absent from the primary admin's list.
    expect(users.some((u) => u.email === fx.users.rival.email)).toBe(false);
    // Sanity: the primary org's own users are still present.
    expect(users.some((u) => u.email === fx.users.member.email)).toBe(true);
  });
});
