import { getTenant } from './tenant-context.js';

/**
 * Per-tenant Redis key builder.
 *
 * Every Redis key for tenant-scoped state must go through this helper, which
 * prefixes it with `org:{orgId}:`. This is defense-in-depth: even if a key
 * collision bug leaks across tenants in app code, the prefix prevents it from
 * actually colliding in Redis.
 *
 * For system/global keys (BullMQ queue names, Socket.io rooms, dedup keys
 * that are intentionally global), use `globalKey()` instead.
 */
export function tenantKey(...parts: string[]): string {
  const ctx = getTenant();
  if (!ctx?.orgId) {
    throw new Error(
      'tenantKey() called outside a tenant context. ' +
        'Either call within an authenticated request handler, or use globalKey() for non-tenant state.',
    );
  }
  return `org:${ctx.orgId}:${parts.join(':')}`;
}

/**
 * Build a Redis key for a specific org (used when you have an explicit orgId
 * rather than relying on the AsyncLocalStorage context — e.g. background
 * jobs that processed a queue payload).
 */
export function tenantKeyFor(orgId: string, ...parts: string[]): string {
  if (!orgId) {
    throw new Error('tenantKeyFor() requires a non-empty orgId');
  }
  return `org:${orgId}:${parts.join(':')}`;
}

/**
 * Build a Redis key for genuinely global state. Use sparingly and document
 * why the key is not tenant-scoped at the call site.
 *
 * Examples of legitimate global keys:
 *   - BullMQ queue and job state (managed by BullMQ itself)
 *   - Socket.io adapter pub/sub channels
 *   - System feature flags
 *   - Cross-tenant rate limiting buckets (e.g. global anti-abuse)
 */
export function globalKey(...parts: string[]): string {
  return `global:${parts.join(':')}`;
}
