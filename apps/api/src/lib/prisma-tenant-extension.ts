import { Prisma, type PrismaClient } from '@prisma/client';
import { getTenant, runWithTenant, type TenantContext } from './tenant-context.js';

/**
 * Prisma extension that wraps every query in a transaction and sets the
 * RLS GUC (app.org_id or app.bypass_rls) before running it.
 *
 * Why we wrap every query:
 *   - SET LOCAL is transaction-scoped, so the GUC must be set inside
 *     the same transaction as the actual query.
 *   - Prisma's connection pooling means we can't reliably set GUC at
 *     connection-acquire time and have it stick across queries.
 *   - Putting the wrap here means every existing `prisma.x.foo()` call
 *     site automatically participates in RLS without code changes.
 *
 * Raw SQL ($queryRaw, $queryRawUnsafe, $executeRaw, $executeRawUnsafe) is
 * wrapped the same way: when a tenant context with an org or a bypass is
 * active and no explicit transaction is open, the statement runs in its own
 * transaction with the GUC set. Without this, raw queries on tenant tables
 * (memory/decision/experience vector search, embedding updates…) return
 * nothing / fail the policy under a non-superuser DB role.
 *
 * Cost: every query becomes a transaction (~1ms overhead). Worth it for
 * the correctness guarantee. If a hot path needs to amortize the cost,
 * use `withTenantTx()` directly to bundle multiple queries in one tx.
 *
 * Behavior when no tenant context is active:
 *   - The query runs as-is, without a GUC. RLS will return zero rows for
 *     tenant tables, which is the loud-failure mode we want — it surfaces
 *     missing requireOrg middleware / job wrapping. Background jobs get a
 *     context from `withJobContext` (see job-context.ts).
 */

const ORG_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

type RawOperation = '$executeRaw' | '$executeRawUnsafe' | '$queryRaw' | '$queryRawUnsafe';
const RAW_OPERATIONS = new Set<string>([
  '$executeRaw',
  '$executeRawUnsafe',
  '$queryRaw',
  '$queryRawUnsafe',
]);

/** SET LOCAL the RLS GUC for `ctx` on an open transaction. */
async function setTenantGuc(tx: Prisma.TransactionClient, ctx: TenantContext): Promise<void> {
  if (ctx.bypass) {
    await tx.$executeRawUnsafe(`SET LOCAL app.bypass_rls = 'on'`);
  } else if (ctx.orgId) {
    if (!ORG_ID_REGEX.test(ctx.orgId)) {
      throw new Error(`Invalid orgId in tenant context: ${ctx.orgId}`);
    }
    await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${ctx.orgId}'`);
  }
}

/**
 * Re-issue a raw operation on a transaction client. The extension sees raw
 * args in Prisma's "middleware" shape (verified against Prisma 6.19):
 *   - $queryRawUnsafe / $executeRawUnsafe: [sql, ...values]
 *   - $queryRaw / $executeRaw as a tagged template: [strings, ...values]
 *   - $queryRaw / $executeRaw with a Prisma.sql object: [Sql]
 */
export function runRawOnTx(
  tx: Prisma.TransactionClient,
  operation: RawOperation,
  args: unknown,
): Promise<unknown> {
  const list = (Array.isArray(args) ? args : [args]) as unknown[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = tx as any;
  if (operation === '$queryRawUnsafe' || operation === '$executeRawUnsafe') {
    return client[operation](...list);
  }
  const [first, ...values] = list;
  if (Array.isArray(first)) {
    // Prisma.Sql is type-only at runtime; Prisma.sql builds the same object
    // from a plain strings array.
    return client[operation](Prisma.sql(first as string[], ...(values as Prisma.Sql['values'])));
  }
  return client[operation](first);
}

export function applyTenantExtension(client: PrismaClient): PrismaClient {
  return client.$extends({
    name: 'tenant-rls',
    query: {
      $allOperations: async ({ args, query, operation, model }) => {
        const ctx = getTenant();

        // Transaction APIs pass through: an interactive $transaction's
        // callback queries come back through here with their own context.
        if (operation === '$transaction' || operation === '$runCommandRaw') {
          return query(args);
        }

        // No context: run the query as-is. RLS will filter rows on
        // tenant-scoped tables. Non-tenant tables (User, Org, Team, Skill
        // public lookups, etc.) work normally because they don't have RLS.
        if (!ctx) {
          return query(args);
        }

        // Caller has already opened an explicit transaction with the GUC
        // set (via withTenantTx / withRlsBypass). Pass through unchanged
        // so the query runs inside the existing tx and rolls back together
        // on error. Without this, the auto-wrap would create a *separate*
        // transaction that commits independently of the outer one.
        if (ctx.inExplicitTx) {
          return query(args);
        }

        if (RAW_OPERATIONS.has(operation)) {
          // Nothing to set (signed-in context without an org): leave the
          // statement untouched rather than opening a pointless transaction.
          if (!ctx.bypass && !ctx.orgId) return query(args);
          return runWithTenant({ ...ctx, inExplicitTx: true }, () =>
            client.$transaction(async (tx) => {
              await setTenantGuc(tx, ctx);
              return runRawOnTx(tx, operation as RawOperation, args);
            }),
          ) as Prisma.PrismaPromise<unknown>;
        }

        // Wrap in a transaction with the appropriate GUC set. Mark the
        // context as inExplicitTx so the recursive call (the inner
        // findMany on `tx`) skips the auto-wrap and runs in this tx.
        return runWithTenant({ ...ctx, inExplicitTx: true }, () =>
          client.$transaction(async (tx) => {
            await setTenantGuc(tx, ctx);
            // Re-run the operation through the transactional client.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (tx as any)[model as string][operation](args);
          }),
        ) as Prisma.PrismaPromise<unknown>;
      },
    },
  }) as unknown as PrismaClient;
}
