/**
 * Knowledge loop, Phase 4 — routines as factories (test plan area F, plus
 * roles and tenancy).
 *
 *   F1  prompt history lists versions with their author
 *   F2  a dry run returns its output next to the last run's output, and
 *       delivers nothing / writes no run / leaves the routine unchanged
 *   F3  approving a curator fix to a routine makes a test case
 *   F4  a later change that drops a required phrase → 409 with reasons
 *       (edit, rollback and a later approval); owners may override (audited)
 *   F5  no past run → a clear 4xx, nothing runs
 *   F6  write / send tools are held back in a dry run
 *   F7  two people dry-running the same routine get separate results
 *   F8  who may dry run: owners (admin / that team's lead / named owner);
 *       members and viewers 403; other orgs 404
 *
 * Real Express app + Postgres. Only the agent is faked: the context builder
 * hands out a fixed tool set whose handlers are spies, and the agent loop
 * calls tools through the REAL executor (`executeTool`), so a held-back tool
 * is genuinely unreachable.
 */
import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  output: (userId: string) => `Three tickets from the Support queue (for ${userId}).`,
  fail: false,
  tryTools: [] as string[],
  calls: [] as Array<{
    userId: string;
    prompt: string;
    tools: string[];
    dryRun: boolean;
    triggerEvent: unknown;
    systemPrompt: string;
  }>,
  toolResults: [] as Array<{ name: string; error?: string }>,
  spies: {} as Record<string, ReturnType<typeof import('vitest').vi.fn>>,
  deliveries: 0,
}));

vi.mock('../src/agent/context-builder.js', async () => {
  const { vi: v } = await import('vitest');
  const names = [
    'slack_post_message',
    'gmail_send_email',
    'jira_create_issue',
    'create_routine',
    'update_routine',
    'save_memory',
    'routine_state',
    'recall_memory',
    'jira_search',
  ];
  for (const n of names) fake.spies[n] = v.fn(async () => ({ output: { ok: true } }));
  return {
    buildAgentContext: async (
      userId: string,
      _sessionId: string,
      _m?: string,
      _a?: string,
      opts?: { triggerEvent?: unknown },
    ) => ({
      userId,
      systemPrompt: 'base',
      triggerEvent: opts?.triggerEvent,
      tools: names.map((name) => ({
        name,
        description: name,
        inputSchema: {},
        handler: fake.spies[name],
      })),
    }),
  };
});

vi.mock('../src/agent/agent-runtime.js', () => ({
  agentLoop: async function* (
    ctx: {
      userId: string;
      tools?: Array<{ name: string }>;
      dryRun?: boolean;
      triggerEvent?: unknown;
      systemPrompt?: string;
    },
    messages: Array<{ content: string }>,
  ) {
    fake.calls.push({
      userId: ctx.userId,
      prompt: messages[0]?.content ?? '',
      tools: (ctx.tools ?? []).map((t) => t.name),
      dryRun: ctx.dryRun === true,
      triggerEvent: ctx.triggerEvent,
      systemPrompt: ctx.systemPrompt ?? '',
    });
    const { executeTool } = await import('../src/agent/tool-router.js');
    const map = new Map((ctx.tools ?? []).map((t) => [t.name, t])) as never;
    for (const name of fake.tryTools) {
      const r = await executeTool(name, {}, map);
      fake.toolResults.push({ name, error: r.error });
    }
    if (fake.fail) throw new Error('The model is not configured');
    yield { type: 'text_delta', content: fake.output(ctx.userId) };
  },
}));

vi.mock('../src/services/routine-delivery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/routine-delivery.js')>();
  return {
    ...actual,
    deliverRoutineOutput: async (...args: Parameters<typeof actual.deliverRoutineOutput>) => {
      fake.deliveries++;
      return actual.deliverRoutineOutput(...args);
    },
  };
});

import {
  prisma,
  seedAuthFixture,
  loginAgent,
  truncateAll,
  disconnect,
  type AuthFixture,
  type AgentClient,
} from './setup.js';
import { dryRunSettled, getDryRun, DRY_RUN_TTL_MS } from '../src/services/routine-dry-run.js';
import { createToolRouter } from '../src/agent/tool-router.js';
import { runWithTenant } from '../src/lib/tenant-context.js';

let fx: AuthFixture;
let admin: AgentClient;
let lead: AgentClient;
let member: AgentClient;
let viewer: AgentClient;
let rival: AgentClient;

const PROMPT_V1 = 'Summarise yesterday’s customer tickets for {{team}}.';
const PROMPT_FIXED =
  'Summarise yesterday’s customer tickets for {{team}} from the Support queue (use ticket_lookup).';

beforeEach(async () => {
  await truncateAll();
  fx = await seedAuthFixture();
  await setFlag(fx.primary.orgId, true);
  await setFlag(fx.rival.orgId, true);
  [admin, lead, member, viewer, rival] = await Promise.all([
    loginAgent('admin'),
    loginAgent('lead'),
    loginAgent('member'),
    loginAgent('viewer'),
    loginAgent('rival'),
  ]);
  fake.output = (userId) => `Three tickets from the Support queue (for ${userId}).`;
  fake.fail = false;
  fake.tryTools = [];
  fake.calls = [];
  fake.toolResults = [];
  fake.deliveries = 0;
  for (const s of Object.values(fake.spies)) s.mockClear();
});

afterAll(async () => {
  await disconnect();
});

async function setFlag(orgId: string, on: boolean) {
  await prisma.org.update({
    where: { id: orgId },
    data: { settings: { features: { knowledgeLoop: on } } },
  });
}

async function routine(
  over: {
    scope?: 'org' | 'team' | 'personal';
    userId?: string;
    prompt?: string;
    orgId?: string;
    teamId?: string | null;
    ownerId?: string | null;
  } = {},
) {
  const scope = over.scope ?? 'team';
  const r = await prisma.routine.create({
    data: {
      userId: over.userId ?? fx.users.lead.id,
      name: 'Ticket digest',
      prompt: over.prompt ?? PROMPT_V1,
      delivery: { channels: ['in_app'] },
      scope,
      teamId: scope === 'team' ? (over.teamId ?? fx.primary.teamId) : null,
      orgId: over.orgId ?? fx.primary.orgId,
      ownerId: over.ownerId ?? null,
      parameters: [{ name: 'team', type: 'string', required: false, default: 'Everyone' }],
      version: 1,
    },
  });
  await prisma.routineVersion.create({
    data: {
      routineId: r.id,
      version: 1,
      snapshot: { prompt: r.prompt, name: r.name },
      changeSource: 'user',
      changedById: r.userId,
    },
  });
  return r;
}

