import { AsyncLocalStorage } from 'node:async_hooks';
import type { PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';

/**
 * IMPORTANT — deployment requirement for RLS to actually enforce:
 *
 * DATABASE_URL must use a Postgres role that is NOT a superuser and does
 * NOT have the BYPASSRLS attribute. Otherwise RLS policies are silently
 * bypassed and tenants can read each other's data.
 *
 *   CREATE ROLE hearth_app NOSUPERUSER NOBYPASSRLS LOGIN PASSWORD '...';
 *   GRANT USAGE ON SCHEMA public TO hearth_app;
 *   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hearth_app;
 *   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hearth_app;
 *   ALTER DEFAULT PRIVILEGES IN SCHEMA public
 *     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hearth_app;
 *
 * Migrations still run as the privileged role (they need to create tables
 * and policies). Only the runtime app role must be constrained.
 */

/**
 * Tenant context — propagated through async calls so every Prisma query
 * knows which org it's operating on. Set once per request (in auth
 * middleware) or per background job, then consumed by withTenantTx().
 *
 * `bypass: true` disables RLS for the call site — use only for legitimate
 * cross-tenant operations (migrations, system jobs, admin tooling). Every
 * use should be reviewed.
 */
export interface TenantContext {
  orgId: string | null;
  userId: string | null;
  bypass?: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Run `fn` with the given tenant context. Anything async inside fn (including
 * Prisma queries) inherits the context.
 *
 * Use this for background jobs, scripts, or anywhere you have a clean
 * scope boundary. For Express middleware where you can't easily wrap
 * `next()`, use `enterTenant()` instead.
 */
export function runWithTenant<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * Enter a tenant context without a callback wrapper. Use this in Express
 * middleware where you'd rather call next() conventionally.
 *
 * The context is set on the *current* async resource and propagates to
 * anything spawned from it (so the request handler chain inherits it).
 */
export function enterTenant(ctx: TenantContext): void {
  storage.enterWith(ctx);
}

/**
 * Read the current tenant context. Returns null if no context is active
 * (likely a misconfigured code path — RLS will reject the query).
 */
export function getTenant(): TenantContext | null {
  return storage.getStore() ?? null;
}

/**
 * Run a Prisma transaction that has the RLS GUC set, so policies see
 * the right org. The active tenant context is read from AsyncLocalStorage.
 *
 * Use this whenever you're about to run multiple queries that need RLS
 * applied. For a single query, use `withTenantTx` directly.
 *
 * Example:
 *   await withTenantTx(async (tx) => {
 *     const tasks = await tx.task.findMany();
 *     await tx.task.update({ ... });
 *   });
 */
export async function withTenantTx<T>(
  fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  const ctx = getTenant();
  if (!ctx) {
    throw new Error(
      'withTenantTx() called outside a tenant context. ' +
        'Wrap the call site in runWithTenant() (auth middleware does this for HTTP requests).',
    );
  }

  return prisma.$transaction(async (tx) => {
    if (ctx.bypass) {
      // System/admin path: bypass RLS for cross-tenant operations.
      // Bypass is logged via callers; nothing we can do at this layer.
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_rls = 'on'`);
    } else if (ctx.orgId) {
      // Regular tenant path: scope all queries to this org.
      // SET LOCAL is transaction-scoped and reverts on commit/rollback.
      await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${escapeOrgId(ctx.orgId)}'`);
    } else {
      // No orgId and no bypass — queries will return zero rows because
      // the GUC is unset. Fail loud so we don't silently lose data.
      throw new Error(
        'Tenant context has no orgId and no bypass flag. ' +
          'This usually means a route handler missed requireOrg middleware.',
      );
    }
    return fn(tx);
  });
}

/**
 * Bypass-RLS variant — runs `fn` with RLS disabled for this transaction.
 * Use ONLY for trusted system operations (migrations, cross-tenant analytics,
 * admin tools). Every call site should have a code comment explaining why.
 */
export async function withRlsBypass<T>(
  fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.bypass_rls = 'on'`);
    return fn(tx);
  });
}

/**
 * Org IDs are UUIDs in our schema, but stored as TEXT. We still validate
 * the shape before interpolating to prevent any chance of SQL injection
 * via a corrupted session.
 */
function escapeOrgId(orgId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(orgId)) {
    throw new Error(`Invalid orgId format: ${orgId}`);
  }
  return orgId;
}
