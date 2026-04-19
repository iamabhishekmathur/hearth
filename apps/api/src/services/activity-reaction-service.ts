import { prisma } from '../lib/prisma.js';
import { emitToOrg } from '../ws/socket-manager.js';
import type { ReactionSummary } from '@hearth/shared';

/**
 * Add a reaction to an activity event (audit log entry).
 */
export async function addReaction(params: {
  auditLogId: string;
  userId: string;
  emoji: string;
  orgId: string;
  userName: string;
}): Promise<void> {
  await prisma.activityReaction.create({
    data: {
      auditLogId: params.auditLogId,
      userId: params.userId,
      emoji: params.emoji,
    },
  });

  emitToOrg(params.orgId, 'activity:reaction', {
    auditLogId: params.auditLogId,
    emoji: params.emoji,
    userId: params.userId,
    userName: params.userName,
    added: true,
  });
}

/**
 * Remove a reaction from an activity event.
 */
export async function removeReaction(params: {
  auditLogId: string;
  userId: string;
  emoji: string;
  orgId: string;
  userName: string;
}): Promise<void> {
  await prisma.activityReaction.deleteMany({
    where: {
      auditLogId: params.auditLogId,
      userId: params.userId,
      emoji: params.emoji,
    },
  });

  emitToOrg(params.orgId, 'activity:reaction', {
    auditLogId: params.auditLogId,
    emoji: params.emoji,
    userId: params.userId,
    userName: params.userName,
    added: false,
  });
}

/**
 * Get aggregated reactions for a set of audit log IDs (batch query, not N+1).
 */
export async function getReactionsForEvents(auditLogIds: string[]): Promise<Map<string, ReactionSummary[]>> {
  if (auditLogIds.length === 0) return new Map();

  const reactions = await prisma.activityReaction.findMany({
    where: { auditLogId: { in: auditLogIds } },
    select: { auditLogId: true, emoji: true, userId: true },
  });

  const map = new Map<string, Map<string, { count: number; userIds: string[] }>>();
  for (const r of reactions) {
    if (!map.has(r.auditLogId)) map.set(r.auditLogId, new Map());
    const emojiMap = map.get(r.auditLogId)!;
    if (!emojiMap.has(r.emoji)) emojiMap.set(r.emoji, { count: 0, userIds: [] });
    const entry = emojiMap.get(r.emoji)!;
    entry.count += 1;
    entry.userIds.push(r.userId);
  }

  const result = new Map<string, ReactionSummary[]>();
  for (const [auditLogId, emojiMap] of map) {
    result.set(
      auditLogId,
      Array.from(emojiMap.entries()).map(([emoji, { count, userIds }]) => ({
        emoji,
        count,
        userIds,
      })),
    );
  }

  return result;
}