async function pastRun(routineId: string, over: Record<string, unknown> = {}) {
  return prisma.routineRun.create({
    data: {
      routineId,
      status: 'success',
      output: { result: 'Old output: two tickets.' },
      parameterValues: { team: 'Support' },
      triggerEvent: { provider: 'jira', eventType: 'issue.created', payload: { key: 'HD-1' } },
      triggeredBy: 'event',
      completedAt: new Date(),
      ...over,
    } as never,
  });
}

async function testCase(routineId: string, mustContain: string[], orgId = fx.primary.orgId) {
  return prisma.routineTestCase.create({
    data: {
      orgId,
      routineId,
      description: 'Keeps the Support queue',
      mustContain,
      source: 'manual',
    },
  });
}

/** Start a dry run and wait for it to finish; returns the finished result. */
async function dryRun(client: AgentClient, routineId: string, body: object = {}) {
  const start = await client.post(`/api/v1/routines/${routineId}/dry-run`, body);
  expect(start.status).toBe(202);
  expect(start.body.data.status).toBe('running');
  await dryRunSettled(start.body.data.id);
  const done = await client.get(`/api/v1/routines/${routineId}/dry-runs/${start.body.data.id}`);
  expect(done.status).toBe(200);
  return done.body.data;
}

async function auditRows(action: string) {
  // logAudit is fire-and-forget; give it a moment.
  for (let i = 0; i < 20; i++) {
    const rows = await prisma.auditLog.findMany({ where: { action } });
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
  return prisma.auditLog.findMany({ where: { action } });
}

async function proposal(
  r: { id: string; version: number; prompt: string },
  after: string,
  over: Record<string, unknown> = {},
) {
  return prisma.knowledgeProposal.create({
    data: {
      orgId: fx.primary.orgId,
      targetType: 'routine',
      targetId: r.id,
      targetScope: 'team',
      targetTeamId: fx.primary.teamId,
      targetUserId: fx.users.lead.id,
      targetName: 'Ticket digest',
      targetVersion: r.version,
      before: r.prompt,
      after,
      reason: 'Runs failed because the tickets live in the Support queue.',
      availableAt: new Date(Date.now() - 1000),
      ...over,
    } as never,
  });
}

// ── F1: prompt history ─────────────────────────────────────────────────────

describe('F1 prompt history', () => {
  it('lists versions newest first, with who changed it, how, and the prompt', async () => {
    const r = await routine();
    expect((await lead.patch(`/api/v1/routines/${r.id}`, { prompt: 'Second prompt' })).status).toBe(
      200,
    );
    expect((await admin.patch(`/api/v1/routines/${r.id}`, { prompt: 'Third prompt' })).status).toBe(
      200,
    );
    const res = await lead.get(`/api/v1/routines/${r.id}/versions`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(res.body.data[0]).toMatchObject({
      changeSource: 'user',
      changedBy: { id: fx.users.admin.id, name: 'Admin' },
      snapshot: { prompt: 'Third prompt' },
    });
    expect(res.body.data[1].changedBy).toEqual({ id: fx.users.lead.id, name: 'Team Lead' });
    expect(res.body.currentVersion).toBe(3);
    expect(res.body.isOwner).toBe(true);
  });

  it('a restore shows as source "rollback" with the version it restored', async () => {
    const r = await routine();
    await lead.patch(`/api/v1/routines/${r.id}`, { prompt: 'Second prompt' });
    expect((await lead.post(`/api/v1/routines/${r.id}/rollback`, { version: 1 })).status).toBe(200);
    const res = await lead.get(`/api/v1/routines/${r.id}/versions`);
    expect(res.body.data[0]).toMatchObject({
      version: 3,
      changeSource: 'rollback',
      restoredFrom: 1,
      changedBy: { name: 'Team Lead' },
      snapshot: { prompt: PROMPT_V1 },
    });
  });

  it('members read history but are not owners and cannot restore', async () => {
    const r = await routine();
    const res = await member.get(`/api/v1/routines/${r.id}/versions`);
    expect(res.status).toBe(200);
    expect(res.body.isOwner).toBe(false);
    expect((await member.post(`/api/v1/routines/${r.id}/rollback`, { version: 1 })).status).toBe(
      403,
    );
    expect((await rival.get(`/api/v1/routines/${r.id}/versions`)).status).toBe(404);
  });

  it('a system change (no author) has changedBy null', async () => {
    const r = await routine();
    await prisma.routineVersion.update({
      where: { routineId_version: { routineId: r.id, version: 1 } },
      data: { changedById: null, changeSource: 'migration' },
    });
    const res = await lead.get(`/api/v1/routines/${r.id}/versions`);
    expect(res.body.data[0]).toMatchObject({ changeSource: 'migration', changedBy: null });
  });

  it('memory history carries authors and isOwner too', async () => {
    const created = await admin.post('/api/v1/memory', { layer: 'org', content: 'Fact one.' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const res = await member.get(`/api/v1/memory/${id}/versions`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].changedBy).toEqual({ id: fx.users.admin.id, name: 'Admin' });
    expect(res.body.isOwner).toBe(false);
    expect((await admin.get(`/api/v1/memory/${id}/versions`)).body.isOwner).toBe(true);
  });
});

// ── Ownership ──────────────────────────────────────────────────────────────

describe('ownership', () => {
  it('team routine: default owners, and only admins may change them', async () => {
    const r = await routine();
    const asLead = await lead.get(`/api/v1/routines/${r.id}/ownership`);
    expect(asLead.status).toBe(200);
    expect(asLead.body.data).toMatchObject({
      scope: 'team',
      defaultOwnerLabel: 'Engineering leads and admins',
      owner: null,
      isOwner: true,
      canChangeOwner: false,
    });
    expect(asLead.body.data.candidates).toBeUndefined();

    const asAdmin = await admin.get(`/api/v1/routines/${r.id}/ownership`);
    expect(asAdmin.body.data.canChangeOwner).toBe(true);
    const names = asAdmin.body.data.candidates.map((c: { name: string }) => c.name).sort();
    expect(names).toEqual(['Admin', 'Member', 'Team Lead']);

    const asMember = await member.get(`/api/v1/routines/${r.id}/ownership`);
    expect(asMember.body.data).toMatchObject({ isOwner: false, canChangeOwner: false });
    expect((await viewer.get(`/api/v1/routines/${r.id}/ownership`)).body.data.isOwner).toBe(false);
  });

  it('a named owner is shown and becomes an owner', async () => {
    const r = await routine();
    expect(
      (await admin.patch(`/api/v1/routines/${r.id}/owner`, { ownerId: fx.users.member.id })).status,
    ).toBe(200);
    const res = await member.get(`/api/v1/routines/${r.id}/ownership`);
    expect(res.body.data).toMatchObject({
      owner: { id: fx.users.member.id, name: 'Member' },
      isOwner: true,
    });
  });

  it('org routine → "Admins"; personal routine → its person, nobody may change it', async () => {
    const org = await routine({ scope: 'org', userId: fx.users.admin.id });
    expect((await member.get(`/api/v1/routines/${org.id}/ownership`)).body.data).toMatchObject({
      defaultOwnerLabel: 'Admins',
      isOwner: false,
    });
    const mine = await routine({ scope: 'personal', userId: fx.users.member.id });
    expect((await member.get(`/api/v1/routines/${mine.id}/ownership`)).body.data).toMatchObject({
      defaultOwnerLabel: 'Member',
      isOwner: true,
      canChangeOwner: false,
    });
    expect((await admin.get(`/api/v1/routines/${mine.id}/ownership`)).status).toBe(404);
  });

  it('other orgs get 404; flag off → 404', async () => {
    const r = await routine();
    expect((await rival.get(`/api/v1/routines/${r.id}/ownership`)).status).toBe(404);
    await setFlag(fx.primary.orgId, false);
    expect((await admin.get(`/api/v1/routines/${r.id}/ownership`)).status).toBe(404);
  });
});

// ── F2 / F5 / F6 / F7: dry runs ────────────────────────────────────────────

describe('F2 dry run', () => {
  it('returns the new output next to the last output, on the last input', async () => {
    const r = await routine();
    const run = await pastRun(r.id);
    const result = await dryRun(lead, r.id);
    expect(result).toMatchObject({
      status: 'success',
      kind: 'dry_run',
      candidatePrompt: null,
      routineVersion: 1,
      lastOutput: 'Old output: two tickets.',
      output: `Three tickets from the Support queue (for ${fx.users.lead.id}).`,
      sourceRun: { id: run.id, status: 'success' },
      error: null,
    });
    // The last run's parameter values and trigger event were replayed.
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].prompt).toBe('Summarise yesterday’s customer tickets for Support.');
    expect(fake.calls[0].triggerEvent).toMatchObject({ eventType: 'issue.created' });
    expect(fake.calls[0].dryRun).toBe(true);
    expect(fake.calls[0].userId).toBe(fx.users.lead.id);
    expect(fake.calls[0].systemPrompt).toMatch(/DRY RUN/);
    expect(new Date(result.expiresAt).getTime() - new Date(result.createdAt).getTime()).toBe(
      DRY_RUN_TTL_MS,
    );
  });

  it('delivers nothing, writes no run, and leaves the routine and its versions unchanged', async () => {
    const r = await routine();
    await pastRun(r.id);
    const before = await prisma.routine.findUniqueOrThrow({ where: { id: r.id } });
    await dryRun(lead, r.id, { prompt: 'A candidate prompt for {{team}}' });
    const after = await prisma.routine.findUniqueOrThrow({ where: { id: r.id } });
    expect(after).toEqual(before);
    expect(await prisma.routineRun.count({ where: { routineId: r.id } })).toBe(1);
    expect(await prisma.routineVersion.count({ where: { routineId: r.id } })).toBe(1);
    expect(fake.deliveries).toBe(0);
    expect(await prisma.knowledgeSignal.count()).toBe(0);
    expect(fake.calls[0].prompt).toBe('A candidate prompt for Support');
  });

  it('a candidate prompt is tried and kept on the result only', async () => {
    const r = await routine();
    await pastRun(r.id);
    const result = await dryRun(lead, r.id, { prompt: 'Try this instead' });
    expect(result.candidatePrompt).toBe('Try this instead');
    expect((await prisma.routine.findUniqueOrThrow({ where: { id: r.id } })).prompt).toBe(
      PROMPT_V1,
    );
  });

  it('uses the latest finished run, and parameter defaults fill gaps', async () => {
    const r = await routine();
    await pastRun(r.id, {
      startedAt: new Date(Date.now() - 60_000),
      parameterValues: { team: 'Old' },
    });
    await pastRun(r.id, {
      status: 'failed',
      output: null,
      error: 'Tool not found',
      parameterValues: {},
    });
    await pastRun(r.id, { status: 'running', startedAt: new Date(Date.now() + 1000) });
    const result = await dryRun(lead, r.id);
    expect(result.sourceRun).toMatchObject({ status: 'failed', error: 'Tool not found' });
    expect(result.lastOutput).toBeNull();
    expect(fake.calls[0].prompt).toBe('Summarise yesterday’s customer tickets for Everyone.');
  });

  it('an agent failure is reported on the dry run, still writing nothing', async () => {
    const r = await routine();
    await pastRun(r.id);
    fake.fail = true;
    const result = await dryRun(lead, r.id);
    expect(result).toMatchObject({ status: 'failed', output: null });
    expect(result.error).toMatch(/not configured/);
    expect(await prisma.routineRun.count({ where: { routineId: r.id } })).toBe(1);
  });

  it('validates the body', async () => {
    const r = await routine();
    await pastRun(r.id);
    for (const body of [
      { prompt: '' },
      { prompt: '   ' },
      { prompt: 'x'.repeat(20_001) },
      { prompt: 5 },
      { other: 1 },
    ]) {
      expect((await lead.post(`/api/v1/routines/${r.id}/dry-run`, body)).status).toBe(400);
    }
    expect((await lead.get(`/api/v1/routines/${r.id}/dry-runs/not-a-uuid`)).status).toBe(400);
    expect(await prisma.routineDryRun.count()).toBe(0);
  });

  it('caps running dry runs per person (429)', async () => {
    const r = await routine();
    await pastRun(r.id);
    for (let i = 0; i < 3; i++) {
      await prisma.routineDryRun.create({
        data: {
          orgId: fx.primary.orgId,
          routineId: r.id,
          requestedById: fx.users.lead.id,
          routineVersion: 1,
          status: 'running',
          expiresAt: new Date(Date.now() + DRY_RUN_TTL_MS),
        },
      });
    }
    const res = await lead.post(`/api/v1/routines/${r.id}/dry-run`, {});
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('too_many_dry_runs');
    // Someone else is not affected.
    const other = await admin.post(`/api/v1/routines/${r.id}/dry-run`, {});
    expect(other.status).toBe(202);
    await dryRunSettled(other.body.data.id);
  });

  it('a run left "running" past the timeout reads as failed', async () => {
    const r = await routine();
    const row = await prisma.routineDryRun.create({
      data: {
        orgId: fx.primary.orgId,
        routineId: r.id,
        requestedById: fx.users.lead.id,
        routineVersion: 1,
        status: 'running',
        createdAt: new Date(Date.now() - 10 * 60_000),
        expiresAt: new Date(Date.now() + DRY_RUN_TTL_MS),
      },
    });
    const res = await lead.get(`/api/v1/routines/${r.id}/dry-runs/${row.id}`);
    expect(res.body.data.status).toBe('failed');
    expect(res.body.data.error).toMatch(/stopped/);
  });
});

describe('F5 no past run', () => {
  it('answers 409 with a clear message and runs nothing', async () => {
    const r = await routine();
    const res = await lead.post(`/api/v1/routines/${r.id}/dry-run`, {});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('no_past_run');
    expect(res.body.error).toMatch(/has not run yet/);
    expect(fake.calls).toHaveLength(0);
    expect(await prisma.routineDryRun.count()).toBe(0);
  });

  it('a run still in progress does not count as a past run', async () => {
    const r = await routine();
    await pastRun(r.id, { status: 'running', completedAt: null });
    expect((await lead.post(`/api/v1/routines/${r.id}/dry-run`, {})).status).toBe(409);
  });
});

describe('F6 write tools are held back', () => {
  it('the agent only gets read tools; calling a write tool reaches no handler', async () => {
    const r = await routine();
    await pastRun(r.id);
    fake.tryTools = [
      'slack_post_message',
      'gmail_send_email',
      'jira_create_issue',
      'create_routine',
      'update_routine',
      'save_memory',
      'routine_state',
      'recall_memory',
      'jira_search',
    ];
    const result = await dryRun(lead, r.id);
    expect(result.status).toBe('success');
    expect(fake.calls[0].tools.sort()).toEqual(['jira_search', 'recall_memory']);
    for (const n of [
      'slack_post_message',
      'gmail_send_email',
      'jira_create_issue',
      'create_routine',
      'update_routine',
      'save_memory',
      'routine_state',
    ]) {
      expect(fake.spies[n]).not.toHaveBeenCalled();
      expect(fake.toolResults.find((t) => t.name === n)?.error).toMatch(/Unknown tool/);
    }
    expect(fake.spies.recall_memory).toHaveBeenCalledTimes(1);
    expect(fake.spies.jira_search).toHaveBeenCalledTimes(1);
    expect(result.blockedTools.sort()).toEqual(
      [
        'create_routine',
        'gmail_send_email',
        'jira_create_issue',
        'routine_state',
        'save_memory',
        'slack_post_message',
        'update_routine',
      ].sort(),
    );
  });

  it('a real routine run (not a dry run) still gets every tool', async () => {
    const { processRoutineJob } = await import('../src/jobs/routine-scheduler.js');
    const r = await routine();
    await processRoutineJob({ id: 'j1', data: { routineId: r.id, userId: fx.users.lead.id } });
    expect(fake.calls[0].dryRun).toBe(false);
    expect(fake.calls[0].tools).toContain('slack_post_message');
    expect(fake.deliveries).toBe(1);
  });
});

describe('F7 separate results', () => {
  it('two people dry-running the same routine each get their own result', async () => {
    const r = await routine();
    await pastRun(r.id);
    const [a, b] = await Promise.all([
      lead.post(`/api/v1/routines/${r.id}/dry-run`, { prompt: 'Lead version' }),
      admin.post(`/api/v1/routines/${r.id}/dry-run`, { prompt: 'Admin version' }),
    ]);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body.data.id).not.toBe(b.body.data.id);
    await Promise.all([dryRunSettled(a.body.data.id), dryRunSettled(b.body.data.id)]);

    const ra = (await lead.get(`/api/v1/routines/${r.id}/dry-runs/${a.body.data.id}`)).body.data;
    const rb = (await admin.get(`/api/v1/routines/${r.id}/dry-runs/${b.body.data.id}`)).body.data;
    expect(ra.candidatePrompt).toBe('Lead version');
    expect(ra.output).toContain(fx.users.lead.id);
    expect(rb.candidatePrompt).toBe('Admin version');
    expect(rb.output).toContain(fx.users.admin.id);

    // Neither can read the other's.
    expect((await lead.get(`/api/v1/routines/${r.id}/dry-runs/${b.body.data.id}`)).status).toBe(
      404,
    );
    expect((await admin.get(`/api/v1/routines/${r.id}/dry-runs/${a.body.data.id}`)).status).toBe(
      404,
    );
  });

  it('the same person running twice also gets two results', async () => {
    const r = await routine();
    await pastRun(r.id);
    const one = await dryRun(lead, r.id, { prompt: 'One' });
    const two = await dryRun(lead, r.id, { prompt: 'Two' });
    expect(one.id).not.toBe(two.id);
    expect(await prisma.routineDryRun.count()).toBe(2);
  });
});

