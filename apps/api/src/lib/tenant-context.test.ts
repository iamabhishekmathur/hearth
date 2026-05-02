/**
 * Tenant isolation integration tests.
 *
 * These tests verify that Postgres Row-Level Security correctly blocks
 * cross-tenant reads/writes on every tenant-scoped table. They run
 * against a real Postgres database — there's no way to verify RLS
 * behavior without one.
 *
 * Setup:
 *   1. Create a separate test database:
 *        createdb hearth_test
 *   2. Apply migrations:
 *        DATABASE_URL=postgresql://hearth:hearth@localhost:5432/hearth_test \
 *          pnpm --filter @hearth/api exec prisma migrate deploy
 *   3. Run tests:
 *        DATABASE_URL_TEST=postgresql://hearth:hearth@localhost:5432/hearth_test \
 *          pnpm --filter @hearth/api test src/lib/tenant-context.test.ts
 *
 * If DATABASE_URL_TEST is not set, the tests skip with a clear message.
 *
 * The test database is wiped between test runs — never point this at a
 * database with real data.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { runWithTenant, withTenantTx, withRlsBypass } from './tenant-context.js';
import { applyTenantExtension } from './prisma-tenant-extension.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL_TEST;

describe.skipIf(!TEST_DATABASE_URL)('tenant isolation (RLS)', () => {
  let testPrisma: PrismaClient;

  // Two seeded orgs we'll use across tests
  let orgA: { id: string; teamId: string; userId: string };
  let orgB: { id: string; teamId: string; userId: string };

  beforeAll(async () => {
    testPrisma = new PrismaClient({
      datasources: { db: { url: TEST_DATABASE_URL! } },
    });
    await testPrisma.$connect();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  beforeEach(async () => {
    // Wipe everything (with bypass since RLS is on). Order matters because
    // of foreign keys. This is a test fixture; do NOT replicate this pattern
    // in app code.
    await testPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_rls = 'on'`);
      await tx.$executeRawUnsafe(`TRUNCATE TABLE
        task_reviews, task_execution_steps, task_comments, task_context_items,
        task_suggestions, tasks,
        message_reactions, session_reads, session_collaborators, session_shares,
        chat_attachments, chat_messages, chat_sessions,
        artifact_versions, artifacts,
        user_skills, skills,
        notifications, pipeline_runs,
        users, teams, orgs
        RESTART IDENTITY CASCADE`);
    });

    // Seed two isolated orgs
    orgA = await seedOrg(testPrisma, 'Org A');
    orgB = await seedOrg(testPrisma, 'Org B');
  });

  // ── 1. The basics: GUC must be set to see anything ─────────────────

  it('returns zero rows when no app.org_id GUC is set', async () => {
    // Insert a task into org A using bypass
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      await tx.task.create({
        data: {
          orgId: orgA.id,
          userId: orgA.userId,
          title: 'A-task-1',
          source: 'manual',
        },
      });
    });

    // Query without a GUC — should see nothing
    const tasks = await testPrisma.task.findMany();
    expect(tasks).toHaveLength(0);
  });

  it('returns only the current org rows when app.org_id is set', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      await tx.task.create({
        data: { orgId: orgA.id, userId: orgA.userId, title: 'A-task', source: 'manual' },
      });
      await tx.task.create({
        data: { orgId: orgB.id, userId: orgB.userId, title: 'B-task', source: 'manual' },
      });
    });

    // Pretend to be org A
    await testPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${orgA.id}'`);
      const tasks = await tx.task.findMany();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('A-task');
    });

    // Pretend to be org B
    await testPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${orgB.id}'`);
      const tasks = await tx.task.findMany();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('B-task');
    });
  });

  // ── 2. WITH CHECK blocks cross-tenant inserts ─────────────────────────

  it('blocks inserting a row with a different orgId than the GUC', async () => {
    await expect(
      testPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${orgA.id}'`);
        return tx.task.create({
          data: {
            orgId: orgB.id, // wrong org
            userId: orgA.userId,
            title: 'sneaky',
            source: 'manual',
          },
        });
      }),
    ).rejects.toThrow();
  });

  // ── 3. Updates and deletes are also scoped ────────────────────────────

  it('cannot UPDATE a row in another org via RLS', async () => {
    let bId: string;
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      const b = await tx.task.create({
        data: { orgId: orgB.id, userId: orgB.userId, title: 'B-original', source: 'manual' },
      });
      bId = b.id;
    });

    // Org A tries to update org B's task — affects 0 rows because the WHERE
    // clause is invisible to org A.
    const updated = await testPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${orgA.id}'`);
      return tx.task.updateMany({
        where: { id: bId },
        data: { title: 'pwned' },
      });
    });
    expect(updated.count).toBe(0);

    // Verify org B's task is untouched
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      const t = await tx.task.findUnique({ where: { id: bId } });
      expect(t?.title).toBe('B-original');
    });
  });

  it('cannot DELETE a row in another org via RLS', async () => {
    let bId: string;
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      const b = await tx.task.create({
        data: { orgId: orgB.id, userId: orgB.userId, title: 'B', source: 'manual' },
      });
      bId = b.id;
    });

    const deleted = await testPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${orgA.id}'`);
      return tx.task.deleteMany({ where: { id: bId } });
    });
    expect(deleted.count).toBe(0);

    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      const t = await tx.task.findUnique({ where: { id: bId } });
      expect(t).not.toBeNull();
    });
  });

  // ── 4. Bypass restores full visibility ────────────────────────────────

  it('app.bypass_rls = on returns all orgs rows', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      await tx.task.create({
        data: { orgId: orgA.id, userId: orgA.userId, title: 'A', source: 'manual' },
      });
      await tx.task.create({
        data: { orgId: orgB.id, userId: orgB.userId, title: 'B', source: 'manual' },
      });
    });

    const all = await testPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_rls = 'on'`);
      return tx.task.findMany();
    });
    expect(all).toHaveLength(2);
  });

  // ── 5. Indirect tables (RoutineRun → Routine) inherit the parent's RLS ──

  it('routine_runs is invisible across orgs (indirect via routines)', async () => {
    let bRunId: string;
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      const routine = await tx.routine.create({
        data: {
          orgId: orgB.id,
          userId: orgB.userId,
          name: 'B-routine',
          prompt: 'do work',
          schedule: '@daily',
          delivery: {},
        },
      });
      const run = await tx.routineRun.create({
        data: { routineId: routine.id, status: 'running' },
      });
      bRunId = run.id;
    });

    // Org A can't see the run
    const runs = await testPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${orgA.id}'`);
      return tx.routineRun.findMany();
    });
    expect(runs).toHaveLength(0);
    expect(runs.find((r) => r.id === bRunId)).toBeUndefined();
  });

  // ── 6. The tenant-context wrapper integrates correctly ────────────────

  it('withTenantTx() reads from AsyncLocalStorage and scopes correctly', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      await tx.task.create({
        data: { orgId: orgA.id, userId: orgA.userId, title: 'A', source: 'manual' },
      });
      await tx.task.create({
        data: { orgId: orgB.id, userId: orgB.userId, title: 'B', source: 'manual' },
      });
    });

    const aTasks = await runWithTenant(
      { orgId: orgA.id, userId: orgA.userId },
      () =>
        withTenantTx((tx) => tx.task.findMany()),
    );
    expect(aTasks).toHaveLength(1);
    expect(aTasks[0].title).toBe('A');

    const bTasks = await runWithTenant(
      { orgId: orgB.id, userId: orgB.userId },
      () =>
        withTenantTx((tx) => tx.task.findMany()),
    );
    expect(bTasks).toHaveLength(1);
    expect(bTasks[0].title).toBe('B');
  });

  it('withRlsBypass() returns all rows regardless of context', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      await tx.task.create({
        data: { orgId: orgA.id, userId: orgA.userId, title: 'A', source: 'manual' },
      });
      await tx.task.create({
        data: { orgId: orgB.id, userId: orgB.userId, title: 'B', source: 'manual' },
      });
    });

    const all = await runWithTenant(
      { orgId: orgA.id, userId: orgA.userId },
      () => withRlsBypass((tx) => tx.task.findMany()),
    );
    expect(all).toHaveLength(2);
  });

  // ── 7. Per-direct-tenant-table isolation ──────────────────────────────
  //
  // For each tenant-owned table, verify that org A's rows are invisible to
  // org B. We don't repeat all the ceremony from sections 1-3 — those test
  // the mechanism. Here we just confirm each table is wired into RLS.

  it('chat_sessions: org isolation', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      await tx.chatSession.create({ data: { orgId: orgA.id, userId: orgA.userId, title: 'A-session' } });
      await tx.chatSession.create({ data: { orgId: orgB.id, userId: orgB.userId, title: 'B-session' } });
    });
    const sessions = await scopedFindMany(testPrisma, orgA.id, 'chatSession');
    expect(sessions).toHaveLength(1);
    expect((sessions[0] as { title: string }).title).toBe('A-session');
  });

  it('chat_messages: org isolation', async () => {
    let aSession = '';
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      const a = await tx.chatSession.create({ data: { orgId: orgA.id, userId: orgA.userId } });
      const b = await tx.chatSession.create({ data: { orgId: orgB.id, userId: orgB.userId } });
      aSession = a.id;
      await tx.chatMessage.create({ data: { orgId: orgA.id, sessionId: a.id, role: 'user', content: 'hello-A' } });
      await tx.chatMessage.create({ data: { orgId: orgB.id, sessionId: b.id, role: 'user', content: 'hello-B' } });
    });
    const msgs = await scopedFindMany(testPrisma, orgA.id, 'chatMessage');
    expect(msgs).toHaveLength(1);
    expect((msgs[0] as { sessionId: string }).sessionId).toBe(aSession);
  });

  it('artifacts: org isolation', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      const aSess = await tx.chatSession.create({ data: { orgId: orgA.id, userId: orgA.userId } });
      const bSess = await tx.chatSession.create({ data: { orgId: orgB.id, userId: orgB.userId } });
      await tx.artifact.create({
        data: { orgId: orgA.id, sessionId: aSess.id, type: 'document', title: 'A-art', content: 'x', createdBy: orgA.userId },
      });
      await tx.artifact.create({
        data: { orgId: orgB.id, sessionId: bSess.id, type: 'document', title: 'B-art', content: 'y', createdBy: orgB.userId },
      });
    });
    const artifacts = await scopedFindMany(testPrisma, orgA.id, 'artifact');
    expect(artifacts).toHaveLength(1);
    expect((artifacts[0] as { title: string }).title).toBe('A-art');
  });

  it('skills: org isolation', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      await tx.skill.create({
        data: { orgId: orgA.id, authorId: orgA.userId, name: 'A-skill', description: 'a', content: '# a', scope: 'org' },
      });
      await tx.skill.create({
        data: { orgId: orgB.id, authorId: orgB.userId, name: 'B-skill', description: 'b', content: '# b', scope: 'org' },
      });
    });
    const skills = await scopedFindMany(testPrisma, orgA.id, 'skill');
    expect(skills).toHaveLength(1);
    expect((skills[0] as { name: string }).name).toBe('A-skill');
  });

  it('routines: org isolation', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      await tx.routine.create({
        data: { orgId: orgA.id, userId: orgA.userId, name: 'A-routine', prompt: 'do', schedule: '@daily', delivery: {} },
      });
      await tx.routine.create({
        data: { orgId: orgB.id, userId: orgB.userId, name: 'B-routine', prompt: 'do', schedule: '@daily', delivery: {} },
      });
    });
    const routines = await scopedFindMany(testPrisma, orgA.id, 'routine');
    expect(routines).toHaveLength(1);
    expect((routines[0] as { name: string }).name).toBe('A-routine');
  });

  it('audit_logs: org isolation', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      await tx.auditLog.create({
        data: { orgId: orgA.id, userId: orgA.userId, action: 'A-action', details: {} },
      });
      await tx.auditLog.create({
        data: { orgId: orgB.id, userId: orgB.userId, action: 'B-action', details: {} },
      });
    });
    const logs = await scopedFindMany(testPrisma, orgA.id, 'auditLog');
    expect(logs).toHaveLength(1);
    expect((logs[0] as { action: string }).action).toBe('A-action');
  });

  it('notifications: org isolation', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      await tx.notification.create({
        data: { orgId: orgA.id, userId: orgA.userId, type: 'mention', title: 'A-notif' },
      });
      await tx.notification.create({
        data: { orgId: orgB.id, userId: orgB.userId, type: 'mention', title: 'B-notif' },
      });
    });
    const notifs = await scopedFindMany(testPrisma, orgA.id, 'notification');
    expect(notifs).toHaveLength(1);
    expect((notifs[0] as { title: string }).title).toBe('A-notif');
  });

  it('user_skills: org isolation', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      const aSkill = await tx.skill.create({
        data: { orgId: orgA.id, authorId: orgA.userId, name: 'A-skill', description: 'a', content: '# a', scope: 'org' },
      });
      const bSkill = await tx.skill.create({
        data: { orgId: orgB.id, authorId: orgB.userId, name: 'B-skill', description: 'b', content: '# b', scope: 'org' },
      });
      await tx.userSkill.create({ data: { orgId: orgA.id, userId: orgA.userId, skillId: aSkill.id } });
      await tx.userSkill.create({ data: { orgId: orgB.id, userId: orgB.userId, skillId: bSkill.id } });
    });
    const installed = await scopedFindMany(testPrisma, orgA.id, 'userSkill');
    expect(installed).toHaveLength(1);
    expect((installed[0] as { userId: string }).userId).toBe(orgA.userId);
  });

  it('task_context_items: org isolation', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      const aTask = await tx.task.create({
        data: { orgId: orgA.id, userId: orgA.userId, title: 'A-task', source: 'manual' },
      });
      const bTask = await tx.task.create({
        data: { orgId: orgB.id, userId: orgB.userId, title: 'B-task', source: 'manual' },
      });
      await tx.taskContextItem.create({
        data: { orgId: orgA.id, taskId: aTask.id, type: 'note', rawValue: 'A-note', createdBy: orgA.userId },
      });
      await tx.taskContextItem.create({
        data: { orgId: orgB.id, taskId: bTask.id, type: 'note', rawValue: 'B-note', createdBy: orgB.userId },
      });
    });
    const items = await scopedFindMany(testPrisma, orgA.id, 'taskContextItem');
    expect(items).toHaveLength(1);
    expect((items[0] as { rawValue: string }).rawValue).toBe('A-note');
  });

  it('task_comments: org isolation', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      const aTask = await tx.task.create({
        data: { orgId: orgA.id, userId: orgA.userId, title: 'A-task', source: 'manual' },
      });
      const bTask = await tx.task.create({
        data: { orgId: orgB.id, userId: orgB.userId, title: 'B-task', source: 'manual' },
      });
      await tx.taskComment.create({ data: { orgId: orgA.id, taskId: aTask.id, userId: orgA.userId, content: 'A-comment' } });
      await tx.taskComment.create({ data: { orgId: orgB.id, taskId: bTask.id, userId: orgB.userId, content: 'B-comment' } });
    });
    const comments = await scopedFindMany(testPrisma, orgA.id, 'taskComment');
    expect(comments).toHaveLength(1);
    expect((comments[0] as { content: string }).content).toBe('A-comment');
  });

  it('task_execution_steps: org isolation', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      const aTask = await tx.task.create({
        data: { orgId: orgA.id, userId: orgA.userId, title: 'A-task', source: 'manual' },
      });
      const bTask = await tx.task.create({
        data: { orgId: orgB.id, userId: orgB.userId, title: 'B-task', source: 'manual' },
      });
      await tx.taskExecutionStep.create({
        data: { orgId: orgA.id, taskId: aTask.id, stepNumber: 1, description: 'A-step' },
      });
      await tx.taskExecutionStep.create({
        data: { orgId: orgB.id, taskId: bTask.id, stepNumber: 1, description: 'B-step' },
      });
    });
    const steps = await scopedFindMany(testPrisma, orgA.id, 'taskExecutionStep');
    expect(steps).toHaveLength(1);
    expect((steps[0] as { description: string }).description).toBe('A-step');
  });

  it('memory_entries: org isolation', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      await tx.memoryEntry.create({
        data: { orgId: orgA.id, layer: 'org', content: 'A-memory' },
      });
      await tx.memoryEntry.create({
        data: { orgId: orgB.id, layer: 'org', content: 'B-memory' },
      });
    });
    const memories = await scopedFindMany(testPrisma, orgA.id, 'memoryEntry');
    expect(memories).toHaveLength(1);
    expect((memories[0] as { content: string }).content).toBe('A-memory');
  });

  // ── 8. Indirect tenant tables (more than just routine_runs) ────────────

  it('approval_requests: invisible across orgs (via routine → routine_run)', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      const aRoutine = await tx.routine.create({
        data: { orgId: orgA.id, userId: orgA.userId, name: 'A', prompt: 'p', schedule: '@daily', delivery: {} },
      });
      const bRoutine = await tx.routine.create({
        data: { orgId: orgB.id, userId: orgB.userId, name: 'B', prompt: 'p', schedule: '@daily', delivery: {} },
      });
      const aCp = await tx.approvalCheckpoint.create({
        data: { routineId: aRoutine.id, name: 'cp-A', position: 1 },
      });
      const bCp = await tx.approvalCheckpoint.create({
        data: { routineId: bRoutine.id, name: 'cp-B', position: 1 },
      });
      const aRun = await tx.routineRun.create({ data: { routineId: aRoutine.id, status: 'awaiting_approval' } });
      const bRun = await tx.routineRun.create({ data: { routineId: bRoutine.id, status: 'awaiting_approval' } });
      await tx.approvalRequest.create({ data: { runId: aRun.id, checkpointId: aCp.id, status: 'pending' } });
      await tx.approvalRequest.create({ data: { runId: bRun.id, checkpointId: bCp.id, status: 'pending' } });
    });
    const reqs = await scopedFindMany(testPrisma, orgA.id, 'approvalRequest');
    expect(reqs).toHaveLength(1);
  });

  it('routine_triggers: invisible across orgs (via routine)', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      const aRoutine = await tx.routine.create({
        data: { orgId: orgA.id, userId: orgA.userId, name: 'A', prompt: 'p', schedule: '@daily', delivery: {} },
      });
      const bRoutine = await tx.routine.create({
        data: { orgId: orgB.id, userId: orgB.userId, name: 'B', prompt: 'p', schedule: '@daily', delivery: {} },
      });
      const aWebhook = await tx.webhookEndpoint.create({
        data: { orgId: orgA.id, provider: 'github', secret: 'sa', urlToken: 'tok-a-' + Math.random() },
      });
      const bWebhook = await tx.webhookEndpoint.create({
        data: { orgId: orgB.id, provider: 'github', secret: 'sb', urlToken: 'tok-b-' + Math.random() },
      });
      await tx.routineTrigger.create({
        data: { routineId: aRoutine.id, webhookEndpointId: aWebhook.id, eventType: 'push' },
      });
      await tx.routineTrigger.create({
        data: { routineId: bRoutine.id, webhookEndpointId: bWebhook.id, eventType: 'push' },
      });
    });
    const triggers = await scopedFindMany(testPrisma, orgA.id, 'routineTrigger');
    expect(triggers).toHaveLength(1);
  });

  // ── 9. Edge cases ──────────────────────────────────────────────────────

  it('switching tenant context mid-test scopes each query correctly', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      await tx.task.create({ data: { orgId: orgA.id, userId: orgA.userId, title: 'A1', source: 'manual' } });
      await tx.task.create({ data: { orgId: orgA.id, userId: orgA.userId, title: 'A2', source: 'manual' } });
      await tx.task.create({ data: { orgId: orgB.id, userId: orgB.userId, title: 'B1', source: 'manual' } });
    });

    const a1 = await runWithTenant({ orgId: orgA.id, userId: orgA.userId }, () =>
      withTenantTx((tx) => tx.task.findMany()),
    );
    const b = await runWithTenant({ orgId: orgB.id, userId: orgB.userId }, () =>
      withTenantTx((tx) => tx.task.findMany()),
    );
    const a2 = await runWithTenant({ orgId: orgA.id, userId: orgA.userId }, () =>
      withTenantTx((tx) => tx.task.findMany()),
    );

    expect(a1).toHaveLength(2);
    expect(b).toHaveLength(1);
    expect(a2).toHaveLength(2);
  });

  it('withTenantTx() throws when no tenant context is active', async () => {
    await expect(withTenantTx((tx) => tx.task.findMany())).rejects.toThrow(
      /tenant context/i,
    );
  });

  it('withTenantTx() with bypass=true returns all rows', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      await tx.task.create({ data: { orgId: orgA.id, userId: orgA.userId, title: 'A', source: 'manual' } });
      await tx.task.create({ data: { orgId: orgB.id, userId: orgB.userId, title: 'B', source: 'manual' } });
    });
    const all = await runWithTenant(
      { orgId: null, userId: null, bypass: true },
      () => withTenantTx((tx) => tx.task.findMany()),
    );
    expect(all).toHaveLength(2);
  });

  it('malformed orgId in tenant context is rejected before reaching SQL', async () => {
    await expect(
      runWithTenant(
        { orgId: "'; DROP TABLE tasks; --", userId: 'x' },
        () => withTenantTx((tx) => tx.task.findMany()),
      ),
    ).rejects.toThrow(/invalid orgid/i);
  });

  it('transaction rollback on error preserves no data', async () => {
    await expect(
      runWithTenant({ orgId: orgA.id, userId: orgA.userId }, () =>
        withTenantTx(async (tx) => {
          await tx.task.create({
            data: { orgId: orgA.id, userId: orgA.userId, title: 'should-roll-back', source: 'manual' },
          });
          throw new Error('boom');
        }),
      ),
    ).rejects.toThrow(/boom/);

    // Verify the task was rolled back
    const tasks = await runWithTenant({ orgId: orgA.id, userId: orgA.userId }, () =>
      withTenantTx((tx) => tx.task.findMany()),
    );
    expect(tasks).toHaveLength(0);
  });

  // ── 10. Prisma extension behavior ──────────────────────────────────────

  it('bare prisma.x.findMany() with active context filters by RLS', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      await tx.task.create({ data: { orgId: orgA.id, userId: orgA.userId, title: 'A', source: 'manual' } });
      await tx.task.create({ data: { orgId: orgB.id, userId: orgB.userId, title: 'B', source: 'manual' } });
    });

    // Use a fresh client wired with the same extension (mimicking the
    // singleton import path used by services). The extension auto-wraps
    // every operation in a tx with the GUC set.
    const extendedClient = applyTenantExtension(testPrisma);

    const aTasks = await runWithTenant({ orgId: orgA.id, userId: orgA.userId }, async () => {
      return extendedClient.task.findMany();
    });
    expect(aTasks).toHaveLength(1);
    expect(aTasks[0].title).toBe('A');
  });

  it('nested withTenantTx() inside a parent context still scopes correctly', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      await tx.task.create({ data: { orgId: orgA.id, userId: orgA.userId, title: 'A', source: 'manual' } });
      await tx.task.create({ data: { orgId: orgB.id, userId: orgB.userId, title: 'B', source: 'manual' } });
    });

    const result = await runWithTenant({ orgId: orgA.id, userId: orgA.userId }, async () => {
      const outer = await withTenantTx((tx) => tx.task.findMany());
      const inner = await withTenantTx((tx) => tx.task.count());
      return { outer, inner };
    });
    expect(result.outer).toHaveLength(1);
    expect(result.inner).toBe(1);
  });

  // ── 11. Realistic scenarios ────────────────────────────────────────────

  it('cannot install a skill from another org (cross-tenant insert blocked)', async () => {
    let bSkillId: string;
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      const bSkill = await tx.skill.create({
        data: { orgId: orgB.id, authorId: orgB.userId, name: 'B-skill', description: 'b', content: '# b', scope: 'org' },
      });
      bSkillId = bSkill.id;
    });

    // Org A user tries to install org B's skill, claiming it's in org A:
    // RLS WITH CHECK rejects because user_skills.org_id != current GUC, but
    // even if they used orgB's id, the skill itself is invisible to them.
    await expect(
      runWithTenant({ orgId: orgA.id, userId: orgA.userId }, () =>
        withTenantTx((tx) =>
          tx.userSkill.create({
            data: { orgId: orgB.id, userId: orgA.userId, skillId: bSkillId },
          }),
        ),
      ),
    ).rejects.toThrow();
  });

  it('chat session in other org is invisible even when looked up by id', async () => {
    let bSession: string;
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      const b = await tx.chatSession.create({
        data: { orgId: orgB.id, userId: orgB.userId, title: 'B-private' },
      });
      bSession = b.id;
    });

    const found = await runWithTenant({ orgId: orgA.id, userId: orgA.userId }, () =>
      withTenantTx((tx) => tx.chatSession.findUnique({ where: { id: bSession } })),
    );
    expect(found).toBeNull();
  });

  it('count() respects RLS', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      for (let i = 0; i < 5; i++) {
        await tx.task.create({ data: { orgId: orgA.id, userId: orgA.userId, title: `A-${i}`, source: 'manual' } });
      }
      for (let i = 0; i < 3; i++) {
        await tx.task.create({ data: { orgId: orgB.id, userId: orgB.userId, title: `B-${i}`, source: 'manual' } });
      }
    });

    const aCount = await runWithTenant({ orgId: orgA.id, userId: orgA.userId }, () =>
      withTenantTx((tx) => tx.task.count()),
    );
    const bCount = await runWithTenant({ orgId: orgB.id, userId: orgB.userId }, () =>
      withTenantTx((tx) => tx.task.count()),
    );
    expect(aCount).toBe(5);
    expect(bCount).toBe(3);
  });

  it('deleting an org cascades and cleans up all tenant rows', async () => {
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      await tx.task.create({ data: { orgId: orgA.id, userId: orgA.userId, title: 'A1', source: 'manual' } });
      await tx.task.create({ data: { orgId: orgA.id, userId: orgA.userId, title: 'A2', source: 'manual' } });
      await tx.chatSession.create({ data: { orgId: orgA.id, userId: orgA.userId } });
    });

    // Hard-delete org A (must use bypass — admin op).
    //
    // The schema has org→team and team→user as default RESTRICT, so we have
    // to walk the deletion ourselves: detach users → delete teams → delete
    // tenant-scoped tables that don't cascade from org → delete the org.
    // Production org-deletion logic will live in cloud/api/admin and follow
    // the same shape with proper auditing.
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      await tx.user.update({ where: { id: orgA.userId }, data: { teamId: null } });
      await tx.team.deleteMany({ where: { orgId: orgA.id } });
      await tx.org.delete({ where: { id: orgA.id } });
    });

    // org A's tasks and sessions should be gone (cascade from org delete)
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      const tasks = await tx.task.findMany({ where: { orgId: orgA.id } });
      const sessions = await tx.chatSession.findMany({ where: { orgId: orgA.id } });
      expect(tasks).toHaveLength(0);
      expect(sessions).toHaveLength(0);
    });

    // org B's data is untouched
    await withRlsBypassOnPrisma(testPrisma, async (tx) => {
      const bOrg = await tx.org.findUnique({ where: { id: orgB.id } });
      expect(bOrg).not.toBeNull();
    });
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────

async function seedOrg(prisma: PrismaClient, name: string) {
  return withRlsBypassOnPrisma(prisma, async (tx) => {
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    const org = await tx.org.create({ data: { name, slug } });
    const team = await tx.team.create({ data: { name: `${name} Team`, orgId: org.id } });
    const user = await tx.user.create({
      data: {
        email: `${slug}@example.com`,
        name: `${name} User`,
        teamId: team.id,
      },
    });
    return { id: org.id, teamId: team.id, userId: user.id };
  });
}

/**
 * Inline bypass helper that operates on a specific PrismaClient. Different
 * from `withRlsBypass()` in tenant-context.ts (which uses the singleton
 * `prisma` import) — tests use their own client pointed at the test DB.
 *
 * The callback receives a tx client; bypass only applies to operations
 * performed via that tx, so the caller MUST use it (not the outer client).
 */
async function withRlsBypassOnPrisma<T>(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.bypass_rls = 'on'`);
    return fn(tx);
  });
}

/**
 * Lightweight helper for the per-table isolation tests: opens a transaction
 * with `app.org_id` set, then calls findMany() on the given model. Returns
 * the rows visible to that org. Used so each test stays a single line.
 */
async function scopedFindMany(
  prisma: PrismaClient,
  orgId: string,
  model: string,
): Promise<unknown[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${orgId}'`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (tx as any)[model].findMany();
  });
}
