import { prisma } from '../lib/prisma.js';

export interface UsageAnalytics {
  dau: number;
  totalSessions: number;
  totalMessages: number;
  tokenUsage: {
    total: number;
    byDay: Array<{ date: string; tokens: number }>;
  };
  topActions: Array<{ action: string; count: number }>;
}

/**
 * Get usage analytics for an org from audit logs.
 */
export async function getUsageAnalytics(
  orgId: string,
  days = 30,
): Promise<UsageAnalytics> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  // DAU — distinct users with audit log entries in the last 24h
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  const [dauResult, totalSessions, totalMessages, topActions] = await Promise.all([
    prisma.auditLog.findMany({
      where: { orgId, createdAt: { gte: oneDayAgo } },
      distinct: ['userId'],
      select: { userId: true },
    }),
    prisma.chatSession.count({
      where: {
        user: { team: { orgId } },
        createdAt: { gte: since },
      },
    }),
    prisma.chatMessage.count({
      where: {
        session: { user: { team: { orgId } } },
        createdAt: { gte: since },
      },
    }),
    prisma.auditLog.groupBy({
      by: ['action'],
      where: { orgId, createdAt: { gte: since } },
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
      take: 10,
    }),
  ]);

  // Token usage from audit logs with 'tokens' in details
  const tokenLogs = await prisma.auditLog.findMany({
    where: {
      orgId,
      createdAt: { gte: since },
      action: 'chat.message',
    },
    select: { details: true, createdAt: true },
    take: 10000, // Cap to avoid OOM on large orgs
  });

  let totalTokens = 0;
  const tokensByDay = new Map<string, number>();

  for (const log of tokenLogs) {
    const details = log.details as Record<string, unknown>;
    const tokens = (details?.input_tokens as number ?? 0) + (details?.output_tokens as number ?? 0);
    totalTokens += tokens;

    const day = log.createdAt.toISOString().slice(0, 10);
    tokensByDay.set(day, (tokensByDay.get(day) ?? 0) + tokens);
  }

  return {
    dau: dauResult.length,
    totalSessions,
    totalMessages,
    tokenUsage: {
      total: totalTokens,
      byDay: Array.from(tokensByDay.entries())
        .map(([date, tokens]) => ({ date, tokens }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    },
    topActions: topActions.map((a) => ({
      action: a.action,
      count: a._count.action,
    })),
  };
}