describe('F8 who may dry run', () => {
  async function status(client: AgentClient, id: string) {
    const res = await client.post(`/api/v1/routines/${id}/dry-run`, {});
    if (res.status === 202) await dryRunSettled(res.body.data.id);
    return res.status;
  }

  it('team routine: admin and that team’s lead yes; member and viewer 403; rival 404', async () => {
    const r = await routine();
    await pastRun(r.id);
    expect(await status(admin, r.id)).toBe(202);
    expect(await status(lead, r.id)).toBe(202);
    expect(await status(member, r.id)).toBe(403);
    expect(await status(viewer, r.id)).toBe(403);
    expect(await status(rival, r.id)).toBe(404);
  });

  it('a lead of ANOTHER team cannot see the team routine (404)', async () => {
    const otherTeam = await prisma.team.create({
      data: { name: 'Sales', orgId: fx.primary.orgId },
    });
    await prisma.user.update({ where: { id: fx.users.lead.id }, data: { teamId: otherTeam.id } });
    const r = await routine({ userId: fx.users.admin.id });
    await pastRun(r.id);
    expect(await status(lead, r.id)).toBe(404);
  });

  it('org routine: admins only', async () => {
    const r = await routine({ scope: 'org', userId: fx.users.admin.id });
    await pastRun(r.id);
    expect(await status(admin, r.id)).toBe(202);
    expect(await status(lead, r.id)).toBe(403);
    expect(await status(member, r.id)).toBe(403);
  });

  it('personal routine: only its person', async () => {
    const r = await routine({ scope: 'personal', userId: fx.users.member.id });
    await pastRun(r.id);
    expect(await status(member, r.id)).toBe(202);
    expect(await status(admin, r.id)).toBe(404);
    expect(await status(lead, r.id)).toBe(404);
  });

  it('a named owner may dry run a team routine', async () => {
    const r = await routine({ ownerId: fx.users.member.id });
    await pastRun(r.id);
    expect(await status(member, r.id)).toBe(202);
  });

  it('flag off → 404 for every new route; Phase 0 routes keep working', async () => {
    const r = await routine();
    await pastRun(r.id);
    const tc = await testCase(r.id, ['Support queue']);
    await setFlag(fx.primary.orgId, false);
    const base = `/api/v1/routines/${r.id}`;
    expect((await lead.post(`${base}/dry-run`, {})).status).toBe(404);
    expect((await lead.get(`${base}/dry-runs/${tc.id}`)).status).toBe(404);
    expect((await lead.get(`${base}/test-cases`)).status).toBe(404);
    expect(
      (await lead.post(`${base}/test-cases`, { description: 'd', mustContain: ['x'] })).status,
    ).toBe(404);
    expect((await lead.patch(`${base}/test-cases/${tc.id}`, { description: 'd' })).status).toBe(
      404,
    );
    expect((await lead.del(`${base}/test-cases/${tc.id}`)).status).toBe(404);
    expect((await lead.post(`${base}/test-cases/run`, {})).status).toBe(404);
    expect((await lead.get(`${base}/ownership`)).status).toBe(404);
    // Phase 0 endpoints are unaffected — and with the flag off the guard is off.
    expect((await lead.get(`${base}/versions`)).status).toBe(200);
    expect((await lead.patch(base, { prompt: 'No queue any more' })).status).toBe(200);
    expect((await lead.post(`${base}/rollback`, { version: 1 })).status).toBe(200);
    expect((await admin.patch(`${base}/owner`, { ownerId: fx.users.member.id })).status).toBe(200);
  });
});

