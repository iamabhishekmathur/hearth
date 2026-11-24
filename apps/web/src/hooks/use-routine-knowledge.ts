import type {
  KnowledgeChangeSource,
  MemoryVersion,
  RoutineDryRun,
  RoutineOwnership,
  RoutineTestCase,
  RoutineTestFailure,
  RoutineVersion,
} from '@hearth/shared';
import { api } from '@/lib/api-client';

/**
 * Knowledge loop, Phase 4 — API calls behind the routine page's History,
 * Owner and Tests sections (and the Memory page's history). Components keep
 * their own state; these are thin, typed wrappers.
 */

/** One row of a history list, for routines (the prompt) and memory (the content). */
export interface HistoryItem {
  version: number;
  text: string;
  changeSource: KnowledgeChangeSource;
  changedByName: string | null;
  restoredFrom: number | null;
  createdAt: string;
}

export interface HistoryPage {
  items: HistoryItem[];
  currentVersion: number;
  isOwner: boolean;
  total: number;
}

interface VersionsResponse<T> {
  data: T[];
  total: number;
  currentVersion: number;
  isOwner?: boolean;
}

export async function fetchRoutineHistory(routineId: string): Promise<HistoryPage> {
  const res = await api.get<VersionsResponse<RoutineVersion>>(
    `/routines/${routineId}/versions?pageSize=50`,
  );
  return {
    items: res.data.map((v) => ({
      version: v.version,
      text: v.snapshot?.prompt ?? '',
      changeSource: v.changeSource,
      changedByName: v.changedBy?.name ?? null,
      restoredFrom: v.restoredFrom,
      createdAt: v.createdAt,
    })),
    currentVersion: res.currentVersion,
    isOwner: res.isOwner === true,
    total: res.total,
  };
}

export async function fetchMemoryHistory(memoryId: string): Promise<HistoryPage> {
  const res = await api.get<VersionsResponse<MemoryVersion>>(
    `/memory/${memoryId}/versions?pageSize=50`,
  );
  return {
    items: res.data.map((v) => ({
      version: v.version,
      text: v.content,
      changeSource: v.changeSource,
      changedByName: v.changedBy?.name ?? null,
      restoredFrom: v.restoredFrom,
      createdAt: v.createdAt,
    })),
    currentVersion: res.currentVersion,
    isOwner: res.isOwner === true,
    total: res.total,
  };
}

export function restoreRoutineVersion(routineId: string, version: number, overrideTests = false) {
  return api.post(`/routines/${routineId}/rollback`, {
    version,
    ...(overrideTests && { overrideTests: true }),
  });
}

export function restoreMemoryVersion(memoryId: string, version: number) {
  return api.post(`/memory/${memoryId}/rollback`, { version });
}

export async function fetchOwnership(routineId: string): Promise<RoutineOwnership> {
  return (await api.get<{ data: RoutineOwnership }>(`/routines/${routineId}/ownership`)).data;
}

export function setRoutineOwner(routineId: string, ownerId: string | null) {
  return api.patch(`/routines/${routineId}/owner`, { ownerId });
}

export async function fetchTestCases(
  routineId: string,
): Promise<{ cases: RoutineTestCase[]; canEdit: boolean }> {
  const res = await api.get<{ data: RoutineTestCase[]; canEdit: boolean }>(
    `/routines/${routineId}/test-cases`,
  );
  return { cases: res.data, canEdit: res.canEdit };
}

export async function createTestCase(
  routineId: string,
  body: { description: string; mustContain: string[] },
): Promise<RoutineTestCase> {
  return (await api.post<{ data: RoutineTestCase }>(`/routines/${routineId}/test-cases`, body))
    .data;
}

export async function updateTestCase(
  routineId: string,
  id: string,
  body: { description?: string; mustContain?: string[] },
): Promise<RoutineTestCase> {
  return (
    await api.patch<{ data: RoutineTestCase }>(`/routines/${routineId}/test-cases/${id}`, body)
  ).data;
}

export function deleteTestCase(routineId: string, id: string) {
  return api.delete(`/routines/${routineId}/test-cases/${id}`);
}

export async function startDryRun(
  routineId: string,
  opts: { prompt?: string; tests?: boolean } = {},
): Promise<RoutineDryRun> {
  const path = opts.tests
    ? `/routines/${routineId}/test-cases/run`
    : `/routines/${routineId}/dry-run`;
  return (await api.post<{ data: RoutineDryRun }>(path, opts.prompt ? { prompt: opts.prompt } : {}))
    .data;
}

export async function fetchDryRun(routineId: string, id: string): Promise<RoutineDryRun> {
  return (await api.get<{ data: RoutineDryRun }>(`/routines/${routineId}/dry-runs/${id}`)).data;
}

/** Polls until the dry run finishes (or `signal` aborts). */
export async function waitForDryRun(
  routineId: string,
  id: string,
  opts: { intervalMs?: number; signal?: AbortSignal } = {},
): Promise<RoutineDryRun> {
  const interval = opts.intervalMs ?? 1500;
  for (;;) {
    const run = await fetchDryRun(routineId, id);
    if (run.status !== 'running' || opts.signal?.aborted) return run;
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** The failures from a 409 `tests_failed` answer, or null for any other error. */
export function testFailuresOf(err: unknown): RoutineTestFailure[] | null {
  const e = err as { status?: number; body?: { code?: string; failures?: RoutineTestFailure[] } };
  if (e?.status === 409 && e.body?.code === 'tests_failed' && Array.isArray(e.body.failures)) {
    return e.body.failures;
  }
  return null;
}

/** Plain words for where a change came from. */
export function sourceLabel(source: KnowledgeChangeSource): string {
  switch (source) {
    case 'user':
      return 'Edited';
    case 'agent':
      return 'Changed by an agent';
    case 'curator':
      return 'Approved fix';
    case 'rollback':
      return 'Restored';
    case 'migration':
      return 'Imported';
    case 'synthesis':
      return 'Merged by Hearth';
    default:
      return 'Changed';
  }
}
