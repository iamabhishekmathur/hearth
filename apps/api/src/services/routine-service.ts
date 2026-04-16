import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export async function listRoutines(userId: string) {
  return prisma.routine.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { runs: { take: 1, orderBy: { startedAt: 'desc' } } },
  });
}

export async function getRoutine(id: string, userId: string) {
  return prisma.routine.findFirst({
    where: { id, userId },
    include: { runs: { take: 5, orderBy: { startedAt: 'desc' } } },
  });
}

export async function createRoutine(
  userId: string,
  data: {
    name: string;
    description?: string;
    prompt: string;
    schedule: string;
    context?: Record<string, unknown>;
    delivery?: Record<string, unknown>;
  },
) {
  return prisma.routine.create({
    data: {
      userId,
      name: data.name,
      description: data.description ?? null,
      prompt: data.prompt,
      schedule: data.schedule,
      context: (data.context ?? {}) as Prisma.InputJsonValue,
      delivery: (data.delivery ?? { channels: ['in_app'] }) as Prisma.InputJsonValue,
      enabled: true,
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
  },
) {
  const routine = await prisma.routine.findFirst({ where: { id, userId } });
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
    },
  });
}

export async function deleteRoutine(id: string, userId: string) {
  const routine = await prisma.routine.findFirst({ where: { id, userId } });
  if (!routine) return null;

  // Delete runs first, then the routine
  await prisma.routineRun.deleteMany({ where: { routineId: id } });
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
  // Verify ownership
  const routine = await prisma.routine.findFirst({ where: { id: routineId, userId } });
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

export async function createRun(routineId: string) {
  return prisma.routineRun.create({
    data: {
      routineId,
      status: 'running',
    },
  });
}

export async function completeRun(
  runId: string,
  data: { status: 'success' | 'failed'; output?: Record<string, unknown>; error?: string; tokenCount?: number; durationMs?: number },
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
    },
  });
}
