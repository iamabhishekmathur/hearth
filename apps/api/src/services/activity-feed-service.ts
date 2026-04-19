import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { providerRegistry } from '../llm/provider-registry.js';
import { FEED_WORTHY_ACTIONS, type ActivityEvent, type CursorPaginatedResponse } from '@hearth/shared';

interface FeedFilters {
  orgId: string;
  userId?: string;
  action?: string;
  page?: number;
  pageSize?: number;
}

interface CursorFeedFilters {
  orgId: string;
  userId?: string;
  action?: string;
  cursor?: string;
  since?: Date;
  limit?: number;
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
    action: filters.action ? { equals: filters.action } : { in: [...FEED_WORTHY_ACTIONS] },
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
 * Parse a cursor string into createdAt + id components.
 * Format: `{ISO_timestamp}_{uuid}`
 */
function parseCursor(cursor: string): { createdAt: Date; id: string } | null {
  const idx = cursor.indexOf('_');
  if (idx === -1) return null;
  const timestamp = cursor.slice(0, idx);
  const id = cursor.slice(idx + 1);
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return null;
  return { createdAt: date, id };
}

function encodeCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}_${id}`;
}

/**
 * Cursor-based feed query. Uses keyset pagination on (createdAt DESC, id DESC).
 */
export async function getFeedCursor(filters: CursorFeedFilters): Promise<CursorPaginatedResponse<ActivityEvent>> {
  const limit = filters.limit ?? 30;

  const where: Prisma.AuditLogWhereInput = {
    orgId: filters.orgId,
    action: filters.action ? { equals: filters.action } : { in: [...FEED_WORTHY_ACTIONS] },
    ...(filters.userId && { userId: filters.userId }),
  };

  // Cursor-based WHERE clause
  if (filters.cursor) {
    const parsed = parseCursor(filters.cursor);
    if (parsed) {
      where.OR = [
        { createdAt: { lt: parsed.createdAt } },
        { createdAt: { equals: parsed.createdAt }, id: { lt: parsed.id } },
      ];
    }
  }

  // Since filter for reconnect catch-up
  if (filters.since) {
    where.createdAt = { ...(where.createdAt as object ?? {}), gt: filters.since };
  }

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: {
      user: { select: { id: true, name: true } },
    },
  });

  const hasMore = logs.length > limit;
  const sliced = hasMore ? logs.slice(0, limit) : logs;

  const data: ActivityEvent[] = sliced.map((log) => ({
    id: log.id,
    userId: log.userId,
    userName: log.user?.name ?? null,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    details: log.details as Record<string, unknown>,
    createdAt: log.createdAt.toISOString(),
  }));

  const lastItem = sliced[sliced.length - 1];
  const cursor = lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null;

  return { data, cursor, hasMore };
}

/**
 * Enrich events with impact metrics in batch (not N+1).
 */
export async function enrichWithMetrics(events: ActivityEvent[]): Promise<void> {
  const skillIds: string[] = [];
  const routineIds: string[] = [];
  const taskIds: string[] = [];

  for (const e of events) {
    if (!e.entityId) continue;
    if (e.action === 'skill_published' || e.action === 'skill_install') skillIds.push(e.entityId);
    if (e.action === 'routine_run') routineIds.push(e.entityId);
    if (e.action === 'task_completed') taskIds.push(e.entityId);
  }

  const [skills, routineRuns, taskSteps] = await Promise.all([
    skillIds.length > 0
      ? prisma.skill.findMany({
          where: { id: { in: skillIds } },
          select: { id: true, installCount: true },
        })
      : [],
    routineIds.length > 0
      ? prisma.routineRun.groupBy({
          by: ['routineId'],
          where: { routineId: { in: routineIds } },
          _count: true,
        })
      : [],
    taskIds.length > 0
      ? prisma.taskExecutionStep.groupBy({
          by: ['taskId'],
          where: { taskId: { in: taskIds }, durationMs: { not: null } },
          _sum: { durationMs: true },
        })
      : [],
  ]);

  const skillMap = new Map(skills.map((s) => [s.id, s.installCount]));
  const routineMap = new Map(routineRuns.map((r) => [r.routineId, r._count]));
  const taskMap = new Map(taskSteps.map((t) => [t.taskId, t._sum.durationMs ?? 0]));

  for (const e of events) {
    if (!e.entityId) continue;
    if ((e.action === 'skill_published' || e.action === 'skill_install') && skillMap.has(e.entityId)) {
      e.metrics = { installCount: skillMap.get(e.entityId)! };
    } else if (e.action === 'routine_run' && routineMap.has(e.entityId)) {
      e.metrics = { totalRuns: routineMap.get(e.entityId)! };
    } else if (e.action === 'task_completed' && taskMap.has(e.entityId)) {
      e.metrics = { timeSavedMs: taskMap.get(e.entityId)! };
    }
  }
}

/**
 * Generate a digest summary of recent activity for a time period.
 * Uses LLM for a natural-language summary; falls back to template on failure.
 */
export async function generateDigest(
  orgId: string,
  since: Date,
): Promise<{ summary: string; eventCount: number }> {
  const logs = await prisma.auditLog.findMany({
    where: {
      orgId,
      action: { in: [...FEED_WORTHY_ACTIONS] },
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

  // Build structured data for both LLM prompt and template fallback
  const grouped: Record<string, string[]> = {};
  for (const log of logs) {
    const action = log.action;
    if (!grouped[action]) grouped[action] = [];
    const userName = log.user?.name ?? 'Someone';
    const details = log.details as Record<string, unknown>;
    const entityDesc = details.title ?? details.name ?? log.entityId ?? '';
    grouped[action].push(`${userName}: ${entityDesc}`);
  }

  // Try LLM summary
  try {
    const rawData = Object.entries(grouped)
      .map(([action, items]) => `${action.replace(/_/g, ' ')} (${items.length}):\n${items.slice(0, 10).map((i) => `  - ${i}`).join('\n')}`)
      .join('\n\n');

    const prompt = `Summarize this team activity into a concise, engaging daily digest. Highlight accomplishments, patterns, and items needing attention. Under 200 words.\n\n${rawData}`;

    let summary = '';
    for await (const event of providerRegistry.chatWithFallback({
      model: 'default',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 400,
    })) {
      if (event.type === 'text_delta') summary += event.content;
      if (event.type === 'error') throw new Error(event.message);
    }

    if (summary.trim()) {
      return { summary: summary.trim(), eventCount: logs.length };
    }
  } catch (err) {
    logger.warn({ err }, 'LLM digest generation failed, falling back to template');
  }

  // Template fallback
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
