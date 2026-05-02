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
