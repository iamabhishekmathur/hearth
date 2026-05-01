import { prisma } from '../lib/prisma.js';
import { emitToUser } from '../ws/socket-manager.js';
import { logger } from '../lib/logger.js';

export type NotificationType =
  | 'collaborator_added'
  | 'mention'
  | 'handoff'
  | 'governance_block'
  | 'comment_on_your_message'
  | 'reaction_on_your_message';

export interface NotifyInput {
  orgId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  sessionId?: string;
}

/**
 * Persists a notification and pushes a `notification:new` event to the
 * recipient's user room. Email delivery is deferred to a future ticket.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const row = await prisma.notification.create({
      data: {
        orgId: input.orgId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        sessionId: input.sessionId ?? null,
      },
    });
    emitToUser(input.userId, 'notification:new', {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      entityType: row.entityType,
      entityId: row.entityId,
      sessionId: row.sessionId,
      readAt: null,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    // Notifications are best-effort — never block the caller.
    logger.error({ err, type: input.type, userId: input.userId }, 'notify() failed');
  }
}

export async function listNotifications(
  userId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  return prisma.notification.findMany({
    where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(
  userId: string,
  notificationId: string,
): Promise<boolean> {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count > 0;
}

export async function markAllRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
