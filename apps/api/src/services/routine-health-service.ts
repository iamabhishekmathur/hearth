import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { deliver } from './delivery-service.js';

export async function createAlert(orgId: string, data: {
  routineId: string;
  alertType: string;
  threshold: Record<string, unknown>;
}) {
  return prisma.routineHealthAlert.create({
    data: {
      orgId,
      routineId: data.routineId,
      alertType: data.alertType,
      threshold: data.threshold as import('@prisma/client').Prisma.InputJsonValue,
    },
  });
}

export async function deleteAlert(id: string, orgId: string) {
  const alert = await prisma.routineHealthAlert.findFirst({ where: { id, orgId } });
  if (!alert) return null;
  return prisma.routineHealthAlert.delete({ where: { id } });
}

export async function listAlerts(orgId: string) {
  return prisma.routineHealthAlert.findMany({
    where: { orgId },
    include: { routine: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Checks health of all routines in an org and fires alerts for violations.
 */
export async function checkRoutineHealth(orgId: string): Promise<void> {
  const alerts = await prisma.routineHealthAlert.findMany({
    where: { orgId, enabled: true },
    include: { routine: { select: { id: true, name: true, userId: true } } },
  });

  for (const alert of alerts) {
    try {
      const shouldFire = await evaluateAlert(alert);
      if (shouldFire) {
        await fireAlert(alert);
      }
    } catch (err) {
      logger.error({ err, alertId: alert.id }, 'Failed to evaluate health alert');
    }
  }
}

async function evaluateAlert(alert: {
  id: string;
  routineId: string;
  alertType: string;
  threshold: unknown;
  lastFiredAt: Date | null;
}): Promise<boolean> {
  const threshold = alert.threshold as Record<string, unknown>;

  switch (alert.alertType) {
    case 'consecutive_failures': {
      const count = (threshold.count as number) ?? 3;
      const recentRuns = await prisma.routineRun.findMany({
        where: { routineId: alert.routineId },
        orderBy: { startedAt: 'desc' },
        take: count,
        select: { status: true },
      });
      return recentRuns.length >= count && recentRuns.every((r) => r.status === 'failed');
    }

    case 'missed_schedule': {
      const hours = (threshold.hours as number) ?? 24;
      const routine = await prisma.routine.findUnique({
        where: { id: alert.routineId },
        select: { lastRunAt: true, schedule: true, enabled: true },
      });
      if (!routine?.enabled || !routine.schedule || !routine.lastRunAt) return false;
      const elapsed = Date.now() - routine.lastRunAt.getTime();
      return elapsed > hours * 3600_000;
    }

    case 'high_cost': {
      const tokenLimit = (threshold.tokens as number) ?? 100_000;
      const since = new Date(Date.now() - 24 * 3600_000); // last 24h
      const agg = await prisma.routineRun.aggregate({
        where: { routineId: alert.routineId, startedAt: { gte: since } },
        _sum: { tokenCount: true },
      });
      return (agg._sum.tokenCount ?? 0) > tokenLimit;
    }

    default:
      return false;
  }
}

async function fireAlert(alert: {
  id: string;
  routineId: string;
  alertType: string;
  routine: { id: string; name: string; userId: string };
}) {
  logger.info({ alertId: alert.id, alertType: alert.alertType, routineId: alert.routineId }, 'Health alert fired');

  await prisma.routineHealthAlert.update({
    where: { id: alert.id },
    data: { lastFiredAt: new Date() },
  });

  await deliver({
    userId: alert.routine.userId,
    title: `Health Alert: ${alert.routine.name}`,
    body: `Alert type: ${alert.alertType.replace(/_/g, ' ')}`,
    entityType: 'routine',
    entityId: alert.routineId,
    channels: ['in_app'],
    metadata: { alertId: alert.id, alertType: alert.alertType },
  });
}
