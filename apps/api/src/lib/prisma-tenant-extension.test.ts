import { describe, it, expect, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { applyTenantExtension, runRawOnTx } from './prisma-tenant-extension.js';
import { getTenant, runWithTenant, type TenantContext } from './tenant-context.js';

/**
 * Unit tests for the tenant extension with a fake client: we capture the
 * `$allOperations` hook and drive it directly, recording what runs on the
 * transaction client. The real-database behaviour (non-superuser role, RLS
 * enforced) is covered by integration/rls-enforced.itest.ts.
 */

type AllOps = (p: {
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
  operation: string;
  model?: string;
}) => Promise<unknown>;

function setup() {
  const log: Array<{ op: string; args: unknown[]; ctx: TenantContext | null }> = [];
  const rec =
    (op: string, ret: unknown) =>
    async (...args: unknown[]) => {
      log.push({ op, args, ctx: getTenant() });
      return ret;
    };
  const tx = {
    $executeRawUnsafe: vi.fn(rec('$executeRawUnsafe', 1)),
    $queryRawUnsafe: vi.fn(rec('$queryRawUnsafe', [{ id: 'q' }])),
    $executeRaw: vi.fn(rec('$executeRaw', 2)),
    $queryRaw: vi.fn(rec('$queryRaw', [{ id: 't' }])),
    Routine: { findMany: vi.fn(rec('Routine.findMany', [{ id: 'r' }])) },
  };
  let hook: AllOps | undefined;
  const client = {
    $extends: (cfg: { query: { $allOperations: AllOps } }) => {
      hook = cfg.query.$allOperations;
      return {};
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  applyTenantExtension(client as unknown as PrismaClient);
  const query = vi.fn(async () => 'passthrough');
  const call = (operation: string, args: unknown, model?: string) =>
    hook!({ args, query, operation, model });
  return { tx, client, query, call, log };
}

const ORG = { orgId: 'org_A-1', userId: 'u1' };
const BYPASS = { orgId: null, userId: null, bypass: true };

describe('tenant extension — raw SQL', () => {
  it.each(['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe'])(
    '%s with no tenant context passes through untouched',
    async (op) => {
      const s = setup();
      expect(await s.call(op, ['SELECT 1'])).toBe('passthrough');
      expect(s.client.$transaction).not.toHaveBeenCalled();
      expect(s.query).toHaveBeenCalledWith(['SELECT 1']);
    },
  );

  it('$queryRawUnsafe under an org context runs in a tx with app.org_id set first', async () => {
    const s = setup();
    const out = await runWithTenant(ORG, () =>
      s.call('$queryRawUnsafe', ['SELECT * FROM memory_entries WHERE id = $1', 'm1']),
    );
    expect(out).toEqual([{ id: 'q' }]);
    expect(s.query).not.toHaveBeenCalled();
    expect(s.client.$transaction).toHaveBeenCalledTimes(1);
    expect(s.log.map((l) => [l.op, ...l.args])).toEqual([
      ['$executeRawUnsafe', `SET LOCAL app.org_id = 'org_A-1'`],
      ['$queryRawUnsafe', 'SELECT * FROM memory_entries WHERE id = $1', 'm1'],
    ]);
  });

  it('$executeRawUnsafe under a bypass context sets app.bypass_rls', async () => {
    const s = setup();
    const out = await runWithTenant(BYPASS, () =>
      s.call('$executeRawUnsafe', [
        'UPDATE memory_entries SET embedding = $1 WHERE id = $2',
        'v',
        'm1',
      ]),
    );
    expect(out).toBe(1);
    expect(s.log.map((l) => l.args[0])).toEqual([
      `SET LOCAL app.bypass_rls = 'on'`,
      'UPDATE memory_entries SET embedding = $1 WHERE id = $2',
    ]);
    expect(s.log[1].args.slice(1)).toEqual(['v', 'm1']);
  });

  it('tagged-template $executeRaw ([strings, ...values]) is rebuilt as a Prisma.Sql', async () => {
    const s = setup();
    const strings = ['UPDATE chat_messages SET x = ', ' WHERE id = ', ''];
    await runWithTenant(ORG, () => s.call('$executeRaw', [strings, 'task-1', 'msg-1']));
    const issued = s.tx.$executeRaw.mock.calls[0][0] as unknown as Prisma.Sql;
    expect(issued.strings).toEqual(strings);
    expect(issued.sql).toBe('UPDATE chat_messages SET x = ? WHERE id = ?');
    expect(issued.values).toEqual(['task-1', 'msg-1']);
  });

  it('tagged-template $queryRaw with no interpolations still works', async () => {
    const s = setup();
    const out = await runWithTenant(ORG, () => s.call('$queryRaw', [['SELECT 1']]));
    expect(out).toEqual([{ id: 't' }]);
    const issued = s.tx.$queryRaw.mock.calls[0][0] as unknown as Prisma.Sql;
    expect(issued.sql).toBe('SELECT 1');
    expect(issued.values).toEqual([]);
  });

  it('$queryRaw with a Prisma.sql object ([Sql]) is passed through as-is', async () => {
    const s = setup();
    const sql = Prisma.sql`SELECT * FROM decisions WHERE org_id = ${'org_A-1'}`;
    await runWithTenant(ORG, () => s.call('$queryRaw', [sql]));
    expect(s.tx.$queryRaw.mock.calls[0][0]).toBe(sql);
  });

  it('inside an explicit tx (withTenantTx / withRlsBypass) raw ops pass through', async () => {
    const s = setup();
    const out = await runWithTenant({ ...ORG, inExplicitTx: true }, () =>
      s.call('$queryRawUnsafe', ['SELECT 1']),
    );
    expect(out).toBe('passthrough');
    expect(s.client.$transaction).not.toHaveBeenCalled();
  });

  it('a context with neither orgId nor bypass passes raw ops through', async () => {
    const s = setup();
    const out = await runWithTenant({ orgId: null, userId: 'u1' }, () =>
      s.call('$executeRawUnsafe', ['SELECT 1']),
    );
    expect(out).toBe('passthrough');
    expect(s.client.$transaction).not.toHaveBeenCalled();
  });

  it('marks the context inExplicitTx while the wrapped raw op runs', async () => {
    const s = setup();
    await runWithTenant(ORG, () => s.call('$queryRawUnsafe', ['SELECT 1']));
    expect(s.log[1].ctx).toMatchObject({ ...ORG, inExplicitTx: true });
    // …and the caller's context is unchanged afterwards.
    await runWithTenant(ORG, async () => {
      await s.call('$queryRawUnsafe', ['SELECT 1']);
      expect(getTenant()).toEqual(ORG);
    });
  });

  it('rejects a malformed orgId before running anything', async () => {
    const s = setup();
    await expect(
      runWithTenant({ orgId: "x'; DROP TABLE users; --", userId: null }, () =>
        s.call('$queryRawUnsafe', ['SELECT 1']),
      ),
    ).rejects.toThrow('Invalid orgId');
    expect(s.tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('propagates a raw-query error', async () => {
    const s = setup();
    s.tx.$queryRawUnsafe.mockRejectedValueOnce(new Error('syntax error'));
    await expect(runWithTenant(ORG, () => s.call('$queryRawUnsafe', ['SELEC 1']))).rejects.toThrow(
      'syntax error',
    );
  });

  it('$transaction always passes through', async () => {
    const s = setup();
    expect(await runWithTenant(ORG, () => s.call('$transaction', [[]]))).toBe('passthrough');
    expect(s.client.$transaction).not.toHaveBeenCalled();
  });
});

describe('tenant extension — model operations (unchanged)', () => {
  it('wraps a model query and sets app.org_id', async () => {
    const s = setup();
    const out = await runWithTenant(ORG, () => s.call('findMany', { where: {} }, 'Routine'));
    expect(out).toEqual([{ id: 'r' }]);
    expect(s.log.map((l) => l.op)).toEqual(['$executeRawUnsafe', 'Routine.findMany']);
    expect(s.log[0].args[0]).toBe(`SET LOCAL app.org_id = 'org_A-1'`);
  });

  it('wraps a model query with app.bypass_rls under the system context', async () => {
    const s = setup();
    await runWithTenant(BYPASS, () => s.call('findMany', {}, 'Routine'));
    expect(s.log[0].args[0]).toBe(`SET LOCAL app.bypass_rls = 'on'`);
  });

  it('passes a model query through with no context', async () => {
    const s = setup();
    expect(await s.call('findMany', {}, 'Routine')).toBe('passthrough');
  });
});

describe('runRawOnTx', () => {
  const tx = () => ({
    $queryRawUnsafe: vi.fn(async () => 'u'),
    $executeRawUnsafe: vi.fn(async () => 'eu'),
    $queryRaw: vi.fn(async () => 'q'),
    $executeRaw: vi.fn(async () => 'e'),
  });

  it('spreads unsafe args', async () => {
    const t = tx();
    await runRawOnTx(t as unknown as Prisma.TransactionClient, '$executeRawUnsafe', ['S $1', 1]);
    expect(t.$executeRawUnsafe).toHaveBeenCalledWith('S $1', 1);
  });

  it('accepts a non-array arg defensively', async () => {
    const t = tx();
    const sql = Prisma.sql`SELECT 1`;
    await runRawOnTx(t as unknown as Prisma.TransactionClient, '$queryRaw', sql);
    expect(t.$queryRaw).toHaveBeenCalledWith(sql);
  });
});
