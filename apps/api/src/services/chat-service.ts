import type { ChatMessageRole, SessionVisibility, CollaboratorRole, ChatAttachment, LLMMessage } from '@hearth/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

/**
 * Transforms a DB attachment row into the shared API type,
 * converting storagePath to a URL.
 */
export function toAttachmentResponse(a: {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  width: number | null;
  height: number | null;
}): ChatAttachment {
  return {
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    url: `/api/v1/uploads/${a.storagePath}`,
    width: a.width ?? undefined,
    height: a.height ?? undefined,
  };
}

/**
 * Creates a new chat session for a user.
 */
export async function createSession(userId: string, title?: string) {
  return prisma.chatSession.create({
    data: {
      userId,
      title: title ?? null,
      status: 'active',
    },
  });
}

/**
 * Lists all active sessions for a user, ordered by most recent first.
 */
export async function listSessions(userId: string) {
  return prisma.chatSession.findMany({
    where: { userId, status: 'active' },
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Gets a single session with its messages.
 * Allows access if the user is the owner, a collaborator, or the session
 * is org-visible and the user belongs to the same org.
 */
export async function getSession(sessionId: string, userId: string) {
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, include: { attachments: true } },
      user: { select: { id: true, name: true, teamId: true, team: { select: { orgId: true } } } },
      collaborators: { select: { userId: true, role: true } },
    },
  });

  if (!session) return null;

  // Owner — always allowed
  if (session.userId === userId) return session;

  // Collaborator — allowed
  const isCollaborator = session.collaborators.some((c) => c.userId === userId);
  if (isCollaborator) return session;

  // Org-visible — check same org
  if (session.visibility === 'org') {
    const viewer = await prisma.user.findUnique({
      where: { id: userId },
      include: { team: { select: { orgId: true } } },
    });
    const sessionOrgId = session.user.team?.orgId;
    if (viewer?.team?.orgId && sessionOrgId && viewer.team.orgId === sessionOrgId) {
      return session;
    }
  }

  return null;
}

/**
 * Updates the title of a session. Returns null if not found or not owned.
 */
export async function updateSessionTitle(sessionId: string, userId: string, title: string) {
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId },
  });
  if (!session) return null;
  return prisma.chatSession.update({
    where: { id: sessionId },
    data: { title },
  });
}

/**
 * Archives a session (soft delete). Returns null if not found or not owned.
 */
export async function archiveSession(sessionId: string, userId: string) {
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId },
  });

  if (!session) return null;

  return prisma.chatSession.update({
    where: { id: sessionId },
    data: { status: 'archived' },
  });
}

/**
 * Adds a message to a session, optionally attributing it to a specific user.
 */
export async function addMessage(
  sessionId: string,
  role: ChatMessageRole,
  content: string,
  metadata?: Record<string, unknown>,
  createdBy?: string,
) {
  return prisma.chatMessage.create({
    data: {
      sessionId,
      role,
      content,
      metadata: (metadata ?? {}) as Prisma.InputJsonValue,
      createdBy: createdBy ?? null,
    },
  });
}

/**
 * Gets all messages for a session, ordered by creation time.
 * Includes attachments for each message.
 */
export async function getMessages(sessionId: string) {
  return prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    include: { attachments: true },
  });
}

/**
 * Links uploaded attachments to a message by updating their messageId.
 */
export async function linkAttachments(messageId: string, attachmentIds: string[]) {
  if (attachmentIds.length === 0) return;
  await prisma.chatAttachment.updateMany({
    where: {
      id: { in: attachmentIds },
      messageId: null, // Only link unlinked attachments
    },
    data: { messageId },
  });
}

/**
 * Sets the visibility of a session. Only the owner can change visibility.
 */
export async function setVisibility(
  sessionId: string,
  userId: string,
  visibility: SessionVisibility,
) {
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId },
  });
  if (!session) return null;

  return prisma.chatSession.update({
    where: { id: sessionId },
    data: { visibility },
  });
}

/**
 * Lists org-shared sessions visible to the user's org.
 * Excludes the user's own sessions (they already see those in their list).
 */
export async function listSharedSessions(userId: string, orgId: string) {
  return prisma.chatSession.findMany({
    where: {
      visibility: 'org',
      status: 'active',
      userId: { not: userId },
      user: {
        team: { orgId },
      },
    },
    include: {
      user: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
}

/**
 * Checks whether a user can send messages in a session.
 * Returns the access level or null if no send access.
 */
export async function getSessionWriteAccess(
  sessionId: string,
  userId: string,
): Promise<'owner' | 'contributor' | null> {
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId },
    include: {
      collaborators: {
        where: { userId },
        select: { role: true },
      },
    },
  });

  if (!session) return null;
  if (session.userId === userId) return 'owner';

  const collab = session.collaborators[0];
  if (collab?.role === 'contributor') return 'contributor';

  return null;
}

