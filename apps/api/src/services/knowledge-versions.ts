/**
 * Knowledge loop, Phase 0 — versioned memory entries and routines.
 *
 * Every change to the CONTENT of an org/team/user memory entry, and every
 * change to the DEFINITION of a routine, writes an immutable version row in
 * the same transaction as the change. Version rows are never edited: a
 * rollback writes a new version that carries the old content.
 *
 * Not versioned (they are not knowledge): session notes, memory metadata
 * (source, expiry), routine run state, enable/disable, last-run fields.
 *
 * Concurrency: the bump is a compare-and-set on the row's `version`. A caller
 * that passes `expectedVersion` gets a VersionConflictError when someone else
 * saved first; a caller that does not is retried on the newer version.
 */
import { isDeepStrictEqual } from 'node:util';
import { Prisma, type MemoryEntry, type Routine } from '@prisma/client';
import type { KnowledgeChangeSource, RoutineSnapshot } from '@hearth/shared';
import { prisma } from '../lib/prisma.js';
import { getTenant, withTenantTx, type TenantTx } from '../lib/tenant-context.js';

export interface ChangeMeta {
  changeSource: KnowledgeChangeSource;
  changedById: string | null;
  /** For a rollback: the version whose content is restored. */
  restoredFrom?: number | null;
}

export class VersionConflictError extends Error {
  constructor(public readonly currentVersion: number) {
    super(`Version conflict: the item is now at version ${currentVersion}`);
    this.name = 'VersionConflictError';
  }
}

const MAX_CAS_ATTEMPTS = 3;

/**
 * One transaction that also carries the RLS tenant GUC when a tenant context
 * is active (HTTP requests, jobs that call runWithTenant). Outside a context
 * (scripts, some tests) it is a plain transaction.
 */
export async function knowledgeTx<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  const ctx = getTenant();
  if (ctx && (ctx.bypass || ctx.orgId)) return withTenantTx(fn);
  return prisma.$transaction((tx) => fn(tx));
}

// ── Memory ────────────────────────────────────────────────────────────────

/** Session notes are short-lived scratch space, not knowledge. */
export function isVersionedLayer(layer: string): boolean {
  return layer !== 'session';
}

export async function createMemoryVersioned(
  data: Prisma.MemoryEntryUncheckedCreateInput,
  meta: ChangeMeta,
): Promise<MemoryEntry> {
  return knowledgeTx(async (tx) => {
    const entry = await tx.memoryEntry.create({ data: { ...data, version: 1 } });
    if (isVersionedLayer(entry.layer)) {
      await tx.memoryVersion.create({
        data: {
          memoryId: entry.id,
          orgId: entry.orgId,
          version: 1,
          content: entry.content,
          changeSource: meta.changeSource,
          changedById: meta.changedById,
        },
      });
    }
    return entry;
  });
}

/**
 * Updates a memory entry. Returns null when the entry does not exist.
 * A content change on a versioned layer bumps `version` and writes a row.
 */
export async function updateMemoryVersioned(
  id: string,
  data: Prisma.MemoryEntryUpdateManyMutationInput,
  meta: ChangeMeta,
  expectedVersion?: number,
): Promise<MemoryEntry | null> {
  return knowledgeTx(async (tx) => {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const current = await tx.memoryEntry.findUnique({ where: { id } });
      if (!current) return null;
      if (expectedVersion !== undefined && current.version !== expectedVersion) {
        throw new VersionConflictError(current.version);
      }

      const contentChanged = typeof data.content === 'string' && data.content !== current.content;
      if (!contentChanged || !isVersionedLayer(current.layer)) {
        return tx.memoryEntry.update({ where: { id }, data });
      }

      const next = current.version + 1;
      const res = await tx.memoryEntry.updateMany({
        where: { id, version: current.version },
        data: { ...data, version: next },
      });
      if (res.count === 0) {
        // Someone saved between our read and write.
        if (expectedVersion !== undefined) {
          const latest = await tx.memoryEntry.findUnique({
            where: { id },
            select: { version: true },
          });
          throw new VersionConflictError(latest?.version ?? current.version);
        }
        continue;
      }
      await tx.memoryVersion.create({
        data: {
          memoryId: id,
          orgId: current.orgId,
          version: next,
          content: data.content as string,
          changeSource: meta.changeSource,
          changedById: meta.changedById,
          restoredFrom: meta.restoredFrom ?? null,
        },
      });
      return tx.memoryEntry.findUniqueOrThrow({ where: { id } });
    }
    const latest = await tx.memoryEntry.findUnique({ where: { id }, select: { version: true } });
    throw new VersionConflictError(latest?.version ?? 0);
  });
}