describe('24h expiry', () => {
  it('a dry run older than 24 hours is gone', async () => {
    const r = await routine();
    await pastRun(r.id);
    const result = await dryRun(lead, r.id);
    const later = new Date(Date.now() + DRY_RUN_TTL_MS + 1000);
    const viaService = await runWithTenant(
      { orgId: fx.primary.orgId, userId: fx.users.lead.id },
      () =>
        getDryRun({
          id: result.id,
          routineId: r.id,
          orgId: fx.primary.orgId,
          userId: fx.users.lead.id,
          now: later,
        }),
    );
    expect(viaService).toBeNull();

    await prisma.routineDryRun.update({
      where: { id: result.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await lead.get(`/api/v1/routines/${r.id}/dry-runs/${result.id}`)).status).toBe(404);
    // Starting a new dry run removes the expired row.
    await dryRun(admin, r.id);
    expect(await prisma.routineDryRun.findUnique({ where: { id: result.id } })).toBeNull();
  });
});

// ── F3: test cases from approved fixes ─────────────────────────────────────

describe('F3 approving a routine fix makes a test case', () => {
  it('the phrases the fix added become the case', async () => {
    const r = await routine();
    const p = await proposal(r, PROMPT_FIXED);
    const res = await lead.post(`/api/v1/knowledge/proposals/${p.id}/approve`, {});
    expect(res.status).toBe(200);
    const cases = await prisma.routineTestCase.findMany({ where: { routineId: r.id } });
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      proposalId: p.id,
      source: 'proposal',
      orgId: fx.primary.orgId,
      createdById: fx.users.lead.id,
      mustContain: ['Support queue', 'ticket_lookup'],
    });
    // Built from the prompt only — never the curator's (owner-only) reason.
    expect(cases[0].description).toBe(
      'Keeps an approved fix: the prompt says "Support queue", "ticket_lookup"',
    );

    const list = await member.get(`/api/v1/routines/${r.id}/test-cases`);
    expect(list.status).toBe(200);
    expect(list.body.canEdit).toBe(false);
    expect(list.body.data[0]).toMatchObject({ source: 'proposal', proposalId: p.id });
  });

  it('an edited approval uses the owner’s text', async () => {
    const r = await routine();
    const p = await proposal(r, PROMPT_FIXED);
    const edited = `${PROMPT_V1} Include the Billing backlog.`;
    expect(
      (await lead.post(`/api/v1/knowledge/proposals/${p.id}/approve`, { after: edited })).status,
    ).toBe(200);
    const c = await prisma.routineTestCase.findFirstOrThrow({ where: { routineId: r.id } });
    expect(c.mustContain).toEqual(['Include the Billing backlog']);
  });

  it('a fix that only removes text makes no case', async () => {
    const r = await routine({ prompt: `${PROMPT_V1} Ignore weekends.` });
    const p = await proposal(r, PROMPT_V1);
    expect((await lead.post(`/api/v1/knowledge/proposals/${p.id}/approve`, {})).status).toBe(200);
    expect(await prisma.routineTestCase.count()).toBe(0);
  });

  it('memory fixes make no test case', async () => {
    const m = await prisma.memoryEntry.create({
      data: { orgId: fx.primary.orgId, layer: 'org', content: 'Old fact.', version: 1 },
    });
    const p = await prisma.knowledgeProposal.create({
      data: {
        orgId: fx.primary.orgId,
        targetType: 'memory',
        targetId: m.id,
        targetScope: 'org',
        targetName: 'Old fact',
        targetVersion: 1,
        before: 'Old fact.',
        after: 'New fact with more words.',
        reason: 'r',
        availableAt: new Date(Date.now() - 1000),
      },
    });
    expect((await admin.post(`/api/v1/knowledge/proposals/${p.id}/approve`, {})).status).toBe(200);
    expect(await prisma.routineTestCase.count()).toBe(0);
  });
});

