import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

export async function createChain(data: {
  sourceRoutineId: string;
  targetRoutineId: string;
  condition?: string;
  parameterMapping?: Record<string, string>;
}) {
  // Prevent self-chaining
  if (data.sourceRoutineId === data.targetRoutineId) {
    throw new Error('A routine cannot chain to itself');
  }

  // Check for cycles
  const hasCycle = await detectCycle(data.sourceRoutineId, data.targetRoutineId);
  if (hasCycle) {
    throw new Error('Chain would create a cycle');
  }

  return prisma.routineChain.create({
    data: {
      sourceRoutineId: data.sourceRoutineId,
      targetRoutineId: data.targetRoutineId,
      condition: data.condition ?? 'on_success',
      parameterMapping: data.parameterMapping ?? {},
    },
  });
}

export async function deleteChain(id: string) {
  return prisma.routineChain.delete({ where: { id } });
}

export async function getChains(routineId: string) {
  const [chainsFrom, chainsTo] = await Promise.all([
    prisma.routineChain.findMany({
      where: { sourceRoutineId: routineId },
      include: { targetRoutine: { select: { id: true, name: true } } },
    }),
    prisma.routineChain.findMany({
      where: { targetRoutineId: routineId },
      include: { sourceRoutine: { select: { id: true, name: true } } },
    }),
  ]);
  return { chainsFrom, chainsTo };
}

/**
 * Detects cycles using DFS. Returns true if adding an edge from source to target would create a cycle.
 */
async function detectCycle(sourceRoutineId: string, targetRoutineId: string): Promise<boolean> {
  // If target has chains leading back to source, we have a cycle
  const visited = new Set<string>();
  const stack = [targetRoutineId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === sourceRoutineId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const chains = await prisma.routineChain.findMany({
      where: { sourceRoutineId: current, enabled: true },
      select: { targetRoutineId: true },
    });

    for (const chain of chains) {
      stack.push(chain.targetRoutineId);
    }
  }

  return false;
}

/**
 * Finds and enqueues downstream routines after a run completes.
 * Called by the routine scheduler after a run finishes.
 */
export async function getDownstreamChains(routineId: string, status: 'success' | 'failed') {
  return prisma.routineChain.findMany({
    where: {
      sourceRoutineId: routineId,
      enabled: true,
      OR: [
        { condition: 'always' },
        { condition: status === 'success' ? 'on_success' : 'on_failure' },
      ],
    },
    include: {
      targetRoutine: { select: { id: true, userId: true, enabled: true, parameters: true } },
    },
  });
}