export async function listMemoryVersions(memoryId: string, page = 1, pageSize = 20) {
  const take = Math.min(Math.max(pageSize, 1), 100);
  const skip = (Math.max(page, 1) - 1) * take;
  const [versions, total] = await Promise.all([
    prisma.memoryVersion.findMany({
      where: { memoryId },
      orderBy: { version: 'desc' },
      skip,
      take,
    }),
    prisma.memoryVersion.count({ where: { memoryId } }),
  ]);
  return { versions, total, page: Math.max(page, 1), pageSize: take };
}

export type RollbackResult<T> =
  | { status: 'not_found' }
  | { status: 'version_not_found' }
  | { status: 'unchanged'; item: T }
  | { status: 'rolled_back'; item: T };

/** Restores the content of `toVersion` by writing a NEW version. */
export async function rollbackMemory(
  id: string,
  toVersion: number,
  changedById: string,
): Promise<RollbackResult<MemoryEntry>> {
  const target = await prisma.memoryVersion.findUnique({
    where: { memoryId_version: { memoryId: id, version: toVersion } },
  });
  if (!target) {
    const exists = await prisma.memoryEntry.findUnique({ where: { id }, select: { id: true } });
    return exists ? { status: 'version_not_found' } : { status: 'not_found' };
  }
  const current = await prisma.memoryEntry.findUnique({ where: { id } });
  if (!current) return { status: 'not_found' };
  if (current.content === target.content) return { status: 'unchanged', item: current };

  const item = await updateMemoryVersioned(
    id,
    { content: target.content },
    { changeSource: 'rollback', changedById, restoredFrom: toVersion },
  );
  return item ? { status: 'rolled_back', item } : { status: 'not_found' };
}

// ── Routines ──────────────────────────────────────────────────────────────

export const ROUTINE_SNAPSHOT_KEYS = [
  'name',
  'description',
  'prompt',
  'schedule',
  'context',
  'delivery',
  'stateConfig',
  'scope',
  'teamId',
  'parameters',
  'checkpoints',
] as const satisfies ReadonlyArray<keyof RoutineSnapshot>;

/**
 * Restored by a rollback. Scope and team are left out on purpose: rolling
 * back a prompt must never move a routine to another team or audience.
 */
const ROUTINE_RESTORE_KEYS = ROUTINE_SNAPSHOT_KEYS.filter((k) => k !== 'scope' && k !== 'teamId');

export function routineSnapshot(r: Routine): RoutineSnapshot {
  return {
    name: r.name,
    description: r.description,
    prompt: r.prompt,
    schedule: r.schedule,
    context: (r.context ?? {}) as Record<string, unknown>,
    delivery: (r.delivery ?? {}) as Record<string, unknown>,
    stateConfig: (r.stateConfig ?? {}) as Record<string, unknown>,
    scope: r.scope as RoutineSnapshot['scope'],
    teamId: r.teamId,
    parameters: (r.parameters ?? []) as unknown as RoutineSnapshot['parameters'],
    checkpoints: (r.checkpoints ?? []) as unknown as RoutineSnapshot['checkpoints'],
  };
}

/** True when `data` changes any versioned field of `before`. */
export function changesRoutineDefinition(before: Routine, data: Record<string, unknown>): boolean {
  const snap = routineSnapshot(before) as unknown as Record<string, unknown>;
  return ROUTINE_SNAPSHOT_KEYS.some(
    (k) => data[k] !== undefined && !isDeepStrictEqual(normalize(data[k]), normalize(snap[k])),
  );
}

/** JSON round-trip so `undefined` members and Date/JSON shapes compare equal. */
function normalize(v: unknown): unknown {
  return v === null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v));
}