/**
 * Adds a collaborator to a session. Only the owner can add collaborators.
 */
export async function addCollaborator(
  sessionId: string,
  ownerUserId: string,
  targetUserId: string,
  role: CollaboratorRole,
) {
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId: ownerUserId },
  });
  if (!session) return null;

  return prisma.sessionCollaborator.upsert({
    where: {
      sessionId_userId: { sessionId, userId: targetUserId },
    },
    update: { role },
    create: {
      sessionId,
      userId: targetUserId,
      role,
      addedBy: ownerUserId,
    },
  });
}

/**
 * Removes a collaborator from a session. Only the owner can remove.
 */
export async function removeCollaborator(
  sessionId: string,
  ownerUserId: string,
  targetUserId: string,
) {
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId: ownerUserId },
  });
  if (!session) return null;

  return prisma.sessionCollaborator.deleteMany({
    where: { sessionId, userId: targetUserId },
  });
}

/**
 * Lists collaborators for a session.
 */
export async function listCollaborators(sessionId: string) {
  return prisma.sessionCollaborator.findMany({
    where: { sessionId },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Allows an org member to join an org-visible session as a contributor.
 */
export async function joinSession(sessionId: string, userId: string) {
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, visibility: 'org' },
    include: {
      user: { include: { team: { select: { orgId: true } } } },
    },
  });
  if (!session) return null;

  const joiner = await prisma.user.findUnique({
    where: { id: userId },
    include: { team: { select: { orgId: true } } },
  });

  const sessionOrgId = session.user.team?.orgId;
  if (!joiner?.team?.orgId || !sessionOrgId || joiner.team.orgId !== sessionOrgId) {
    return null;
  }

  return prisma.sessionCollaborator.upsert({
    where: {
      sessionId_userId: { sessionId, userId },
    },
    update: {},
    create: {
      sessionId,
      userId,
      role: 'contributor',
      addedBy: userId,
    },
  });
}

/**
 * Searches org members by name/email for the collaborator autocomplete.
 */
export async function searchOrgMembers(orgId: string, query: string, excludeUserId?: string) {
  return prisma.user.findMany({
    where: {
      team: { orgId },
      id: excludeUserId ? { not: excludeUserId } : undefined,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, email: true },
    take: 10,
  });
}

/**
 * Summarizes earlier messages in a conversation when it grows too long.
 * Returns a concise summary suitable for injecting as context, or null if
 * the conversation is short enough not to need summarization.
 *
 * Thresholds: >40 messages or >100K total chars.
 * Keeps the last `keepRecent` messages intact and summarizes the rest.
 */
export async function summarizeEarlierMessages(
  messages: Array<{ role: string; content: string }>,
  opts: { keepRecent?: number } = {},
): Promise<string | null> {
  const keepRecent = opts.keepRecent ?? 10;
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);

  // Check if summarization is needed
  if (messages.length <= 40 && totalChars <= 100_000) {
    return null;
  }

  // Split into older messages (to summarize) and recent messages (to keep)
  const splitIdx = Math.max(0, messages.length - keepRecent);
  const olderMessages = messages.slice(0, splitIdx);

  if (olderMessages.length === 0) return null;

  // Build a condensed representation of older messages
  const condensed = olderMessages
    .map((m) => {
      const truncated = m.content.length > 500
        ? m.content.slice(0, 500) + '...'
        : m.content;
      return `[${m.role}]: ${truncated}`;
    })
    .join('\n');

  try {
    const { providerRegistry } = await import('../llm/provider-registry.js');
    const summaryMessages: LLMMessage[] = [
      {
        role: 'user',
        content: `Summarize this conversation history in 3-5 concise paragraphs, preserving key decisions, facts, and context. Focus on information that would be needed to continue the conversation.\n\n${condensed}`,
      },
    ];

    let summary = '';
    const stream = providerRegistry.chatWithFallback({
      model: 'claude-haiku-4-5-20251001',
      messages: summaryMessages,
      maxTokens: 1024,
    });

    for await (const event of stream) {
      if (event.type === 'text_delta') {
        summary += event.content;
      }
    }

    return summary || null;
  } catch (err) {
    logger.error({ err }, 'Failed to summarize earlier messages');
    return null;
  }
}