// ── F4: the guard ──────────────────────────────────────────────────────────

describe('F4 a change that drops a required phrase is blocked', () => {
  async function guarded() {
    const r = await routine({ prompt: PROMPT_FIXED });
    const tc = await testCase(r.id, ['Support queue']);
    return { r, tc };
  }

  it('PATCH → 409 with the failing cases and why; nothing changes', async () => {
    const { r, tc } = await guarded();
    const res = await lead.patch(`/api/v1/routines/${r.id}`, { prompt: 'Summarise tickets.' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('tests_failed');
    expect(res.body.failures).toEqual([
      {
        testCaseId: tc.id,
        description: 'Keeps the Support queue',
        missing: ['Support queue'],
        reason: 'The new prompt no longer says "Support queue".',
      },
    ]);
    const after = await prisma.routine.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.prompt).toBe(PROMPT_FIXED);
    expect(after.version).toBe(1);
    expect(await prisma.routineVersion.count({ where: { routineId: r.id } })).toBe(1);
  });

  it('a change that keeps the phrase, or changes other fields, goes through', async () => {
    const { r } = await guarded();
    expect(
      (await lead.patch(`/api/v1/routines/${r.id}`, { prompt: 'Only the SUPPORT queue, please.' }))
        .status,
    ).toBe(200);
    expect((await lead.patch(`/api/v1/routines/${r.id}`, { name: 'Renamed' })).status).toBe(200);
  });

  it('overrideTests by an owner saves and is audit-logged', async () => {
    const { r, tc } = await guarded();
    const res = await lead.patch(`/api/v1/routines/${r.id}`, {
      prompt: 'Summarise tickets.',
      overrideTests: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.prompt).toBe('Summarise tickets.');
    const rows = await auditRows('knowledge_tests_override');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: fx.users.lead.id,
      entityType: 'routine',
      entityId: r.id,
    });
    expect(rows[0].details).toMatchObject({ via: 'edit', testCaseIds: [tc.id] });
  });

  it('overrideTests with nothing to override writes no audit row', async () => {
    const { r } = await guarded();
    expect(
      (await lead.patch(`/api/v1/routines/${r.id}`, { name: 'x', overrideTests: true })).status,
    ).toBe(200);
    await new Promise((res) => setTimeout(res, 100));
    expect(await prisma.auditLog.count({ where: { action: 'knowledge_tests_override' } })).toBe(0);
  });

  it('overrideTests by a non-owner → 403, nothing changes', async () => {
    const { r } = await guarded();
    const res = await member.patch(`/api/v1/routines/${r.id}`, {
      prompt: 'Summarise tickets.',
      overrideTests: true,
    });
    expect(res.status).toBe(403);
    expect((await prisma.routine.findUniqueOrThrow({ where: { id: r.id } })).prompt).toBe(
      PROMPT_FIXED,
    );
    expect(
      (await rival.patch(`/api/v1/routines/${r.id}`, { prompt: 'x', overrideTests: true })).status,
    ).toBe(404);
  });

  it('overrideTests must be a boolean', async () => {
    const { r } = await guarded();
    expect(
      (await lead.patch(`/api/v1/routines/${r.id}`, { prompt: 'x', overrideTests: 'yes' })).status,
    ).toBe(400);
  });

  it('a non-editor gets the old 404, not the test details', async () => {
    const { r } = await guarded();
    const res = await member.patch(`/api/v1/routines/${r.id}`, { prompt: 'Summarise tickets.' });
    expect(res.status).toBe(404);
    expect(res.body.failures).toBeUndefined();
  });

  it('rollback is guarded too, and may be overridden', async () => {
    const r = await routine(); // v1 has no "Support queue"
    expect((await lead.patch(`/api/v1/routines/${r.id}`, { prompt: PROMPT_FIXED })).status).toBe(
      200,
    );
    const tc = await testCase(r.id, ['Support queue']);
    const blocked = await lead.post(`/api/v1/routines/${r.id}/rollback`, { version: 1 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.failures[0].testCaseId).toBe(tc.id);
    expect((await prisma.routine.findUniqueOrThrow({ where: { id: r.id } })).version).toBe(2);

    const ok = await lead.post(`/api/v1/routines/${r.id}/rollback`, {
      version: 1,
      overrideTests: true,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.prompt).toBe(PROMPT_V1);
    const rows = await auditRows('knowledge_tests_override');
    expect(rows[0].details).toMatchObject({ via: 'rollback', restoredFrom: 1 });
  });

  it('a later proposal approval is guarded; the card stays pending; override works', async () => {
    const r = await routine();
    const first = await proposal(r, PROMPT_FIXED);
    expect((await lead.post(`/api/v1/knowledge/proposals/${first.id}/approve`, {})).status).toBe(
      200,
    );
    const now = await prisma.routine.findUniqueOrThrow({ where: { id: r.id } });

    const second = await proposal(now, 'Summarise every ticket.', {
      reason: 'Simpler is better.',
    });
    const blocked = await lead.post(`/api/v1/knowledge/proposals/${second.id}/approve`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('tests_failed');
    expect(blocked.body.failures[0].missing).toEqual(['Support queue', 'ticket_lookup']);
    expect(
      (await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: second.id } })).status,
    ).toBe('pending');
    expect((await prisma.routine.findUniqueOrThrow({ where: { id: r.id } })).prompt).toBe(
      PROMPT_FIXED,
    );

    const ok = await lead.post(`/api/v1/knowledge/proposals/${second.id}/approve`, {
      overrideTests: true,
    });
    expect(ok.status).toBe(200);
    const rows = await auditRows('knowledge_tests_override');
    expect(rows[0].details).toMatchObject({ via: 'proposal', proposalId: second.id });
  });

  it('approve rejects a non-boolean overrideTests', async () => {
    const r = await routine();
    const p = await proposal(r, PROMPT_FIXED);
    expect(
      (await lead.post(`/api/v1/knowledge/proposals/${p.id}/approve`, { overrideTests: 1 })).status,
    ).toBe(400);
  });

  it('an agent editing a personal routine is blocked by its tests, and cannot override', async () => {
    const r = await routine({
      scope: 'personal',
      userId: fx.users.member.id,
      prompt: PROMPT_FIXED,
    });
    await testCase(r.id, ['ticket_lookup']);
    const out = await runWithTenant(
      { orgId: fx.primary.orgId, userId: fx.users.member.id },
      async () => {
        const tools = await createToolRouter({
          userId: fx.users.member.id,
          orgId: fx.primary.orgId,
          teamId: fx.primary.teamId,
          sessionId: 'itest',
        });
        return tools.get('update_routine')!.handler({
          routine_id: r.id,
          prompt: 'Summarise tickets.',
          overrideTests: true,
        });
      },
    );
    expect(out.error).toMatch(/test case/);
    expect((await prisma.routine.findUniqueOrThrow({ where: { id: r.id } })).prompt).toBe(
      PROMPT_FIXED,
    );
  });
});

