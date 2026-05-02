import { prisma } from '../lib/prisma.js';
import type { Prisma } from '@prisma/client';

export type ContentFilter = 'all' | 'responses' | 'prompts';

// Map content filter to legacy shareType column values
const FILTER_TO_SHARE_TYPE: Record<ContentFilter, string> = {
  all: 'full',
  responses: 'results_only',
  prompts: 'template',
};

/**
 * Create a share link for a chat session.
 * Accepts a contentFilter param (all/responses/prompts) for the public link view.
 */
export async function createShare(
  sessionId: string,
  userId: string,
  contentFilter: ContentFilter = 'all',
  expiresAt?: Date,
) {
  // Verify the user owns the session
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId },
  });
  if (!session) {
    throw new Error('Session not found');
  }

  return prisma.sessionShare.create({
    data: {
      orgId: session.orgId,
      sessionId,
      shareType: FILTER_TO_SHARE_TYPE[contentFilter],
      createdBy: userId,
      expiresAt: expiresAt ?? null,
    },
  });
}

/**
 * Get a shared session by token (public — no auth required).
 * Returns null if the token is invalid or expired.
 */
export async function getSharedSession(token: string) {
  const share = await prisma.sessionShare.findUnique({
    where: { token },
    include: {
      session: {
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
            take: 500,
          },
          user: { select: { name: true } },
        },
      },
    },
  });

  if (!share) return null;

  // Check expiration
  if (share.expiresAt && share.expiresAt < new Date()) {
    return null;
  }

  // Filter messages based on share type
  let messages = share.session.messages;
  if (share.shareType === 'results_only') {
    messages = messages.filter((m) => m.role === 'assistant');
  } else if (share.shareType === 'template') {
    messages = messages.filter((m) => m.role === 'user');
  }

  // Map shareType back to content filter labels
  const contentFilterLabel: Record<string, string> = {
    full: 'Everything',
    results_only: 'AI responses only',
    template: 'Prompts only',
  };

  return {
    id: share.id,
    shareType: share.shareType,
    contentFilterLabel: contentFilterLabel[share.shareType] ?? share.shareType,
    session: {
      id: share.session.id,
      title: share.session.title,
      createdAt: share.session.createdAt,
      ownerName: share.session.user.name,
    },
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdBy: m.createdBy,
      createdAt: m.createdAt,
    })),
  };
}

/**
 * Duplicate a session — creates a new session with the original messages for the current user.
 * Only allowed if the user owns the session, is a collaborator, the session is org-visible
 * within the user's org, or it has been shared via link.
 *
 * Optionally accepts `upToMessageId` to only copy messages up to (and including) that message.
 */
export async function duplicateSession(
  sessionId: string,
  userId: string,
  upToMessageId?: string,
) {
  const original = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, take: 500 },
      user: { include: { team: { select: { orgId: true } } } },
      collaborators: { select: { userId: true } },
    },
  });

  if (!original) {
    throw new Error('Session not found');
  }

  // Access check: owner, collaborator, org-visible same org, or has a share link
  const isOwner = original.userId === userId;
  const isCollaborator = original.collaborators.some((c) => c.userId === userId);

  if (!isOwner && !isCollaborator) {
    // Check org membership for org-visible sessions
    let orgAllowed = false;
    if (original.visibility === 'org') {
      const viewer = await prisma.user.findUnique({
        where: { id: userId },
        include: { team: { select: { orgId: true } } },
      });
      const sessionOrgId = original.user.team?.orgId;
      if (viewer?.team?.orgId && sessionOrgId && viewer.team.orgId === sessionOrgId) {
        orgAllowed = true;
      }
    }

    if (!orgAllowed) {
      // Fallback: check if there's a share link
      const share = await prisma.sessionShare.findFirst({
        where: { sessionId },
      });
      if (!share) {
        throw new Error('Session not found');
      }
    }
  }

  // Determine which messages to copy
  let messagesToCopy = original.messages;
  if (upToMessageId) {
    const targetIdx = messagesToCopy.findIndex((m) => m.id === upToMessageId);
    if (targetIdx !== -1) {
      messagesToCopy = messagesToCopy.slice(0, targetIdx + 1);
    }
  }

  // Create the duplicated session in the same org as the original (the access
  // check above already verified the duplicating user has access through the
  // same org or a collaborator/share grant).
  const duplicated = await prisma.chatSession.create({
    data: {
      orgId: original.orgId,
      userId,
      title: original.title ? `Copy of: ${original.title}` : 'Duplicated session',
      status: 'active',
    },
  });

  // Copy messages
  if (messagesToCopy.length > 0) {
    await prisma.chatMessage.createMany({
      data: messagesToCopy.map((m) => ({
        orgId: duplicated.orgId,
        sessionId: duplicated.id,
        role: m.role,
        content: m.content,
        metadata: m.metadata as Prisma.InputJsonValue,
      })),
    });
  }

  return duplicated;
}

// Keep backward compat alias
export const forkSession = duplicateSession;
