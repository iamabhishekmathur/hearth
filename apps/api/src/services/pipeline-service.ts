import { prisma } from '../lib/prisma.js';

export async function createPipelineRun(rootRunId: string) {
  return prisma.pipelineRun.create({
    data: {
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