export async function createRoutineVersioned(
  data: Prisma.RoutineUncheckedCreateInput,
  meta: ChangeMeta,
): Promise<Routine> {
  return knowledgeTx(async (tx) => {
    const routine = await tx.routine.create({ data: { ...data, version: 1 } });
    await tx.routineVersion.create({
      data: {
        routineId: routine.id,
        version: 1,
        snapshot: routineSnapshot(routine) as unknown as Prisma.InputJsonValue,
        changeSource: meta.changeSource,
        changedById: meta.changedById,
      },
    });
    return routine;
  });
}

/**
 * Updates a routine. Returns null when it does not exist. A change to any
 * snapshot field bumps `version` and writes a row; other fields (state,
 * enabled, last-run) update in place.
 */
export async function updateRoutineVersioned(
  id: string,
  data: Prisma.RoutineUncheckedUpdateManyInput,
  meta: ChangeMeta,
  expectedVersion?: number,
): Promise<Routine | null> {
  return knowledgeTx(async (tx) => {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const current = await tx.routine.findUnique({ where: { id } });
      if (!current) return null;
      if (expectedVersion !== undefined && current.version !== expectedVersion) {
        throw new VersionConflictError(current.version);
      }

      if (!changesRoutineDefinition(current, data as Record<string, unknown>)) {
        return tx.routine.update({
          where: { id },
          data: data as Prisma.RoutineUncheckedUpdateInput,
        });
      }

      const next = current.version + 1;
      const res = await tx.routine.updateMany({
        where: { id, version: current.version },
        data: { ...data, version: next },
      });
      if (res.count === 0) {
        if (expectedVersion !== undefined) {
          const latest = await tx.routine.findUnique({ where: { id }, select: { version: true } });
          throw new VersionConflictError(latest?.version ?? current.version);
        }
        continue;
      }
      const updated = await tx.routine.findUniqueOrThrow({ where: { id } });
      await tx.routineVersion.create({
        data: {
          routineId: id,
          version: next,
          snapshot: routineSnapshot(updated) as unknown as Prisma.InputJsonValue,
          changeSource: meta.changeSource,
          changedById: meta.changedById,
          restoredFrom: meta.restoredFrom ?? null,
        },
      });
      return updated;
    }
    const latest = await tx.routine.findUnique({ where: { id }, select: { version: true } });
    throw new VersionConflictError(latest?.version ?? 0);
  });
}

export async function listRoutineVersions(routineId: string, page = 1, pageSize = 20) {
  const take = Math.min(Math.max(pageSize, 1), 100);
  const skip = (Math.max(page, 1) - 1) * take;
  const [versions, total] = await Promise.all([
    prisma.routineVersion.findMany({
      where: { routineId },
      orderBy: { version: 'desc' },
      skip,
      take,
    }),
    prisma.routineVersion.count({ where: { routineId } }),
  ]);
  return { versions, total, page: Math.max(page, 1), pageSize: take };
}

/** Restores the definition of `toVersion` (not its scope/team) as a NEW version. */
export async function rollbackRoutine(
  id: string,
  toVersion: number,
  changedById: string,
): Promise<RollbackResult<Routine>> {
  const target = await prisma.routineVersion.findUnique({
    where: { routineId_version: { routineId: id, version: toVersion } },
  });
  if (!target) {
    const exists = await prisma.routine.findUnique({ where: { id }, select: { id: true } });
    return exists ? { status: 'version_not_found' } : { status: 'not_found' };
  }
  const snap = target.snapshot as unknown as Record<string, unknown>;
  const restore: Record<string, unknown> = {};
  for (const k of ROUTINE_RESTORE_KEYS) {
    if (k in snap) restore[k] = snap[k];
  }

  const current = await prisma.routine.findUnique({ where: { id } });
  if (!current) return { status: 'not_found' };
  if (!changesRoutineDefinition(current, restore)) return { status: 'unchanged', item: current };

  const item = await updateRoutineVersioned(id, restore as Prisma.RoutineUncheckedUpdateManyInput, {
    changeSource: 'rollback',
    changedById,
    restoredFrom: toVersion,
  });
  return item ? { status: 'rolled_back', item } : { status: 'not_found' };
}
