/**
 * Routines + Skills + Approvals integration tests.
 *
 * Routes under test:
 *   /api/v1/routines   (src/routes/routines.ts)
 *   /api/v1/skills     (src/routes/skills.ts)
 *   /api/v1/approvals  (src/routes/approvals.ts)
 *
 * Defects pinned:
 *   ROUT-E-01    — structurally-valid-but-impossible cron is accepted
 *   SKILL-Z-09   — getSkill does not validate caller org (cross-org read)
 *   SKILL-Z-10   — installSkill does not validate caller org (cross-org install)
 *   APPR-Z-01    — resolveApproval has no authorization (any authed user resolves)
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

describe('routines — CRUD', () => {
  it('creates a routine (201) owned by the caller', async () => {
    const member = await loginAgent('member');
    const res = await member.post('/api/v1/routines', {
      name: 'Daily standup',
      prompt: 'Summarize yesterday',
      schedule: '0 9 * * 1-5',
    });
    expect(res.status).toBe(201);
    const id = res.body.data.id;
    const row = await prisma.routine.findUnique({ where: { id } });
    expect(row?.userId).toBe(fx.users.member.id);
  });

  it('requires name + prompt (400)', async () => {
    const member = await loginAgent('member');
    expect((await member.post('/api/v1/routines', { prompt: 'x' })).status).toBe(400);
    expect((await member.post('/api/v1/routines', { name: 'x' })).status).toBe(400);
  });

  it('rejects a structurally-malformed cron (wrong field count) with 400', async () => {
    const member = await loginAgent('member');
    const res = await member.post('/api/v1/routines', {
      name: 'Bad', prompt: 'x', schedule: '0 9 * *', // only 4 fields
    });
    expect(res.status).toBe(400);
  });

  it('run-now on a disabled routine is rejected (409), not a silent enqueue', async () => {
    const member = await loginAgent('member');
    const id = (await member.post('/api/v1/routines', { name: 'Paused', prompt: 'p' })).body.data.id;
    await member.patch(`/api/v1/routines/${id}`, { enabled: false });
    const res = await member.post(`/api/v1/routines/${id}/run-now`, {});
    expect(res.status).toBe(409);
    // Enabling it again makes run-now succeed.
    await member.patch(`/api/v1/routines/${id}`, { enabled: true });
    expect((await member.post(`/api/v1/routines/${id}/run-now`, {})).status).toBe(200);
  });

  it('owner can GET / PATCH / DELETE its routine', async () => {
    const member = await loginAgent('member');
    const made = await member.post('/api/v1/routines', { name: 'R', prompt: 'p' });
    const id = made.body.data.id;

    expect((await member.get(`/api/v1/routines/${id}`)).status).toBe(200);
    expect((await member.patch(`/api/v1/routines/${id}`, { name: 'R2' })).status).toBe(200);
    expect((await member.del(`/api/v1/routines/${id}`)).status).toBe(204);
  });

  it('FIXED (ROUT-Z-03/04): routine GET/PATCH are now scope-enforced — a non-owner cannot read/edit a personal routine', async () => {
    const member = await loginAgent('member');
    const made = await member.post('/api/v1/routines', { name: 'R', prompt: 'p' });
    const id = made.body.data.id;

    // getRoutine() / updateRoutine() now enforce routine scope (this is a
    // default `personal` routine → owner-only), so a same-org peer is denied.
    const other = await loginAgent('lead');
    // FIXED (ROUT-Z-03): non-owner GET on a personal routine → 404.
    expect((await other.get(`/api/v1/routines/${id}`)).status).toBe(404);
    // FIXED (ROUT-Z-04): non-owner PATCH on a personal routine → 404, no mutation.
    const patched = await other.patch(`/api/v1/routines/${id}`, { name: 'hijacked' });
    expect(patched.status).toBe(404);
    expect((await prisma.routine.findUnique({ where: { id } }))?.name).toBe('R');

    // DELETE remains owner-scoped (deleteRoutine uses findFirst id+userId).
    expect((await other.del(`/api/v1/routines/${id}`)).status).toBe(404);
  });

  it('DEFECT (ROUT-E-01): a structurally-valid-but-impossible cron is accepted (201)', async () => {
    const member = await loginAgent('member');
    // 5 fields, each numeric, but every value is out of range
    // (minute=60, hour=24, dom=32, month=13, dow=8). isValidCron only checks
    // field *shape*, never value bounds, so this passes.
    const res = await member.post('/api/v1/routines', {
      name: 'Impossible', prompt: 'never runs', schedule: '60 24 32 13 8',
    });
    // DEFECT (ROUT-E-01): pins current behavior — impossible cron stored as-is.
    expect(res.status).toBe(201);
    const row = await prisma.routine.findUnique({ where: { id: res.body.data.id } });
    expect(row?.schedule).toBe('60 24 32 13 8');
  });
});

describe('skills — lifecycle', () => {
  it('creates a personal skill (201, published) and the author can GET it', async () => {
    const member = await loginAgent('member');
    const res = await member.post('/api/v1/skills', {
      name: 'my-skill',
      description: 'does things',
      content: '---\nname: my-skill\ndescription: does things\n---\nbody',
      scope: 'personal',
    });
    expect(res.status).toBe(201);
    const id = res.body.data.id;
    expect(res.body.data.status).toBe('published');

    const got = await member.get(`/api/v1/skills/${id}`);
    expect(got.status).toBe(200);
  });

  it('installs and uninstalls a skill for the caller', async () => {
    const member = await loginAgent('member');
    const made = await member.post('/api/v1/skills', {
      name: 'installable', description: 'd', content: '---\nname: installable\ndescription: d\n---\nc', scope: 'personal',
    });
    const id = made.body.data.id;

    const install = await member.post(`/api/v1/skills/${id}/install`, {});
    expect(install.status).toBe(201);
    expect(
      await prisma.userSkill.findUnique({
        where: { userId_skillId: { userId: fx.users.member.id, skillId: id } },
      }),
    ).toBeTruthy();

    const uninstall = await member.del(`/api/v1/skills/${id}/install`);
    expect(uninstall.status).toBe(204);
  });

  it('non-admin cannot change skill status (403); non-admin cannot delete (403)', async () => {
    const admin = await loginAgent('admin');
    const made = await admin.post('/api/v1/skills', {
      name: 'governed', description: 'd', content: '---\nname: governed\ndescription: d\n---\nc', scope: 'org',
    });
    const id = made.body.data.id;

    const member = await loginAgent('member');
    expect((await member.patch(`/api/v1/skills/${id}`, { status: 'published' })).status).toBe(403);
    expect((await member.del(`/api/v1/skills/${id}`)).status).toBe(403);
  });

  it('FIXED (SKILL-Z-09): a rival-org user cannot GET a skill from another org', async () => {
    // Seed a skill in the primary org directly.
    const skill = await prisma.skill.create({
      data: {
        orgId: fx.primary.orgId,
        authorId: fx.users.admin.id,
        name: 'Primary Secret',
        description: 'org-private',
        content: '# secret',
        scope: 'org' as never,
        status: 'published' as never,
      },
    });

    const rival = await loginAgent('rival');
    // FIXED (SKILL-Z-09): getSkill now scopes by caller org → cross-org read 404s.
    const res = await rival.get(`/api/v1/skills/${skill.id}`);
    expect(res.status).toBe(404);
  });

  it('FIXED (SKILL-Z-10): a rival-org user cannot INSTALL a skill from another org', async () => {
    const skill = await prisma.skill.create({
      data: {
        orgId: fx.primary.orgId,
        authorId: fx.users.admin.id,
        name: 'Cross Org Install',
        description: 'd',
        content: '# c',
        scope: 'org' as never,
        status: 'published' as never,
      },
    });

    const rival = await loginAgent('rival');
    const res = await rival.post(`/api/v1/skills/${skill.id}/install`, {});
    // FIXED (SKILL-Z-10): installSkill now scopes by caller org → cross-org
    // install 404s and no UserSkill row is created.
    expect(res.status).toBe(404);
    const row = await prisma.userSkill.findUnique({
      where: { userId_skillId: { userId: fx.users.rival.id, skillId: skill.id } },
    });
    expect(row).toBeNull();
  });
});

describe('approvals — resolve', () => {
  /** Seed routine → run → checkpoint → pending approval owned by the routine owner. */
  async function seedPendingApproval(ownerUserId: string) {
    const routine = await prisma.routine.create({
      data: {
        userId: ownerUserId,
        name: 'Gated routine',
        prompt: 'do work',
        delivery: { channels: ['in_app'] },
        orgId: fx.primary.orgId,
      },
    });
    const run = await prisma.routineRun.create({
      data: { routineId: routine.id, status: 'running' as never },
    });
    const checkpoint = await prisma.approvalCheckpoint.create({
      data: { routineId: routine.id, name: 'Gate', position: 0 },
    });
    const approval = await prisma.approvalRequest.create({
      data: { runId: run.id, checkpointId: checkpoint.id, status: 'pending' as never },
    });
    return { routine, run, checkpoint, approval };
  }

  it('the routine owner can resolve a pending approval (200)', async () => {
    const { approval } = await seedPendingApproval(fx.users.member.id);
    const member = await loginAgent('member');
    const res = await member.post(`/api/v1/approvals/${approval.id}/resolve`, {
      decision: 'approved',
    });
    expect(res.status).toBe(200);
    const row = await prisma.approvalRequest.findUnique({ where: { id: approval.id } });
    expect(row?.status).toBe('approved');
  });

  it('rejects an invalid decision (400)', async () => {
    const { approval } = await seedPendingApproval(fx.users.member.id);
    const member = await loginAgent('member');
    const res = await member.post(`/api/v1/approvals/${approval.id}/resolve`, { decision: 'maybe' });
    expect(res.status).toBe(400);
  });

  it('FIXED (APPR-Z-01): a same-org non-owner non-admin CANNOT resolve (403)', async () => {
    // Approval belongs to a routine owned by the team lead, in the PRIMARY org.
    const { approval } = await seedPendingApproval(fx.users.lead.id);

    // The viewer is in the SAME org but is neither the owner nor an admin.
    // Rule (chosen 2026-06-09): only the routine owner or an org admin may
    // resolve an approval.
    const viewer = await loginAgent('viewer');
    const res = await viewer.post(`/api/v1/approvals/${approval.id}/resolve`, {
      decision: 'approved',
    });
    // FIXED (APPR-Z-01): non-owner non-admin → 403, approval stays pending.
    expect(res.status).toBe(403);
    const row = await prisma.approvalRequest.findUnique({ where: { id: approval.id } });
    expect(row?.status).toBe('pending');
  });

  it('FIXED (APPR-Z-01): an org admin (non-owner) CAN resolve', async () => {
    // Owned by the team lead; resolved by the admin (not the owner).
    const { approval } = await seedPendingApproval(fx.users.lead.id);
    const admin = await loginAgent('admin');
    const res = await admin.post(`/api/v1/approvals/${approval.id}/resolve`, {
      decision: 'approved',
    });
    expect(res.status).toBe(200);
    const row = await prisma.approvalRequest.findUnique({ where: { id: approval.id } });
    expect(row?.status).toBe('approved');
    expect(row?.reviewerId).toBe(fx.users.admin.id);
  });

  it('resolving an already-resolved approval is 404', async () => {
    const { approval } = await seedPendingApproval(fx.users.member.id);
    const member = await loginAgent('member');
    expect(
      (await member.post(`/api/v1/approvals/${approval.id}/resolve`, { decision: 'approved' })).status,
    ).toBe(200);
    // Second resolve — no longer pending.
    expect(
      (await member.post(`/api/v1/approvals/${approval.id}/resolve`, { decision: 'rejected' })).status,
    ).toBe(404);
  });
});