// ── Test case CRUD ─────────────────────────────────────────────────────────

describe('test case CRUD', () => {
  it('owners add, edit and delete; editing phrases clears the last result', async () => {
    const r = await routine();
    const created = await lead.post(`/api/v1/routines/${r.id}/test-cases`, {
      description: '  Mentions totals ',
      mustContain: [' Total ', 'total', 'per team'],
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      description: 'Mentions totals',
      mustContain: ['Total', 'per team'],
      source: 'manual',
      createdById: fx.users.lead.id,
      lastStatus: null,
    });
    const id = created.body.data.id;
    await prisma.routineTestCase.update({
      where: { id },
      data: { lastStatus: 'passed', lastCheckedAt: new Date(), lastMissing: [] },
    });

    const renamed = await lead.patch(`/api/v1/routines/${r.id}/test-cases/${id}`, {
      description: 'Mentions the total',
    });
    expect(renamed.body.data).toMatchObject({
      description: 'Mentions the total',
      lastStatus: 'passed',
    });

    const rephrased = await admin.patch(`/api/v1/routines/${r.id}/test-cases/${id}`, {
      mustContain: ['Grand total'],
    });
    expect(rephrased.status).toBe(200);
    expect(rephrased.body.data).toMatchObject({
      mustContain: ['Grand total'],
      lastStatus: null,
      lastCheckedAt: null,
      lastMissing: null,
    });

    const list = await lead.get(`/api/v1/routines/${r.id}/test-cases`);
    expect(list.body.canEdit).toBe(true);
    expect(list.body.data).toHaveLength(1);

    expect((await lead.del(`/api/v1/routines/${r.id}/test-cases/${id}`)).status).toBe(204);
    expect((await lead.del(`/api/v1/routines/${r.id}/test-cases/${id}`)).status).toBe(404);
    expect(await auditRows('routine_test_case_deleted')).toHaveLength(1);
  });

  it('validates bodies (400)', async () => {
    const r = await routine();
    const url = `/api/v1/routines/${r.id}/test-cases`;
    const bad = [
      {},
      { description: 'd' },
      { mustContain: ['x'] },
      { description: '', mustContain: ['x'] },
      { description: '   ', mustContain: ['x'] },
      { description: 'd', mustContain: [] },
      { description: 'd', mustContain: [''] },
      { description: 'd', mustContain: ['  '] },
      { description: 'd', mustContain: [1] },
      { description: 'd', mustContain: 'x' },
      { description: 'd', mustContain: Array.from({ length: 11 }, (_, i) => `p${i}`) },
      { description: 'd', mustContain: ['x'.repeat(201)] },
      { description: 'x'.repeat(501), mustContain: ['x'] },
      { description: 'd', mustContain: ['x'], source: 'proposal' },
    ];
    for (const body of bad) expect((await lead.post(url, body)).status).toBe(400);
    const ok = await lead.post(url, { description: 'd', mustContain: ['x'] });
    const id = ok.body.data.id;
    expect((await lead.patch(`${url}/${id}`, {})).status).toBe(400);
    expect((await lead.patch(`${url}/${id}`, { mustContain: [] })).status).toBe(400);
    expect((await lead.patch(`${url}/${id}`, { lastStatus: 'passed' })).status).toBe(400);
    expect((await lead.patch(`${url}/not-a-uuid`, { description: 'x' })).status).toBe(400);
    expect(await prisma.routineTestCase.count()).toBe(1);
  });

  it('members and viewers may read but not change (403); rivals 404', async () => {
    const r = await routine();
    const tc = await testCase(r.id, ['x']);
    const url = `/api/v1/routines/${r.id}/test-cases`;
    for (const c of [member, viewer]) {
      expect((await c.get(url)).status).toBe(200);
      expect((await c.post(url, { description: 'd', mustContain: ['x'] })).status).toBe(403);
      expect((await c.patch(`${url}/${tc.id}`, { description: 'y' })).status).toBe(403);
      expect((await c.del(`${url}/${tc.id}`)).status).toBe(403);
      expect((await c.post(`${url}/run`, {})).status).toBe(403);
    }
    expect((await rival.get(url)).status).toBe(404);
    expect((await rival.post(url, { description: 'd', mustContain: ['x'] })).status).toBe(404);
    expect((await rival.del(`${url}/${tc.id}`)).status).toBe(404);
    expect(await prisma.routineTestCase.count()).toBe(1);
  });

  it('a case cannot be reached through another routine (cross-routine / cross-org)', async () => {
    const mine = await routine();
    const other = await routine();
    const tc = await testCase(other.id, ['x']);
    expect(
      (await lead.patch(`/api/v1/routines/${mine.id}/test-cases/${tc.id}`, { description: 'y' }))
        .status,
    ).toBe(404);
    expect((await lead.del(`/api/v1/routines/${mine.id}/test-cases/${tc.id}`)).status).toBe(404);

    const rivalRoutine = await routine({
      orgId: fx.rival.orgId,
      teamId: fx.rival.teamId,
      userId: fx.users.rival.id,
    });
    const rivalCase = await testCase(rivalRoutine.id, ['secret'], fx.rival.orgId);
    expect(
      (
        await admin.patch(`/api/v1/routines/${mine.id}/test-cases/${rivalCase.id}`, {
          description: 'y',
        })
      ).status,
    ).toBe(404);
    expect((await admin.get(`/api/v1/routines/${rivalRoutine.id}/test-cases`)).status).toBe(404);
    const rivalList = await rival.get(`/api/v1/routines/${rivalRoutine.id}/test-cases`);
    expect(rivalList.body.data.map((c: { id: string }) => c.id)).toEqual([rivalCase.id]);
  });

  it('at most 50 cases per routine', async () => {
    const r = await routine();
    await prisma.routineTestCase.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        orgId: fx.primary.orgId,
        routineId: r.id,
        description: `c${i}`,
        mustContain: ['x'],
      })),
    });
    const res = await lead.post(`/api/v1/routines/${r.id}/test-cases`, {
      description: 'one more',
      mustContain: ['x'],
    });
    expect(res.status).toBe(409);
  });

  it('cases go when the routine is deleted', async () => {
    const r = await routine({ scope: 'personal', userId: fx.users.member.id });
    await testCase(r.id, ['x']);
    expect((await member.del(`/api/v1/routines/${r.id}`)).status).toBe(204);
    expect(await prisma.routineTestCase.count()).toBe(0);
  });
});

