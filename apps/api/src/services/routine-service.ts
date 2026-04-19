import type { Prisma } from '@prisma/client';
import type { RoutineScope, RoutineStateConfig, RoutineParameter, ApprovalCheckpointDef } from '@hearth/shared';
import { prisma } from '../lib/prisma.js';

// ── Feature 3: Permission checking ──

interface PermissionContext {
  userId: string;
  orgId?: string | null;
  teamId?: string | null;
  role: string;
}

export function checkRoutinePermission(
  routine: { userId: string; scope: string; teamId: string | null; orgId: string | null },
  user: PermissionContext,
  action: 'view' | 'edit' | 'run' | 'delete',
): boolean {
  const scope = routine.scope as RoutineScope;

  switch (scope) {
    case 'personal':
      return routine.userId === user.userId;

    case 'team': {
      if (action === 'view' || action === 'run') {
        return routine.teamId === user.teamId;
      }
      // edit/delete requires admin or team_lead
      return routine.teamId === user.teamId && ['admin', 'team_lead'].includes(user.role);
    }

    case 'org': {
      if (action === 'view' || action === 'run') {
        return routine.orgId === user.orgId;
      }
      // edit/delete requires admin
      return routine.orgId === user.orgId && user.role === 'admin';
    }

    default:
      return routine.userId === user.userId;
  }
}

// ── List routines (Feature 3: scope-aware) ──

export async function listRoutines(userId: string, opts?: {
  scope?: RoutineScope;
  orgId?: string | null;
  teamId?: string | null;
}) {
  const scopeFilter = opts?.scope;

  // Build compound OR query: personal routines + team routines + org routines
  const where: Prisma.RoutineWhereInput = scopeFilter
    ? scopeFilter === 'personal'
      ? { userId, scope: 'personal' }
      : scopeFilter === 'team'
        ? { teamId: opts?.teamId, scope: 'team' }
        : { orgId: opts?.orgId, scope: 'org' }
    : {
        OR: [
          { userId, scope: 'personal' },
          ...(opts?.teamId ? [{ teamId: opts.teamId, scope: 'team' as const }] : []),
          ...(opts?.orgId ? [{ orgId: opts.orgId, scope: 'org' as const }] : []),
        ],
      };

  return prisma.routine.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      runs: { take: 1, orderBy: { startedAt: 'desc' } },
      triggers: { select: { id: true, eventType: true, status: true } },
      user: { select: { id: true, name: true } },
    },
  });
}

export async function getRoutine(id: string, userId: string) {
  const routine = await prisma.routine.findUnique({
    where: { id },
    include: {
      runs: { take: 5, orderBy: { startedAt: 'desc' } },
      triggers: true,
      chainsFrom: { include: { targetRoutine: { select: { id: true, name: true } } } },
      chainsTo: { include: { sourceRoutine: { select: { id: true, name: true } } } },
      user: { select: { id: true, name: true } },
    },
  });

  return routine;
}

export async function createRoutine(
  userId: string,
  data: {
    name: string;
    description?: string;
    prompt: string;
    schedule?: string;
    context?: Record<string, unknown>;
    delivery?: Record<string, unknown>;
    stateConfig?: RoutineStateConfig;
    scope?: RoutineScope;
    teamId?: string;
    orgId?: string;
    parameters?: RoutineParameter[];
    checkpoints?: ApprovalCheckpointDef[];
  },
) {
  return prisma.routine.create({
    data: {
      userId,
      name: data.name,
      description: data.description ?? null,
      prompt: data.prompt,
      schedule: data.schedule ?? null,
      context: (data.context ?? {}) as Prisma.InputJsonValue,
      delivery: (data.delivery ?? { channels: ['in_app'] }) as Prisma.InputJsonValue,
      enabled: true,
      stateConfig: (data.stateConfig ?? {}) as Prisma.InputJsonValue,
      scope: data.scope ?? 'personal',
      teamId: data.teamId ?? null,
      orgId: data.orgId ?? null,
      parameters: (data.parameters ?? []) as unknown as Prisma.InputJsonValue,
      checkpoints: (data.checkpoints ?? []) as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function updateRoutine(
  id: string,
  userId: string,
  data: {
    name?: string;
    description?: string;
    prompt?: string;
    schedule?: string;
    context?: Record<string, unknown>;
    delivery?: Record<string, unknown>;
    stateConfig?: RoutineStateConfig;
    state?: Record<string, unknown>;
    scope?: RoutineScope;
    teamId?: string;
    parameters?: RoutineParameter[];
    checkpoints?: ApprovalCheckpointDef[];
  },
) {
  const routine = await prisma.routine.findUnique({ where: { id } });
  if (!routine) return null;

  return prisma.routine.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.prompt !== undefined && { prompt: data.prompt }),
      ...(data.schedule !== undefined && { schedule: data.schedule }),
      ...(data.context !== undefined && { context: data.context as Prisma.InputJsonValue }),
      ...(data.delivery !== undefined && { delivery: data.delivery as Prisma.InputJsonValue }),
      ...(data.stateConfig !== undefined && { stateConfig: data.stateConfig as Prisma.InputJsonValue }),
      ...(data.state !== undefined && { state: data.state as Prisma.InputJsonValue }),
      ...(data.scope !== undefined && { scope: data.scope }),
      ...(data.teamId !== undefined && { teamId: data.teamId }),
      ...(data.parameters !== undefined && { parameters: data.parameters as unknown as Prisma.InputJsonValue }),
      ...(data.checkpoints !== undefined && { checkpoints: data.checkpoints as unknown as Prisma.InputJsonValue }),
    },
  });
}

