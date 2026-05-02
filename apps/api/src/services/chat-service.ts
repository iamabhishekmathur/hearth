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
export async function createSession(orgId: string, userId: string, title?: string) {
  return prisma.chatSession.create({
    data: {
      orgId,
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
 * Adds a message to a session, optionally attributing it to a specific user
 * and linking it to a prior user message it is responding to.
 */
export async function addMessage(
  orgId: string,
  sessionId: string,
  role: ChatMessageRole,
  content: string,
  metadata?: Record<string, unknown>,
  createdBy?: string,
  respondingToMessageId?: string,
) {
  return prisma.chatMessage.create({
    data: {
      orgId,
      sessionId,
      role,
      content,
      metadata: (metadata ?? {}) as Prisma.InputJsonValue,
      createdBy: createdBy ?? null,
      respondingToMessageId: respondingToMessageId ?? null,
    },
  });
}

/**
 * Builds a { [userId]: { id, name } } map for the distinct authors of a
 * message list. Single query, no N+1.
 */
export async function getMessageAuthors(
  messages: Array<{ createdBy?: string | null }>,
): Promise<Record<string, { id: string; name: string }>> {
  const ids = Array.from(
    new Set(
      messages
        .map((m) => m.createdBy)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );
  if (ids.length === 0) return {};
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const map: Record<string, { id: string; name: string }> = {};
  for (const u of users) map[u.id] = { id: u.id, name: u.name };
  return map;
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
      orgId: session.orgId,
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
      orgId: sessionOrgId,
      sessionId,
      userId,
      role: 'contributor',
      addedBy: userId,
    },
  });
}

/**
 * Records the user's last-read position in a session. Validates the message
 * belongs to the session. Returns null if the session is not accessible.
 */
export async function markSessionRead(
  sessionId: string,
  userId: string,
  lastReadMessageId: string,
): Promise<{ sessionId: string; userId: string; lastReadMessageId: string } | null> {
  const accessible = await getSession(sessionId, userId);
  if (!accessible) return null;
  const message = await prisma.chatMessage.findFirst({
    where: { id: lastReadMessageId, sessionId },
    select: { id: true },
  });
  if (!message) return null;
  await prisma.sessionRead.upsert({
    where: { sessionId_userId: { sessionId, userId } },
    update: { lastReadMessageId, lastReadAt: new Date() },
    create: { orgId: accessible.orgId, sessionId, userId, lastReadMessageId, lastReadAt: new Date() },
  });
  return { sessionId, userId, lastReadMessageId };
}

/**
 * Returns the user's last-read message id in a session, if any.
 */
export async function getSessionRead(
  sessionId: string,
  userId: string,
): Promise<string | null> {
  const row = await prisma.sessionRead.findUnique({
    where: { sessionId_userId: { sessionId, userId } },
    select: { lastReadMessageId: true },
  });
  return row?.lastReadMessageId ?? null;
}

/**
 * For every session the user has access to, returns the count of messages
 * created after their last-read marker (or the full message count if no
 * marker exists yet). Excludes the user's own messages.
 */
export async function getUnreadCounts(
  userId: string,
): Promise<Record<string, { unreadCount: number; lastReadMessageId: string | null }>> {
  // Find all session ids the user can see: owner + collaborator + (org-visible
  // sessions in the same org). We keep the same access semantics as getSession.
  const owned = await prisma.chatSession.findMany({
    where: { userId, status: 'active' },
    select: { id: true },
  });
  const collab = await prisma.sessionCollaborator.findMany({
    where: { userId, session: { status: 'active' } },
    select: { sessionId: true },
  });
  const me = await prisma.user.findUnique({
    where: { id: userId },
    include: { team: { select: { orgId: true } } },
  });
  const orgId = me?.team?.orgId;
  const orgVisible = orgId
    ? await prisma.chatSession.findMany({
        where: {
          status: 'active',
          visibility: 'org',
          userId: { not: userId },
          user: { team: { orgId } },
        },
        select: { id: true },
      })
    : [];

  const sessionIds = Array.from(
    new Set([
      ...owned.map((s) => s.id),
      ...collab.map((c) => c.sessionId),
      ...orgVisible.map((s) => s.id),
    ]),
  );
  if (sessionIds.length === 0) return {};

  // Fetch all read markers in one go
  const reads = await prisma.sessionRead.findMany({
    where: { userId, sessionId: { in: sessionIds } },
    select: { sessionId: true, lastReadMessageId: true, lastReadAt: true },
  });
  const readMap = new Map(reads.map((r) => [r.sessionId, r]));

  // Count unread per session in parallel
  const counts = await Promise.all(
    sessionIds.map(async (sessionId) => {
      const r = readMap.get(sessionId);
      const where: Prisma.ChatMessageWhereInput = {
        sessionId,
        // Exclude the user's own messages so they don't count as unread.
        OR: [{ createdBy: null }, { createdBy: { not: userId } }],
      };
      if (r) where.createdAt = { gt: r.lastReadAt };
      const unreadCount = await prisma.chatMessage.count({ where });
      return [sessionId, { unreadCount, lastReadMessageId: r?.lastReadMessageId ?? null }] as const;
    }),
  );

  const out: Record<string, { unreadCount: number; lastReadMessageId: string | null }> = {};
  for (const [id, v] of counts) out[id] = v;
  return out;
}

/**
 * Allowlisted reaction emojis. Keep small and intentional — broad emoji sets
 * encourage noise, and these six cover ack / agree / question / concern.
 */
export const ALLOWED_REACTION_EMOJIS = ['👍', '👎', '✅', '❓', '⚠️', '🎯'] as const;
export type ReactionEmojiAllowed = (typeof ALLOWED_REACTION_EMOJIS)[number];

export function isAllowedReactionEmoji(e: string): e is ReactionEmojiAllowed {
  return (ALLOWED_REACTION_EMOJIS as readonly string[]).includes(e);
}

/**
 * Adds a reaction to a message. Idempotent (unique on message+user+emoji).
 * Returns null if the message doesn't exist or the user can't access it.
 */
export async function addMessageReaction(
  sessionId: string,
  messageId: string,
  userId: string,
  emoji: string,
): Promise<{ messageId: string; userId: string; emoji: string } | null> {
  const accessible = await getSession(sessionId, userId);
  if (!accessible) return null;
  const message = await prisma.chatMessage.findFirst({
    where: { id: messageId, sessionId },
    select: { id: true },
  });
  if (!message) return null;
  await prisma.messageReaction.upsert({
    where: { messageId_userId_emoji: { messageId, userId, emoji } },
    update: {},
    create: { orgId: accessible.orgId, messageId, userId, emoji },
  });
  return { messageId, userId, emoji };
}

/**
 * Removes a reaction. Returns null if not accessible. Returns true if removed.
 */
export async function removeMessageReaction(
  sessionId: string,
  messageId: string,
  userId: string,
  emoji: string,
): Promise<boolean | null> {
  const accessible = await getSession(sessionId, userId);
  if (!accessible) return null;
  const result = await prisma.messageReaction.deleteMany({
    where: { messageId, userId, emoji, message: { sessionId } },
  });
  return result.count > 0;
}

/**
 * Returns reaction summaries grouped by emoji for a list of message ids.
 */
export async function getReactionsForMessages(
  messageIds: string[],
): Promise<Record<string, Array<{ emoji: string; count: number; userIds: string[] }>>> {
  if (messageIds.length === 0) return {};
  const rows = await prisma.messageReaction.findMany({
    where: { messageId: { in: messageIds } },
    select: { messageId: true, emoji: true, userId: true },
    orderBy: { createdAt: 'asc' },
  });
  const out: Record<string, Map<string, { emoji: string; count: number; userIds: string[] }>> = {};
  for (const r of rows) {
    if (!out[r.messageId]) out[r.messageId] = new Map();
    const bucket = out[r.messageId];
    const existing = bucket.get(r.emoji);
    if (existing) {
      existing.count += 1;
      existing.userIds.push(r.userId);
    } else {
      bucket.set(r.emoji, { emoji: r.emoji, count: 1, userIds: [r.userId] });
    }
  }
  const result: Record<string, Array<{ emoji: string; count: number; userIds: string[] }>> = {};
  for (const [mid, bucket] of Object.entries(out)) {
    result[mid] = Array.from(bucket.values());
  }
  return result;
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
 * Promotes a chat message into a Task. Creates the Task with the back-link
 * fields populated, attaches a chat_excerpt context item, and updates the
 * source ChatMessage's `producedTaskIds` array. Idempotent: if the same
 * message already produced a task for this user, returns it with
 * `existing: true`.
 *
 * The caller's userId becomes the task owner — not the session owner.
 */
export async function promoteMessageToTask(input: {
  sessionId: string;
  messageId: string;
  userId: string;
  title: string;
  description?: string;
  attachMessageIds?: string[];
  attachRecentN?: number;
  targetStatus: 'backlog' | 'planning';
  priority?: number;
  provenance: 'chat_button' | 'chat_slash' | 'agent_create' | 'agent_propose_accepted';
}): Promise<{ task: { id: string; title: string; status: string }; existing: boolean; messageCount: number }> {
  const taskService = await import('./task-service.js');
  const contextService = await import('./task-context-service.js');

  // Resolve the session's org (the new task lives in the same org).
  const session = await prisma.chatSession.findUnique({
    where: { id: input.sessionId },
    select: { orgId: true },
  });
  if (!session) throw new Error(`Session ${input.sessionId} not found`);

  // Idempotency: check whether this user already has a task linked to this message.
  const existing = await prisma.task.findFirst({
    where: {
      sourceMessageId: input.messageId,
      userId: input.userId,
    },
    select: { id: true, title: true, status: true },
  });
  if (existing) {
    return {
      task: existing,
      existing: true,
      messageCount: 0,
    };
  }

  const task = await taskService.createTask(session.orgId, input.userId, {
    title: input.title,
    description: input.description,
    source: input.provenance.startsWith('agent') ? 'agent_proposed' : 'chat_user',
    status: input.targetStatus,
    priority: input.priority,
    sourceSessionId: input.sessionId,
    sourceMessageId: input.messageId,
    sourceRef: { kind: 'chat', provenance: input.provenance },
  });

  // Attach the chat slice as a chat_excerpt context item.
  let messageCount = 0;
  try {
    const result = await contextService.attachChatExcerpt(task.id, input.userId, {
      sessionId: input.sessionId,
      anchorMessageId: input.messageId,
      messageIds: input.attachMessageIds,
      recentN: input.attachRecentN,
    });
    messageCount = result.messageCount;
  } catch (err) {
    logger.error({ err, taskId: task.id }, 'attachChatExcerpt failed during promote');
  }

  // Update the originating message's producedTaskIds. Use raw query to
  // append atomically — Prisma doesn't expose array_append cleanly.
  await prisma.$executeRaw`
    UPDATE "chat_messages"
    SET "produced_task_ids" = array_append("produced_task_ids", ${task.id})
    WHERE "id" = ${input.messageId}
  `;

  // For tasks heading straight to execution, post an initial "started"
  // milestone so the chat shows the kanban work is moving.
  if (input.targetStatus === 'planning') {
    await postTaskProgress({
      sessionId: input.sessionId,
      taskId: task.id,
      milestone: 'started',
      taskTitle: task.title,
      taskStatus: task.status,
    }).catch((err) => logger.warn({ err, taskId: task.id }, 'postTaskProgress(started) failed'));
  }

  return {
    task: { id: task.id, title: task.title, status: task.status },
    existing: false,
    messageCount,
  };
}

/**
 * Posts a system-style "task progress" message into the chat session
 * that originated a task. Visible to all collaborators in the session;
 * idempotent on (sessionId, taskId, milestone).
 *
 * The UI renders these as compact progress cards (not regular bubbles)
 * by reading metadata.kind === 'task_progress'.
 */
export async function postTaskProgress(input: {
  sessionId: string;
  taskId: string;
  milestone: 'started' | 'executing' | 'review' | 'done' | 'failed';
  taskTitle: string;
  taskStatus: string;
}): Promise<void> {
  // Resolve session for orgId (also implicit existence check).
  const session = await prisma.chatSession.findUnique({
    where: { id: input.sessionId },
    select: { orgId: true },
  });
  if (!session) return;

  // Idempotency: check whether we've already posted this milestone.
  const existing = await prisma.chatMessage.findFirst({
    where: {
      sessionId: input.sessionId,
      role: 'system',
      metadata: {
        path: ['kind'],
        equals: 'task_progress',
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });
  // Walk recent system messages; skip if same milestone already exists.
  const recent = await prisma.chatMessage.findMany({
    where: { sessionId: input.sessionId, role: 'system' },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { metadata: true },
  });
  for (const r of recent) {
    const m = (r.metadata as Record<string, unknown> | null) ?? {};
    if (
      m.kind === 'task_progress' &&
      m.taskId === input.taskId &&
      m.milestone === input.milestone
    ) {
      return; // already posted
    }
  }
  void existing; // (kept for future consolidation; unused at present)

  const labels: Record<typeof input.milestone, string> = {
    started: 'Task started',
    executing: 'Agent executing',
    review: 'Awaiting review',
    done: 'Task complete',
    failed: 'Task failed',
  };

  const content = `${labels[input.milestone]}: ${input.taskTitle}`;

  await prisma.chatMessage.create({
    data: {
      orgId: session.orgId,
      sessionId: input.sessionId,
      role: 'system',
      content,
      metadata: {
        kind: 'task_progress',
        taskId: input.taskId,
        milestone: input.milestone,
        taskTitle: input.taskTitle,
        taskStatus: input.taskStatus,
      },
    },
  });

  // Push a UI event so subscribers can render without a refetch.
  const { emitToSessionEvent } = await import('../ws/socket-manager.js');
  emitToSessionEvent(input.sessionId, 'task:progress', {
    taskId: input.taskId,
    milestone: input.milestone,
    taskTitle: input.taskTitle,
    taskStatus: input.taskStatus,
  });
}

/**
 * Returns a count of tasks currently in flight (planning or executing)
 * that were promoted from a given chat session AND owned by the caller.
 * Used by the in-chat "N tasks running →" header chip.
 */
export async function countActiveTasksFromSession(
  sessionId: string,
  userId: string,
): Promise<{ count: number; firstTaskId: string | null }> {
  const tasks = await prisma.task.findMany({
    where: {
      sourceSessionId: sessionId,
      userId,
      status: { in: ['planning', 'executing'] },
    },
    select: { id: true },
    orderBy: { updatedAt: 'desc' },
    take: 5,
  });
  return {
    count: tasks.length,
    firstTaskId: tasks[0]?.id ?? null,
  };
}

/**
 * Reverses a chat→task promotion: archives the task and removes its id
 * from the originating message's `producedTaskIds`. Caller must own the
 * task. Returns true on success, false if not found or not owned.
 */
export async function unlinkPromotedTask(input: {
  sessionId: string;
  messageId: string;
  taskId: string;
  userId: string;
}): Promise<boolean> {
  const task = await prisma.task.findFirst({
    where: {
      id: input.taskId,
      userId: input.userId,
      sourceMessageId: input.messageId,
      sourceSessionId: input.sessionId,
    },
    select: { id: true },
  });
  if (!task) return false;

  await prisma.$transaction([
    prisma.task.update({
      where: { id: task.id },
      data: { status: 'archived' },
    }),
    prisma.$executeRaw`
      UPDATE "chat_messages"
      SET "produced_task_ids" = array_remove("produced_task_ids", ${task.id})
      WHERE "id" = ${input.messageId}
    `,
  ]);
  return true;
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