describe('approval gate — pause / resume / deliver', () => {
  /**
   * Seed a run paused at a gate exactly as the worker leaves it: status
   * `awaiting_approval`, the produced output stashed on pausedState, and a
   * pending ApprovalRequest carrying that output for the reviewer.
   */
  async function seedGatedRun(ownerUserId: string, agentOutput: string) {
    const routine = await prisma.routine.create({
      data: {
        userId: ownerUserId,
        name: 'Gated digest',
        prompt: 'draft the customer digest',
        delivery: { channels: ['in_app'] },
        orgId: fx.primary.orgId,
      },
    });
    const run = await prisma.routineRun.create({
      data: {
        routineId: routine.id,
        status: 'awaiting_approval' as never,
        pausedState: { output: agentOutput },
      },
    });
    const checkpoint = await prisma.approvalCheckpoint.create({
      data: { routineId: routine.id, name: 'Pre-send review', position: 0 },
    });
    const approval = await prisma.approvalRequest.create({
      data: {
        runId: run.id,
        checkpointId: checkpoint.id,
        status: 'pending' as never,
        agentOutput,
      },
    });
    return { routine, run, checkpoint, approval };
  }

  it('approving a gated run delivers the output and finalizes the run as success', async () => {
    const { run, approval } = await seedGatedRun(fx.users.member.id, 'The Q3 digest is ready for the team.');
    const member = await loginAgent('member');

    const res = await member.post(`/api/v1/approvals/${approval.id}/resolve`, { decision: 'approved' });
    expect(res.status).toBe(200);

    const row = await prisma.routineRun.findUnique({ where: { id: run.id } });
    // FIXED: the run no longer hangs in `running`/`awaiting_approval` — it is
    // finalized as a success carrying the approved output.
    expect(row?.status).toBe('success');
    expect((row?.output as { result?: string } | null)?.result).toBe('The Q3 digest is ready for the team.');
    expect(row?.completedAt).not.toBeNull();
  });

  it('editing on approve delivers the reviewer-edited output, not the original', async () => {
    const { run, approval } = await seedGatedRun(fx.users.member.id, 'original draft with a typo');
    const member = await loginAgent('member');

    const res = await member.post(`/api/v1/approvals/${approval.id}/resolve`, {
      decision: 'edited',
      editedOutput: 'polished final copy',
    });
    expect(res.status).toBe(200);

    const row = await prisma.routineRun.findUnique({ where: { id: run.id } });
    expect(row?.status).toBe('success');
    expect((row?.output as { result?: string } | null)?.result).toBe('polished final copy');
  });

  it('rejecting a gated run fails it without delivering', async () => {
    const { run, approval } = await seedGatedRun(fx.users.member.id, 'do-not-send draft');
    const member = await loginAgent('member');

    const res = await member.post(`/api/v1/approvals/${approval.id}/resolve`, {
      decision: 'rejected',
      comment: 'off-brand',
    });
    expect(res.status).toBe(200);

    const row = await prisma.routineRun.findUnique({ where: { id: run.id } });
    expect(row?.status).toBe('failed');
    expect(row?.error).toContain('off-brand');
  });
});