export async function deleteRoutine(id: string, userId: string) {
  const routine = await prisma.routine.findFirst({ where: { id, userId } });
  if (!routine) return null;

  // Delete in dependency order
  await prisma.approvalRequest.deleteMany({ where: { run: { routineId: id } } });
  await prisma.routineRun.deleteMany({ where: { routineId: id } });
  await prisma.routineTrigger.deleteMany({ where: { routineId: id } });
  await prisma.approvalCheckpoint.deleteMany({ where: { routineId: id } });
  await prisma.routineChain.deleteMany({
    where: { OR: [{ sourceRoutineId: id }, { targetRoutineId: id }] },
  });
  await prisma.routineHealthAlert.deleteMany({ where: { routineId: id } });
  return prisma.routine.delete({ where: { id } });
}

export async function toggleRoutine(id: string, userId: string) {
  const routine = await prisma.routine.findFirst({ where: { id, userId } });
  if (!routine) return null;

  return prisma.routine.update({
    where: { id },
    data: { enabled: !routine.enabled },
  });
}

export async function listRuns(routineId: string, userId: string, page = 1, pageSize = 20) {
  // Verify access (simplified — owner check; scope check should be layered by route)
  const routine = await prisma.routine.findUnique({ where: { id: routineId } });
  if (!routine) return null;

  const skip = (page - 1) * pageSize;
  const [runs, total] = await Promise.all([
    prisma.routineRun.findMany({
      where: { routineId },
      orderBy: { startedAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.routineRun.count({ where: { routineId } }),
  ]);

  return { data: runs, total, page, pageSize };
}

export async function createRun(routineId: string, opts?: {
  triggerId?: string;
  triggerEvent?: Record<string, unknown>;
  parameterValues?: Record<string, unknown>;
  triggeredBy?: string;
}) {
  return prisma.routineRun.create({
    data: {
      routineId,
      status: 'running',
      triggerId: opts?.triggerId ?? null,
      triggerEvent: opts?.triggerEvent as Prisma.InputJsonValue ?? undefined,
      parameterValues: opts?.parameterValues as Prisma.InputJsonValue ?? undefined,
      triggeredBy: opts?.triggeredBy ?? null,
    },
  });
}

export async function completeRun(
  runId: string,
  data: {
    status: 'success' | 'failed';
    output?: Record<string, unknown>;
    error?: string;
    tokenCount?: number;
    durationMs?: number;
    summary?: string;
  },
) {
  return prisma.routineRun.update({
    where: { id: runId },
    data: {
      status: data.status,
      output: data.output as Prisma.InputJsonValue ?? null,
      error: data.error ?? null,
      tokenCount: data.tokenCount ?? null,
      durationMs: data.durationMs ?? null,
      completedAt: new Date(),
      summary: data.summary ?? null,
    },
  });
}

// ── Feature 1: State management endpoints ──

export async function getState(routineId: string) {
  const routine = await prisma.routine.findUnique({
    where: { id: routineId },
    select: { state: true },
  });
  return (routine?.state as Record<string, unknown>) ?? {};
}

export async function updateState(routineId: string, state: Record<string, unknown>) {
  return prisma.routine.update({
    where: { id: routineId },
    data: { state: state as Prisma.InputJsonValue },
  });
}

export async function resetState(routineId: string) {
  return prisma.routine.update({
    where: { id: routineId },
    data: { state: {} },
  });
}
