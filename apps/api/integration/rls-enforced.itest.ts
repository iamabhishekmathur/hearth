/**
 * RLS-enforced integration tests — the app runs as a NON-superuser role.
 *
 * Local dev and the rest of the integration suite connect as a superuser, so
 * Postgres never enforces the row-level-security policies and two production
 * bugs were invisible:
 *   1. BullMQ job processors ran with no tenant context → zero rows / failed
 *      writes on every tenant table (e.g. "Routine not found or disabled").
 *   2. Raw SQL ($queryRaw*, $executeRaw*) skipped the tenant extension → no
 *      RLS GUC → memory search etc. returned nothing even inside a request.
 *
 * This file points the APP's DATABASE_URL at a LOGIN role with NOSUPERUSER
 * NOBYPASSRLS (the production shape), so every query the code under test makes
 * is subject to RLS. Seeding and assertions use a separate superuser client
 * (`su`). The role is created before any app module loads and dropped after.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const rls = await vi.hoisted(async () => {
  const { PrismaClient } = await import('@prisma/client');
  const ROLE = 'hearth_rls_app';
  const PASSWORD = 'hearth_rls_app_pw';
  const superUrl = process.env.DATABASE_URL!;
  const u = new URL(superUrl);
  u.username = ROLE;
  u.password = PASSWORD;
  const roleUrl = u.toString();

  const su = new PrismaClient({ datasourceUrl: superUrl });
  await su.$executeRawUnsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
      CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$`);
  // The express-session store creates its table on first use; a restricted
  // role can't, so make sure it exists (same DDL as connect-pg-simple).
  await su.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "session" (
    "sid" varchar NOT NULL COLLATE "default" PRIMARY KEY,
    "sess" json NOT NULL,
    "expire" timestamp(6) NOT NULL)`);
  await su.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`,
  );
  // Same grants as the production runtime role (see tenant-context.ts).
  await su.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  await su.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`,
  );
  await su.$executeRawUnsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`);

  // Every app module (and setup.ts's plain client) now connects as the role.
  process.env.DATABASE_URL = roleUrl;
  delete (globalThis as { prisma?: unknown }).prisma;

  return {
    ROLE,
    superUrl,
    su,
    processors: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
    prompts: [] as string[],
  };
});

// Capture each worker's processor instead of starting a real BullMQ consumer,
// so tests invoke exactly the function the worker would.
vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();
  class CapturingWorker {
    constructor(name: string, processor: (...args: unknown[]) => Promise<unknown>) {
      rls.processors.set(name, processor);
    }
    on() {
      return this;
    }
    async close() {}
  }
  return { ...actual, Worker: CapturingWorker };
});

// The only fakes: the LLM agent loop, its context builder, and embeddings.
vi.mock('../src/agent/agent-runtime.js', () => ({
  agentLoop: async function* (_ctx: unknown, messages: Array<{ content: string }>) {
    rls.prompts.push(messages[0]?.content ?? '');
    yield { type: 'text_delta', content: 'All done.' };
  },
}));
vi.mock('../src/agent/context-builder.js', () => ({
  buildAgentContext: async () => ({}),
}));
vi.mock('../src/services/embedding-service.js', () => ({
  generateEmbedding: async () => [0.1, 0.2, 0.3],
}));

import {
  prisma as roleHarnessPrisma,
  seedAuthFixture,
  loginAgent,
  type AuthFixture,
} from './setup.js';
import { prisma } from '../src/lib/prisma.js';
import {
  runWithTenant,
  runAsSystem,
  withTenantTx,
  withRlsBypass,
} from '../src/lib/tenant-context.js';
import { withJobContext } from '../src/lib/job-context.js';
import {
  createRoutineWorker,
  processRoutineJob,
  syncRoutineSchedules,
  routineQueue,
} from '../src/jobs/routine-scheduler.js';
import { createTaskExecutionWorker } from '../src/services/task-executor.js';
import { createTaskContextExtractionWorker } from '../src/jobs/task-context-extraction-job.js';
import { createKnowledgeSignalCleanupWorker } from '../src/jobs/knowledge-signal-cleanup-scheduler.js';
import {
  createActivityDigestWorker,
  activityDigestQueue,
} from '../src/jobs/activity-digest-scheduler.js';
import { runDailyDigest } from '../src/services/daily-digest.js';
import { searchMemory } from '../src/services/memory-service.js';
import { httpServer } from '../src/index.js';
import { emitToTask } from '../src/ws/socket-manager.js';
import { dryRunSettled } from '../src/services/routine-dry-run.js';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';

const su = rls.su;
let fx: AuthFixture;

async function truncateAllAsSuperuser(): Promise<void> {
  const rows = await su.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  for (let attempt = 1; ; attempt++) {
    try {
      await su.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
      return;
    } catch (err) {
      if (attempt >= 5 || !/40P01|deadlock|55P03/i.test(String(err))) throw err;
      await new Promise((r) => setTimeout(r, 100 * attempt));
    }
  }
}

const job = <T>(data: T, name = 'job') => ({ id: `itest-${Math.random()}`, name, data });

function processor(queue: string) {
  const p = rls.processors.get(queue);
  if (!p) throw new Error(`no processor captured for ${queue}`);
  return p;
}

beforeEach(async () => {
  await truncateAllAsSuperuser();
  // orgs / teams / users have no RLS, so the role-connected harness can seed them.
  fx = await seedAuthFixture();
  rls.prompts = [];
});

afterAll(async () => {
  await prisma.$disconnect();
  await roleHarnessPrisma.$disconnect();
  await routineQueue.close();
  await activityDigestQueue.close();
  delete (globalThis as { prisma?: unknown }).prisma;
  process.env.DATABASE_URL = rls.superUrl;
  // Drop the role (and its grants) so no other suite ever sees it.
  await su.$executeRawUnsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '${rls.ROLE}'`,
  );
  await su.$executeRawUnsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${rls.ROLE}`);
  await su.$executeRawUnsafe(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${rls.ROLE}`);
  await su.$executeRawUnsafe(`REVOKE ALL ON SCHEMA public FROM ${rls.ROLE}`);
  await su.$executeRawUnsafe(`DROP ROLE IF EXISTS ${rls.ROLE}`);
  await su.$disconnect();
});

// ── Fixtures (written as superuser) ──────────────────────────────────────────

async function seedRoutine(over: Record<string, unknown> = {}) {
  return su.routine.create({
    data: {
      userId: fx.users.lead.id,
      name: 'Morning digest',
      prompt: 'Summarise my day.',
      delivery: { channels: ['in_app'] },
      orgId: fx.primary.orgId,
      ...over,
    },
  });
}

async function seedMemory() {
  const mk = (orgId: string, userId: string, content: string, layer = 'org') =>
    su.memoryEntry.create({ data: { orgId, userId, layer: layer as never, content } });
  const own = await mk(fx.primary.orgId, fx.users.member.id, 'Quarterly roadmap planning notes');
  const ownUser = await mk(
    fx.primary.orgId,
    fx.users.member.id,
    'My personal roadmap reminders',
    'user',
  );
  const rival = await mk(fx.rival.orgId, fx.users.rival.id, 'Rival roadmap secret strategy');
  await su.$executeRawUnsafe(`UPDATE memory_entries SET embedding = '[0.1,0.2,0.3]'::vector`);
  return { own, ownUser, rival };
}

// ── 0. The harness really runs under RLS ─────────────────────────────────────

describe('harness', () => {
  it('app queries run as a NOSUPERUSER NOBYPASSRLS role', async () => {
    const [me] = await prisma.$queryRawUnsafe<
      Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
    >(
      `SELECT current_user, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(me).toEqual({ current_user: rls.ROLE, rolsuper: false, rolbypassrls: false });
  });
});

// ── 1. The failure mode, reproduced ──────────────────────────────────────────

// With no context the extension passes raw SQL straight through — exactly what
// it did for ALL raw SQL before this fix, whatever the context.
describe('without a tenant context (the production bug)', () => {
  it('model and raw reads see zero tenant rows', async () => {
    const routine = await seedRoutine();
    await seedMemory();
    expect(await prisma.routine.findUnique({ where: { id: routine.id } })).toBeNull();
    const [{ n }] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM memory_entries`,
    );
    expect(Number(n)).toBe(0);
  });

  it('writes fail the RLS check', async () => {
    await expect(
      prisma.memoryEntry.create({
        data: { orgId: fx.primary.orgId, userId: fx.users.member.id, layer: 'org', content: 'x' },
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('the unwrapped routine job skips the routine as "not found"', async () => {
    const routine = await seedRoutine();
    const out = await processRoutineJob(
      job({ routineId: routine.id, userId: fx.users.lead.id, triggeredBy: 'manual' as const }),
    );
    expect(out).toBeUndefined();
    expect(rls.prompts).toEqual([]);
    expect(await su.routineRun.count()).toBe(0);
  });
});

// ── 2. Workers run in the system context ─────────────────────────────────────

describe('worker processors (withJobContext)', () => {
  it('routine worker reads the routine, runs it, and records the run', async () => {
    createRoutineWorker();
    const routine = await seedRoutine();
    const out = await processor('routine-execution')(
      job({ routineId: routine.id, userId: fx.users.lead.id, triggeredBy: 'manual' }),
    );
    expect(out).toMatchObject({ routineId: routine.id });
    expect(rls.prompts).toEqual(['Summarise my day.']);
    const runs = await su.routineRun.findMany({ where: { routineId: routine.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('success');
    const saved = await su.routine.findUniqueOrThrow({ where: { id: routine.id } });
    expect(saved.lastRunStatus).toBe('success');
  });

  it('routine worker runs a legacy routine with no org_id only via the bypass', async () => {
    // RLS can never match a NULL org_id against app.org_id, so an org-scoped
    // job context would hide this row — one reason jobs use the bypass.
    createRoutineWorker();
    const routine = await seedRoutine({ orgId: null });
    const out = await processor('routine-execution')(
      job({ routineId: routine.id, userId: fx.users.lead.id, triggeredBy: 'manual' }),
    );
    expect(out).toMatchObject({ routineId: routine.id });
  });

  it('task-execution worker reads the task, runs the agent and moves it to review', async () => {
    createTaskExecutionWorker();
    const task = await su.task.create({
      data: {
        orgId: fx.primary.orgId,
        userId: fx.users.member.id,
        title: 'Draft the launch email',
        source: 'manual',
        status: 'planning',
        context: {},
      },
    });
    await su.taskContextItem.create({
      data: {
        orgId: fx.primary.orgId,
        taskId: task.id,
        type: 'note',
        rawValue: 'Mention the new pricing page.',
        extractedText: 'Mention the new pricing page.',
        extractionStatus: 'completed',
        createdBy: fx.users.member.id,
      } as never,
    });

    const out = await processor('task-execution')(
      job({ taskId: task.id, userId: fx.users.member.id }),
    );
    expect(out).toMatchObject({ taskId: task.id });
    expect(rls.prompts[0]).toContain('Draft the launch email');
    expect(rls.prompts[0]).toContain('Mention the new pricing page.');
    const saved = await su.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(saved.status).toBe('review');
    expect(saved.agentOutput).toEqual({ result: 'All done.' });
    expect(await su.taskExecutionStep.count({ where: { taskId: task.id } })).toBeGreaterThan(0);
  });

  it('task-context-extraction worker extracts and stores the embedding via raw SQL', async () => {
    createTaskContextExtractionWorker();
    const task = await su.task.create({
      data: {
        orgId: fx.primary.orgId,
        userId: fx.users.member.id,
        title: 't',
        source: 'manual',
        status: 'backlog',
        context: {},
      },
    });
    const item = await su.taskContextItem.create({
      data: {
        orgId: fx.primary.orgId,
        taskId: task.id,
        type: 'note',
        rawValue: 'Customer asked for SSO.',
        createdBy: fx.users.member.id,
      } as never,
    });

    await processor('task-context-extraction')(job({ itemId: item.id, taskId: task.id }));

    const [row] = await su.$queryRawUnsafe<
      Array<{ extraction_status: string; extracted_text: string; has_embedding: boolean }>
    >(
      `SELECT extraction_status, extracted_text, embedding IS NOT NULL AS has_embedding
       FROM task_context_items WHERE id = $1`,
      item.id,
    );
    expect(row).toEqual({
      extraction_status: 'completed',
      extracted_text: 'Customer asked for SSO.',
      has_embedding: true,
    });
  });

  it('a job that opens its own withRlsBypass tx (signal cleanup) still works when nested', async () => {
    createKnowledgeSignalCleanupWorker();
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    await su.knowledgeSignal.create({
      data: { orgId: fx.primary.orgId, kind: 'empty_search', source: 'chat', createdAt: old },
    });
    await su.knowledgeSignal.create({
      data: { orgId: fx.rival.orgId, kind: 'empty_search', source: 'chat', createdAt: old },
    });
    await su.knowledgeSignal.create({
      data: { orgId: fx.primary.orgId, kind: 'empty_search', source: 'chat' },
    });
    await processor('knowledge-signal-cleanup')(job({}));
    expect(await su.knowledgeSignal.count()).toBe(1);
  });

  it('worker startup (runAsSystem) schedules every org’s routines', async () => {
    await seedRoutine({ schedule: '0 9 * * *', enabled: true });
    await seedRoutine({
      schedule: '0 10 * * *',
      enabled: true,
      orgId: fx.rival.orgId,
      userId: fx.users.rival.id,
    });

    // Before the fix: no context → the role sees no routines → nothing scheduled.
    await syncRoutineSchedules();
    expect(await routineQueue.getRepeatableJobs()).toHaveLength(0);

    await runAsSystem(() => syncRoutineSchedules());
    expect(await routineQueue.getRepeatableJobs()).toHaveLength(2);

    for (const j of await routineQueue.getRepeatableJobs()) {
      await routineQueue.removeRepeatableByKey(j.key);
    }
  });

  it('every captured worker processor runs in the bypass context', async () => {
    const seen = await withJobContext(async () =>
      prisma.$queryRawUnsafe<Array<{ b: string | null }>>(
        `SELECT current_setting('app.bypass_rls', true) AS b`,
      ),
    )();
    expect(seen[0].b).toBe('on');
  });
});

// ── 2b. Knowledge loop, Phase 3: the daily digest + reminder pass ─────────────

describe('daily digest / reminder pass under RLS (job context)', () => {
  const DAY = 86_400_000;

  /** A timezone whose local hour is 9 right now (Etc/GMT signs are inverted). */
  function tzAtNine(now: Date): string {
    let o = (9 - now.getUTCHours() + 24) % 24;
    if (o > 14) o -= 24;
    return o === 0 ? 'Etc/GMT' : o > 0 ? `Etc/GMT-${o}` : `Etc/GMT+${-o}`;
  }

  async function seedWaitingCards(now: Date) {
    for (const orgId of [fx.primary.orgId, fx.rival.orgId]) {
      await su.org.update({
        where: { id: orgId },
        data: { settings: { features: { knowledgeLoop: true } } },
      });
    }
    const card = async (orgId: string, content: string) => {
      const m = await su.memoryEntry.create({
        data: { orgId, layer: 'org', content, version: 1 },
      });
      return su.knowledgeProposal.create({
        data: {
          orgId,
          targetType: 'memory',
          targetId: m.id,
          targetScope: 'org',
          targetName: `Org memory: ${content}`,
          targetVersion: 1,
          before: content,
          after: `${content}!`,
          reason: 'r',
          availableAt: new Date(now.getTime() - 8 * DAY),
        },
      });
    };
    return {
      own: await card(fx.primary.orgId, 'Ours'),
      rival: await card(fx.rival.orgId, 'Theirs'),
    };
  }

  it('with no context the cards are invisible: nothing is sent, nothing marked', async () => {
    const now = new Date('2026-12-08T09:00:00Z');
    const { own } = await seedWaitingCards(now);
    await runDailyDigest({ now, activityDigest: async () => ({ summary: '', eventCount: 0 }) });
    expect(await su.notification.count()).toBe(0);
    expect(
      (await su.knowledgeProposal.findUniqueOrThrow({ where: { id: own.id } })).remindedAt,
    ).toBeNull();
  });

  it('inside withJobContext: one item per owner, own org only, reminder marked once', async () => {
    const now = new Date('2026-12-08T09:00:00Z');
    const { own, rival } = await seedWaitingCards(now);
    const run = withJobContext(() =>
      runDailyDigest({ now, activityDigest: async () => ({ summary: '', eventCount: 0 }) }),
    );
    await run();

    const adminNotes = await su.notification.findMany({ where: { userId: fx.users.admin.id } });
    expect(adminNotes).toHaveLength(1);
    expect(adminNotes[0]).toMatchObject({
      orgId: fx.primary.orgId,
      title: '1 proposal for Org memory: Ours',
    });
    expect(adminNotes[0].body).toContain('Waiting a week: Org memory: Ours');
    const rivalNotes = await su.notification.findMany({ where: { userId: fx.users.rival.id } });
    expect(rivalNotes).toHaveLength(1);
    expect(rivalNotes[0]).toMatchObject({
      orgId: fx.rival.orgId,
      title: '1 proposal for Org memory: Theirs',
    });
    for (const id of [own.id, rival.id]) {
      expect(
        (await su.knowledgeProposal.findUniqueOrThrow({ where: { id } })).remindedAt,
      ).not.toBeNull();
    }

    // The next day's pass: the count again, no second reminder.
    await withJobContext(() =>
      runDailyDigest({
        now: new Date(now.getTime() + DAY),
        activityDigest: async () => ({ summary: '', eventCount: 0 }),
      }),
    )();
    const again = await su.notification.findMany({
      where: { userId: fx.users.admin.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(again).toHaveLength(2);
    expect(again[1].body ?? '').not.toContain('Waiting a week');
  });

  it('the captured activity-digest worker processor delivers under the role', async () => {
    createActivityDigestWorker();
    const now = new Date();
    await seedWaitingCards(now);
    await su.user.update({
      where: { id: fx.users.admin.id },
      data: { preferences: { timezone: tzAtNine(now) } },
    });
    await processor('activity-digest')(job({}));
    const notes = await su.notification.findMany({ where: { userId: fx.users.admin.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('1 proposal for Org memory: Ours');
  });
});

// ── 3. Raw SQL carries the GUC ───────────────────────────────────────────────

describe('searchMemory / POST /memory/search under RLS', () => {
  const scopeOf = (role: 'member' | 'rival') => ({
    orgId: fx.users[role].orgId,
    userId: fx.users[role].id,
    teamId: role === 'member' ? fx.primary.teamId : fx.rival.teamId,
  });

  it('returns the org’s entries (FTS + vector) and never another org’s', async () => {
    const { own, ownUser, rival } = await seedMemory();
    const results = await runWithTenant(
      { orgId: fx.primary.orgId, userId: fx.users.member.id },
      () => searchMemory(scopeOf('member'), 'roadmap', { embedding: [0.1, 0.2, 0.3] }),
    );
    const ids = results.map((r: { id: string }) => r.id).sort();
    expect(ids).toEqual([own.id, ownUser.id].sort());
    expect(ids).not.toContain(rival.id);
  });

  it('RLS blocks a mis-scoped query: org A context asking for org B returns nothing', async () => {
    await seedMemory();
    const results = await runWithTenant(
      { orgId: fx.primary.orgId, userId: fx.users.member.id },
      () => searchMemory(scopeOf('rival'), 'roadmap', { embedding: [0.1, 0.2, 0.3] }),
    );
    expect(results).toEqual([]);
  });

  it('still works with an explicit tx (the curator path)', async () => {
    const { own, ownUser } = await seedMemory();
    const results = await withRlsBypass((tx) => searchMemory(scopeOf('member'), 'roadmap', { tx }));
    expect(results.map((r: { id: string }) => r.id).sort()).toEqual([own.id, ownUser.id].sort());
  });

  it('POST /memory/search returns the caller’s org entries only', async () => {
    const { own, rival } = await seedMemory();
    const member = await loginAgent('member');
    const res = await member.post('/api/v1/memory/search', { query: 'roadmap' });
    expect(res.status).toBe(200);
    const ids = res.body.data.map((r: { id: string }) => r.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(rival.id);

    const rivalAgent = await loginAgent('rival');
    const res2 = await rivalAgent.post('/api/v1/memory/search', { query: 'roadmap' });
    expect(res2.status).toBe(200);
    expect(res2.body.data.map((r: { id: string }) => r.id)).toEqual([rival.id]);
  });
});

describe('raw SQL tenant isolation under an org context', () => {
  const asPrimary = <T>(fn: () => Promise<T>) =>
    runWithTenant({ orgId: fx.primary.orgId, userId: fx.users.member.id }, fn);

  it('$queryRawUnsafe with no WHERE sees only the context org', async () => {
    await seedMemory();
    const rows = await asPrimary(() =>
      prisma.$queryRawUnsafe<Array<{ org_id: string }>>(`SELECT org_id FROM memory_entries`),
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.org_id))).toEqual(new Set([fx.primary.orgId]));
  });

  it('tagged-template $queryRaw sees only the context org', async () => {
    const { rival } = await seedMemory();
    const rows = await asPrimary(
      () =>
        prisma.$queryRaw<
          Array<{ id: string }>
        >`SELECT id FROM memory_entries WHERE id = ${rival.id}`,
    );
    expect(rows).toEqual([]);
    const all = await asPrimary(
      () =>
        prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM memory_entries`,
    );
    expect(Number(all[0].n)).toBe(2);
  });

  it('$executeRawUnsafe UPDATE touches only the context org’s rows', async () => {
    const { rival } = await seedMemory();
    const changed = await asPrimary(() =>
      prisma.$executeRawUnsafe(`UPDATE memory_entries SET content = 'overwritten'`),
    );
    expect(changed).toBe(2);
    const r = await su.memoryEntry.findUniqueOrThrow({ where: { id: rival.id } });
    expect(r.content).toBe('Rival roadmap secret strategy');
  });

  it('tagged-template $executeRaw can write a row into the context org', async () => {
    // Fails the RLS check with no GUC (the old pass-through behaviour).
    const n = await asPrimary(
      () => prisma.$executeRaw`
        INSERT INTO memory_entries (id, org_id, user_id, layer, content, updated_at)
        VALUES (gen_random_uuid(), ${fx.primary.orgId}, ${fx.users.member.id}, 'org', 'mine', now())`,
    );
    expect(n).toBe(1);
    expect(await su.memoryEntry.count({ where: { content: 'mine' } })).toBe(1);
  });

  it('tagged-template $executeRaw cannot write a row into another org', async () => {
    await expect(
      asPrimary(
        () => prisma.$executeRaw`
          INSERT INTO memory_entries (id, org_id, user_id, layer, content, updated_at)
          VALUES (gen_random_uuid(), ${fx.rival.orgId}, ${fx.users.rival.id}, 'org', 'smuggled', now())`,
      ),
    ).rejects.toThrow(/row-level security/i);
    expect(await su.memoryEntry.count({ where: { content: 'smuggled' } })).toBe(0);
  });

  it('a batch $transaction mixing a model op and $executeRaw works (chat demote path)', async () => {
    const task = await su.task.create({
      data: {
        orgId: fx.primary.orgId,
        userId: fx.users.member.id,
        title: 't',
        source: 'manual',
        status: 'backlog',
        context: {},
      },
    });
    const session = await su.chatSession.create({
      data: { orgId: fx.primary.orgId, userId: fx.users.member.id, title: 's' } as never,
    });
    const msg = await su.chatMessage.create({
      data: {
        orgId: fx.primary.orgId,
        sessionId: session.id,
        role: 'assistant',
        content: 'hi',
        producedTaskIds: [task.id],
      } as never,
    });
    await asPrimary(() =>
      prisma.$transaction([
        prisma.task.update({ where: { id: task.id }, data: { status: 'archived' } }),
        prisma.$executeRaw`
          UPDATE "chat_messages"
          SET "produced_task_ids" = array_remove("produced_task_ids", ${task.id})
          WHERE "id" = ${msg.id}`,
      ]),
    );
    expect((await su.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('archived');
    const m = await su.chatMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(m.producedTaskIds).toEqual([]);
  });
});

describe('explicit transactions are unchanged', () => {
  it('withTenantTx: raw on tx sees the org and rolls back with the tx', async () => {
    const { own } = await seedMemory();
    await expect(
      runWithTenant({ orgId: fx.primary.orgId, userId: fx.users.member.id }, () =>
        withTenantTx(async (tx) => {
          const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id FROM memory_entries WHERE layer = 'org'`,
          );
          expect(rows.map((r) => r.id)).toEqual([own.id]);
          await tx.$executeRawUnsafe(
            `UPDATE memory_entries SET content = 'rolled back' WHERE id = $1`,
            own.id,
          );
          // A model op on tx in the same transaction sees the write.
          const e = await tx.memoryEntry.findUniqueOrThrow({ where: { id: own.id } });
          expect(e.content).toBe('rolled back');
          throw new Error('abort');
        }),
      ),
    ).rejects.toThrow('abort');
    const after = await su.memoryEntry.findUniqueOrThrow({ where: { id: own.id } });
    expect(after.content).toBe('Quarterly roadmap planning notes');
  });

  it('withRlsBypass inside a job context: raw on tx sees every org', async () => {
    await seedMemory();
    const n = await withJobContext(() =>
      withRlsBypass(async (tx) => {
        const [r] = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*)::bigint AS n FROM memory_entries`,
        );
        return Number(r.n);
      }),
    )();
    expect(n).toBe(3);
  });

  it('withTenantTx: a model op on tx sees only the context org', async () => {
    await seedMemory();
    const rows = await runWithTenant({ orgId: fx.primary.orgId, userId: fx.users.member.id }, () =>
      withTenantTx((tx) => tx.memoryEntry.findMany()),
    );
    expect(rows).toHaveLength(2);
  });
});

// ── 4. Socket.io handlers run in the socket user's org context ───────────────

describe('Socket.io handlers under RLS (real client, session cookie)', () => {
  let baseUrl = '';
  const clients: ClientSocket[] = [];

  async function ensureListening() {
    if (!httpServer.listening) {
      await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', () => r()));
    }
    baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  }

  async function connectAs(email: string): Promise<ClientSocket> {
    await ensureListening();
    const res = await request(httpServer)
      .post('/api/v1/auth/login')
      .send({ email, password: fx.password });
    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');
    const socket = ioClient(baseUrl, {
      path: '/ws',
      transports: ['websocket'],
      extraHeaders: { cookie },
      reconnection: false,
    });
    clients.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return socket;
  }

  /** Emit and wait for the first of: a server 'error', or `okEvent`. */
  function outcome(socket: ClientSocket, okEvent: string, emit: () => void) {
    return new Promise<{ ok: true; payload: unknown } | { ok: false; message: string }>(
      (resolve) => {
        const onErr = (e: { message: string }) => {
          socket.off(okEvent, onOk);
          resolve({ ok: false, message: e.message });
        };
        const onOk = (payload: unknown) => {
          socket.off('error', onErr);
          resolve({ ok: true, payload });
        };
        socket.once('error', onErr);
        socket.once(okEvent, onOk);
        emit();
      },
    );
  }

  async function seedSessionAndTask(orgId: string, userId: string) {
    const session = await su.chatSession.create({ data: { orgId, userId, title: 's' } });
    const task = await su.task.create({
      data: { orgId, userId, title: 't', source: 'manual', status: 'backlog', context: {} },
    });
    return { session, task };
  }

  afterAll(async () => {
    for (const c of clients) c.disconnect();
    if (httpServer.listening) await new Promise((r) => httpServer.close(() => r(null)));
  });

  it('join:session — own org’s session joins; a rival org’s session is denied', async () => {
    const own = await seedSessionAndTask(fx.primary.orgId, fx.users.member.id);
    const rival = await seedSessionAndTask(fx.rival.orgId, fx.users.rival.id);
    const socket = await connectAs(fx.users.member.email);

    const joined = await outcome(socket, 'presence:list', () =>
      socket.emit('join:session', own.session.id),
    );
    expect(joined).toMatchObject({ ok: true });

    const denied = await outcome(socket, 'presence:list', () =>
      socket.emit('join:session', rival.session.id),
    );
    expect(denied).toEqual({ ok: false, message: 'Session not found' });
  });

  it('join:task — own task joins (receives task events); a rival org’s task is denied', async () => {
    const own = await seedSessionAndTask(fx.primary.orgId, fx.users.member.id);
    const rival = await seedSessionAndTask(fx.rival.orgId, fx.users.rival.id);
    const socket = await connectAs(fx.users.member.email);

    // A successful join emits nothing; prove membership by receiving a room event.
    socket.emit('join:task', own.task.id);
    const got = await new Promise<unknown>((resolve, reject) => {
      socket.once('error', (e: { message: string }) => reject(new Error(e.message)));
      socket.once('task:event', resolve);
      const ping = setInterval(() => emitToTask(own.task.id, { type: 'ping' }), 25);
      socket.once('task:event', () => clearInterval(ping));
    });
    expect(got).toEqual({ type: 'ping' });

    const denied = await outcome(socket, 'task:event', () =>
      socket.emit('join:task', rival.task.id),
    );
    expect(denied).toEqual({ ok: false, message: 'Task not found' });
  });

  it('the rival user cannot join the primary org’s task either', async () => {
    const own = await seedSessionAndTask(fx.primary.orgId, fx.users.member.id);
    const socket = await connectAs(fx.users.rival.email);
    const denied = await outcome(socket, 'task:event', () => socket.emit('join:task', own.task.id));
    expect(denied).toEqual({ ok: false, message: 'Task not found' });
  });
});

describe('Phase 4 dry runs and routine test cases under RLS (request context)', () => {
  async function setup() {
    await su.org.update({
      where: { id: fx.primary.orgId },
      data: { settings: { features: { knowledgeLoop: true } } },
    });
    const routine = await seedRoutine({
      scope: 'team',
      teamId: fx.primary.teamId,
      prompt: 'Summarise tickets from the Support queue.',
    });
    await su.routineRun.create({
      data: {
        routineId: routine.id,
        status: 'success',
        output: { result: 'Old output' },
        completedAt: new Date(),
      },
    });
    return routine;
  }

  it('the detached dry run keeps the request’s tenant context and writes only its own row', async () => {
    const routine = await setup();
    const lead = await loginAgent('lead');
    const start = await lead.post(`/api/v1/routines/${routine.id}/dry-run`, {});
    expect(start.status).toBe(202);
    await dryRunSettled(start.body.data.id);
    const done = await lead.get(`/api/v1/routines/${routine.id}/dry-runs/${start.body.data.id}`);
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({
      status: 'success',
      output: 'All done.',
      lastOutput: 'Old output',
    });
    expect(rls.prompts).toEqual(['Summarise tickets from the Support queue.']);
    const row = await su.routineDryRun.findUniqueOrThrow({ where: { id: start.body.data.id } });
    expect(row.orgId).toBe(fx.primary.orgId);
    expect(await su.routineRun.count({ where: { routineId: routine.id } })).toBe(1);
  });

  it('test cases: create, the guard, Run tests and an approval that makes a case', async () => {
    const routine = await setup();
    const lead = await loginAgent('lead');
    const created = await lead.post(`/api/v1/routines/${routine.id}/test-cases`, {
      description: 'Keeps the queue',
      mustContain: ['Support queue'],
    });
    expect(created.status).toBe(201);
    const blocked = await lead.patch(`/api/v1/routines/${routine.id}`, { prompt: 'Summarise.' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('tests_failed');

    const run = await lead.post(`/api/v1/routines/${routine.id}/test-cases/run`, {});
    expect(run.status).toBe(202);
    await dryRunSettled(run.body.data.id);
    const tc = await su.routineTestCase.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(tc.lastStatus).toBe('failed'); // "All done." has no "Support queue"

    const fresh = await su.routine.findUniqueOrThrow({ where: { id: routine.id } });
    const p = await su.knowledgeProposal.create({
      data: {
        orgId: fx.primary.orgId,
        targetType: 'routine',
        targetId: routine.id,
        targetScope: 'team',
        targetTeamId: fx.primary.teamId,
        targetUserId: fx.users.lead.id,
        targetName: 'Morning digest',
        targetVersion: fresh.version,
        before: fresh.prompt,
        after: `${fresh.prompt} Group by priority.`,
        reason: 'r',
        availableAt: new Date(Date.now() - 1000),
      },
    });
    expect((await lead.post(`/api/v1/knowledge/proposals/${p.id}/approve`, {})).status).toBe(200);
    const made = await su.routineTestCase.findFirst({ where: { proposalId: p.id } });
    expect(made?.mustContain).toEqual(['Group by priority']);
    expect(made?.orgId).toBe(fx.primary.orgId);
  });

  it('a rival org cannot see the routine, its cases or its dry runs', async () => {
    const routine = await setup();
    const rival = await loginAgent('rival');
    expect((await rival.get(`/api/v1/routines/${routine.id}/test-cases`)).status).toBe(404);
    expect((await rival.post(`/api/v1/routines/${routine.id}/dry-run`, {})).status).toBe(404);
  });
});
