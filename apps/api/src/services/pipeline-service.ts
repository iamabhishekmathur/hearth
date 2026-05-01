import { prisma } from '../lib/prisma.js';

export async function createPipelineRun(rootRunId: string) {
  // Derive orgId from the routine that owns the root run.
  const rootRun = await prisma.routineRun.findUnique({
    where: { id: rootRunId },
    select: { routine: { select: { orgId: true } } },
  });
  if (!rootRun?.routine.orgId) {
    throw new Error(`Cannot create pipeline run: root run ${rootRunId} has no org-scoped routine`);
  }
  return prisma.pipelineRun.create({
    data: {
      orgId: rootRun.routine.orgId,
      rootRunId,
      status: 'running',
      runIds: [rootRunId],
    },
  });
}

export async function addRunToPipeline(pipelineId: string, runId: string) {
  const pipeline = await prisma.pipelineRun.findUnique({ where: { id: pipelineId } });
  if (!pipeline) return null;

  return prisma.pipelineRun.update({
    where: { id: pipelineId },
    data: {
      runIds: [...pipeline.runIds, runId],
    },
  });
}

export async function completePipeline(pipelineId: string, status: 'completed' | 'failed' | 'partial') {
  return prisma.pipelineRun.update({
    where: { id: pipelineId },
    data: {
      status,
      completedAt: new Date(),
    },
  });
}

export async function getPipelineRun(id: string) {
  return prisma.pipelineRun.findUnique({ where: { id } });
}

export async function findPipelineByRunId(runId: string) {
  // Find any pipeline that contains this run ID
  const pipelines = await prisma.pipelineRun.findMany({
    where: { runIds: { has: runId } },
    orderBy: { startedAt: 'desc' },
    take: 1,
  });
  return pipelines[0] ?? null;
}
