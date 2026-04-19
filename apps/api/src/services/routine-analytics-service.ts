import { prisma } from '../lib/prisma.js';

export interface RoutineAnalyticsResult {
  routineId: string;
  routineName: string;
  totalRuns: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  avgDurationMs: number;
  totalTokens: number;
  lastRunAt: Date | null;
}

export async function getOrgRoutineAnalytics(orgId: string, opts?: {
  from?: Date;
  to?: Date;
}): Promise<RoutineAnalyticsResult[]> {
  // Get all routines for the org (across all scopes)
  const routines = await prisma.routine.findMany({
    where: { orgId },
    select: { id: true, name: true, lastRunAt: true },
  });

  // Also include personal routines from org users
  const orgUsers = await prisma.user.findMany({
    where: { team: { orgId } },
    select: { id: true },
  });
  const userIds = orgUsers.map((u) => u.id);

  const personalRoutines = await prisma.routine.findMany({
    where: { userId: { in: userIds }, orgId: null },
    select: { id: true, name: true, lastRunAt: true },
  });

  const allRoutines = [...routines, ...personalRoutines];
  const routineIds = allRoutines.map((r) => r.id);

  if (routineIds.length === 0) return [];

  // Build date filter for runs
  const dateFilter: Record<string, unknown> = {};
  if (opts?.from) dateFilter.gte = opts.from;
  if (opts?.to) dateFilter.lte = opts.to;
  const startedAtFilter = Object.keys(dateFilter).length > 0 ? dateFilter : undefined;

  // Get aggregated stats per routine
  const results: RoutineAnalyticsResult[] = [];

  for (const routine of allRoutines) {
    const where = {
      routineId: routine.id,
      ...(startedAtFilter ? { startedAt: startedAtFilter } : {}),
    };

    const [total, successCount, failedCount, avgDuration, totalTokens] = await Promise.all([
      prisma.routineRun.count({ where }),
      prisma.routineRun.count({ where: { ...where, status: 'success' } }),
      prisma.routineRun.count({ where: { ...where, status: 'failed' } }),
      prisma.routineRun.aggregate({ where, _avg: { durationMs: true } }),
      prisma.routineRun.aggregate({ where, _sum: { tokenCount: true } }),
    ]);

    if (total === 0) continue;

    results.push({
      routineId: routine.id,
      routineName: routine.name,
      totalRuns: total,
      successCount,
      failedCount,
      successRate: total > 0 ? (successCount / total) * 100 : 0,
      avgDurationMs: avgDuration._avg.durationMs ?? 0,
      totalTokens: totalTokens._sum.tokenCount ?? 0,
      lastRunAt: routine.lastRunAt,
    });
  }

  return results.sort((a, b) => b.totalRuns - a.totalRuns);
}

export async function getTopConsumers(orgId: string, limit = 10) {
  // Uses the analytics to find routines with highest token usage
  const analytics = await getOrgRoutineAnalytics(orgId);
  return analytics.sort((a, b) => b.totalTokens - a.totalTokens).slice(0, limit);
}
