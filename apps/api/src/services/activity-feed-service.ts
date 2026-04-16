import { prisma } from '../lib/prisma.js';
import type { ActivityEvent } from '@hearth/shared';

/** Actions that are feed-worthy */
const FEED_ACTIONS = [
  'task_completed',
  'skill_published',
  'skill_install',
  'routine_run',
  'session_created',
];

interface FeedFilters {
  orgId: string;
  userId?: string;
  action?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Query the activity feed from audit logs.
 */
export async function getFeed(filters: FeedFilters): Promise<{
  data: ActivityEvent[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 30;
  const skip = (page - 1) * pageSize;

  const where = {
    orgId: filters.orgId,
    action: filters.action ? { equals: filters.action } : { in: FEED_ACTIONS },
    ...(filters.userId && { userId: filters.userId }),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: {
        user: { select: { id: true, name: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  const data: ActivityEvent[] = logs.map((log) => ({
    id: log.id,
    userId: log.userId,
    userName: log.user?.name ?? null,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    details: log.details as Record<string, unknown>,
    createdAt: log.createdAt.toISOString(),
  }));

  return { data, total, page, pageSize };
}

/**
 * Generate a digest summary of recent activity for a time period.
 */
export async function generateDigest(
  orgId: string,
  since: Date,
): Promise<{ summary: string; eventCount: number }> {
  const logs = await prisma.auditLog.findMany({
    where: {
      orgId,
      action: { in: FEED_ACTIONS },
      createdAt: { gte: since },
    },
    include: {
      user: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (logs.length === 0) {
    return { summary: 'No notable activity in this period.', eventCount: 0 };
  }

  // Group by action type
  const grouped: Record<string, string[]> = {};
  for (const log of logs) {
    const action = log.action;
    if (!grouped[action]) grouped[action] = [];
    const userName = log.user?.name ?? 'Someone';
    const details = log.details as Record<string, unknown>;
    const entityDesc = details.title ?? details.name ?? log.entityId ?? '';
    grouped[action].push(`${userName}: ${entityDesc}`);
  }

  const lines: string[] = [];
  for (const [action, items] of Object.entries(grouped)) {
    const label = action.replace(/_/g, ' ');
    lines.push(`*${label}* (${items.length}):`);
    for (const item of items.slice(0, 5)) {
      lines.push(`  - ${item}`);
    }
    if (items.length > 5) {
      lines.push(`  - ...and ${items.length - 5} more`);
    }
  }

  return { summary: lines.join('\n'), eventCount: logs.length };
}
