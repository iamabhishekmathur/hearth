import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import type { ProactiveSignal } from '@hearth/shared';

/**
 * Compute proactive signals for a user within their org.
 * Signals are computed on-demand (cached at route layer via Redis).
 */
export async function computeSignals(params: {
  userId: string;
  orgId: string;
}): Promise<ProactiveSignal[]> {
  const signals: ProactiveSignal[] = [];

  try {
    const [staleRoutines, idleTasks, trendingSkills, staleDecisions] = await Promise.all([
      findStaleRoutines(params.userId),
      findIdleTasks(params.userId),
      findTrendingSkills(params.orgId),
      findStaleDecisions(params.orgId),
    ]);

    signals.push(...staleRoutines, ...idleTasks, ...trendingSkills, ...staleDecisions);
  } catch (err) {
    logger.error({ err }, 'Failed to compute proactive signals');
  }

  return signals;
}

/**
 * Enabled routines with no run in 7+ days.
 */
async function findStaleRoutines(userId: string): Promise<ProactiveSignal[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const routines = await prisma.routine.findMany({
    where: {
      userId,
      enabled: true,
      OR: [
        { lastRunAt: { lt: sevenDaysAgo } },
        { lastRunAt: null },
      ],
    },
    select: { id: true, name: true, lastRunAt: true },
    take: 3,
  });

  return routines.map((r) => ({
    id: `stale_routine_${r.id}`,
    type: 'stale_routine' as const,
    title: `"${r.name}" hasn't run recently`,
    description: r.lastRunAt
      ? `Last run ${Math.floor((Date.now() - r.lastRunAt.getTime()) / (1000 * 60 * 60 * 24))} days ago`
      : 'Never run',
    entityType: 'routine',
    entityId: r.id,
    actionLabel: 'View Routine',
    actionUrl: `/#/routines?routineId=${r.id}`,
  }));
}

/**
 * Tasks in executing/planning with no activity for 3+ days.
 */
async function findIdleTasks(userId: string): Promise<ProactiveSignal[]> {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  const tasks = await prisma.task.findMany({
    where: {
      userId,
      status: { in: ['executing', 'planning'] },
      updatedAt: { lt: threeDaysAgo },
    },
    select: { id: true, title: true, status: true, updatedAt: true },
    take: 3,
  });

  return tasks.map((t) => ({
    id: `idle_task_${t.id}`,
    type: 'idle_task' as const,
    title: `"${t.title}" needs attention`,
    description: `In ${t.status} with no activity for ${Math.floor((Date.now() - t.updatedAt.getTime()) / (1000 * 60 * 60 * 24))} days`,
    entityType: 'task',
    entityId: t.id,
    actionLabel: 'View Task',
    actionUrl: `/#/workspace?taskId=${t.id}`,
  }));
}

/**
 * Skills with highest install-count growth in the last 7 days.
 */
async function findTrendingSkills(orgId: string): Promise<ProactiveSignal[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Count recent installs per skill
  const recentInstalls = await prisma.userSkill.groupBy({
    by: ['skillId'],
    where: {
      installedAt: { gte: sevenDaysAgo },
      skill: { orgId },
    },
    _count: true,
    orderBy: { _count: { skillId: 'desc' } },
    take: 3,
  });

  if (recentInstalls.length === 0) return [];

  const skillIds = recentInstalls.map((r) => r.skillId);
  const skills = await prisma.skill.findMany({
    where: { id: { in: skillIds } },
    select: { id: true, name: true, installCount: true },
  });

  const skillMap = new Map(skills.map((s) => [s.id, s]));

  const results: ProactiveSignal[] = [];
  for (const r of recentInstalls) {
    if (r._count < 2) continue;
    const skill = skillMap.get(r.skillId);
    if (!skill) continue;
    results.push({
      id: `trending_skill_${skill.id}`,
      type: 'trending_skill',
      title: `"${skill.name}" is trending`,
      description: `${r._count} installs this week (${skill.installCount} total)`,
      entityType: 'skill',
      entityId: skill.id,
      actionLabel: 'Install Skill',
      actionUrl: `/#/skills?skillId=${skill.id}`,
    });
  }
  return results;
}

/**
 * Active decisions older than 180 days with no outcomes recorded.
 */
async function findStaleDecisions(orgId: string): Promise<ProactiveSignal[]> {
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

  try {
    const decisions = await prisma.decision.findMany({
      where: {
        orgId,
        status: 'active',
        createdAt: { lt: sixMonthsAgo },
        outcomes: { none: {} },
      },
      select: { id: true, title: true, createdAt: true },
      take: 3,
    });

    return decisions.map((d) => ({
      id: `stale_decision_${d.id}`,
      type: 'stale_decision' as const,
      title: `"${d.title}" needs outcome review`,
      description: `Decision made ${Math.floor((Date.now() - d.createdAt.getTime()) / (1000 * 60 * 60 * 24))} days ago with no recorded outcome`,
      entityType: 'decision',
      entityId: d.id,
      actionLabel: 'Review Decision',
      actionUrl: `/#/decisions?id=${d.id}`,
    }));
  } catch {
    return [];
  }
}
