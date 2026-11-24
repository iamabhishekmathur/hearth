import { runAsSystem } from './tenant-context.js';

/**
 * Wrap a BullMQ job processor so it runs inside a tenant context.
 *
 * BullMQ invokes processors outside any HTTP request, so there is no tenant
 * context in AsyncLocalStorage. With no context the Prisma tenant extension
 * sets no RLS GUC, and under the production DB role (NOSUPERUSER,
 * NOBYPASSRLS, FORCE ROW LEVEL SECURITY on tenant tables) every tenant-table
 * read returns zero rows and every write fails the policy check — e.g. the
 * routine worker sees "Routine not found" for every routine. Local dev and
 * the integration DB connect as a superuser, which hides this.
 *
 * Why a bypass (system) context and not a per-org one:
 *   - Jobs are trusted system operations that already scope their work by
 *     the ids in their payload (routineId, taskId, userId, orgId) or fan out
 *     across orgs on purpose (daily triggers, staleness/pattern scans).
 *   - Most payloads carry no orgId, and some rows predate org_id
 *     denormalisation (e.g. legacy routines with a NULL org_id) — an org
 *     context would silently hide them.
 *   - This matches exactly how jobs behave today on a superuser connection,
 *     so it changes nothing locally and restores parity in production.
 *
 * Every BullMQ Worker processor must be wrapped with this; a unit test
 * (`job-context.test.ts`) enforces it across src/.
 */
export function withJobContext<A extends unknown[], R>(
  processor: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return (...args: A) => runAsSystem(() => processor(...args));
}