// ── Run tests ──────────────────────────────────────────────────────────────

describe('Run tests', () => {
  it('dry-runs the routine and checks every case against the output', async () => {
    const r = await routine();
    await pastRun(r.id);
    const pass = await testCase(r.id, ['Support queue']);
    const fail = await testCase(r.id, ['Total', 'Support queue']);
    const start = await lead.post(`/api/v1/routines/${r.id}/test-cases/run`, {});
    expect(start.status).toBe(202);
    expect(start.body.data.kind).toBe('tests');
    await dryRunSettled(start.body.data.id);
    const result = (await lead.get(`/api/v1/routines/${r.id}/dry-runs/${start.body.data.id}`)).body
      .data;
    expect(result.status).toBe('success');
    expect(result.testResults).toEqual([
      { testCaseId: pass.id, description: pass.description, passed: true, missing: [] },
      { testCaseId: fail.id, description: fail.description, passed: false, missing: ['Total'] },
    ]);
    const list = (await member.get(`/api/v1/routines/${r.id}/test-cases`)).body.data;
    expect(list.find((c: { id: string }) => c.id === pass.id)).toMatchObject({
      lastStatus: 'passed',
      lastMissing: [],
    });
    expect(list.find((c: { id: string }) => c.id === fail.id)).toMatchObject({
      lastStatus: 'failed',
      lastMissing: ['Total'],
    });
    // It went through the dry-run path: nothing delivered, no run written.
    expect(fake.calls[0].dryRun).toBe(true);
    expect(fake.deliveries).toBe(0);
    expect(await prisma.routineRun.count({ where: { routineId: r.id } })).toBe(1);
  });

  it('testing a candidate prompt reports results but does not touch the saved results', async () => {
    const r = await routine();
    await pastRun(r.id);
    const tc = await testCase(r.id, ['Support queue']);
    const start = await lead.post(`/api/v1/routines/${r.id}/test-cases/run`, {
      prompt: 'Candidate',
    });
    await dryRunSettled(start.body.data.id);
    const result = (await lead.get(`/api/v1/routines/${r.id}/dry-runs/${start.body.data.id}`)).body
      .data;
    expect(result.testResults[0]).toMatchObject({ testCaseId: tc.id, passed: true });
    expect(fake.calls[0].prompt).toBe('Candidate');
    expect(
      (await prisma.routineTestCase.findUniqueOrThrow({ where: { id: tc.id } })).lastStatus,
    ).toBeNull();
  });

  it('a failed agent run leaves the cases untouched', async () => {
    const r = await routine();
    await pastRun(r.id);
    const tc = await testCase(r.id, ['Support queue']);
    fake.fail = true;
    const start = await lead.post(`/api/v1/routines/${r.id}/test-cases/run`, {});
    await dryRunSettled(start.body.data.id);
    const result = (await lead.get(`/api/v1/routines/${r.id}/dry-runs/${start.body.data.id}`)).body
      .data;
    expect(result).toMatchObject({ status: 'failed', testResults: null });
    expect(
      (await prisma.routineTestCase.findUniqueOrThrow({ where: { id: tc.id } })).lastStatus,
    ).toBeNull();
  });

  it('no cases → 409; no past run → 409', async () => {
    const r = await routine();
    await pastRun(r.id);
    const none = await lead.post(`/api/v1/routines/${r.id}/test-cases/run`, {});
    expect(none.status).toBe(409);
    expect(none.body.code).toBe('no_test_cases');
    const fresh = await routine();
    await testCase(fresh.id, ['x']);
    const noRun = await lead.post(`/api/v1/routines/${fresh.id}/test-cases/run`, {});
    expect(noRun.status).toBe(409);
    expect(noRun.body.code).toBe('no_past_run');
  });
});
