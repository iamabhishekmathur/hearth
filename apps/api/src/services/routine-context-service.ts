import { prisma } from '../lib/prisma.js';
import type { RoutineStateConfig } from '@hearth/shared';
import { logger } from '../lib/logger.js';

export interface RoutineRunContext {
  state: Record<string, unknown>;
  previousRuns: Array<{
    id: string;
    status: string;
    summary: string | null;
    output: unknown;
    startedAt: string;
    completedAt: string | null;
  }>;
  stateConfig: RoutineStateConfig;
}

/**
 * Builds the run context for a routine execution, including persistent state
 * and previous run summaries/outputs. Respects the token budget from stateConfig.
 */
export async function buildRoutineRunContext(routineId: string): Promise<RoutineRunContext> {
  const routine = await prisma.routine.findUnique({
    where: { id: routineId },
    select: { state: true, stateConfig: true },
  });

  if (!routine) {
    return { state: {}, previousRuns: [], stateConfig: {} };
  }

  const state = (routine.state as Record<string, unknown>) ?? {};
  const stateConfig = (routine.stateConfig as RoutineStateConfig) ?? {};

  const previousRunCount = Math.min(stateConfig.previousRunCount ?? 3, 10);
  const maxContextChars = stateConfig.maxContextChars ?? 4000;

  // Fetch last N completed runs
  const runs = await prisma.routineRun.findMany({
    where: {
      routineId,
      status: { in: ['success', 'failed'] },
    },
    orderBy: { startedAt: 'desc' },
    take: previousRunCount,
    select: {
      id: true,
      status: true,
      summary: true,
      output: true,
      startedAt: true,
      completedAt: true,
    },
  });

  // Apply token budget: most recent run gets 50%, older runs split the rest
  const previousRuns = applyTokenBudget(runs, maxContextChars);

  return { state, previousRuns, stateConfig };
}

function applyTokenBudget(
  runs: Array<{
    id: string;
    status: string;
    summary: string | null;
    output: unknown;
    startedAt: Date;
    completedAt: Date | null;
  }>,
  maxChars: number,
): RoutineRunContext['previousRuns'] {
  if (runs.length === 0) return [];

  const halfBudget = Math.floor(maxChars / 2);
  const olderBudget = runs.length > 1 ? Math.floor(halfBudget / (runs.length - 1)) : 0;

  return runs.map((run, i) => {
    const budget = i === 0 ? halfBudget : olderBudget;
    let outputStr = '';

    if (run.summary) {
      outputStr = run.summary;
    } else if (run.output && typeof run.output === 'object') {
      const result = (run.output as Record<string, unknown>).result;
      outputStr = typeof result === 'string' ? result : JSON.stringify(run.output);
    }

    // Truncate to budget
    if (outputStr.length > budget) {
      outputStr = outputStr.slice(0, budget) + '... [truncated]';
    }

    return {
      id: run.id,
      status: run.status,
      summary: run.summary,
      output: outputStr,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
    };
  });
}
