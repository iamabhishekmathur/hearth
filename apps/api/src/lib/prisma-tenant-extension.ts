import { PrismaClient, type Prisma } from '@prisma/client';
import { getTenant } from './tenant-context.js';

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
 * Cost: every query becomes a transaction (~1ms overhead). Worth it for
 * the correctness guarantee. If a hot path needs to amortize the cost,
 * use `withTenantTx()` directly to bundle multiple queries in one tx.
 *
 * Behavior when no tenant context is active:
 *   - The extension logs a warning and runs the query without setting
 *     a GUC. RLS will return zero rows for tenant tables, which is the
 *     loud-failure mode we want — it surfaces missing requireOrg
 *     middleware in tests and dev. Production health checks will catch
 *     this if it slips into runtime.
 */

const ORG_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

export function applyTenantExtension(client: PrismaClient): PrismaClient {
  return client.$extends({
    name: 'tenant-rls',
    query: {
      $allOperations: async ({ args, query, operation, model }) => {
        const ctx = getTenant();

        // Skip wrapping for raw SQL escape hatches and transaction APIs.
        // The caller is responsible for setting GUC inside their own tx.
        if (
          operation === '$executeRaw' ||
          operation === '$executeRawUnsafe' ||
          operation === '$queryRaw' ||
          operation === '$queryRawUnsafe' ||
          operation === '$transaction'
        ) {
          return query(args);
        }

        // No context: run the query as-is. RLS will filter rows on
        // tenant-scoped tables. Non-tenant tables (User, Org, Team, Skill
        // public lookups, etc.) work normally because they don't have RLS.
        if (!ctx) {
          return query(args);
        }

        // Wrap in a transaction with the appropriate GUC set.
        return client.$transaction(async (tx) => {
          if (ctx.bypass) {
            await tx.$executeRawUnsafe(`SET LOCAL app.bypass_rls = 'on'`);
          } else if (ctx.orgId) {
            if (!ORG_ID_REGEX.test(ctx.orgId)) {
              throw new Error(`Invalid orgId in tenant context: ${ctx.orgId}`);
            }
            await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${ctx.orgId}'`);
          }
          // Re-run the operation through the transactional client.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (tx as any)[model as string][operation](args);
        }) as Prisma.PrismaPromise<unknown>;
      },
    },
  }) as unknown as PrismaClient;
}
