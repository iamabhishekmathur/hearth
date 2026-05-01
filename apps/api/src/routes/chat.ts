import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentPart, LLMMessage, SessionVisibility } from '@hearth/shared';
import { requireAuth } from '../middleware/auth.js';
import * as chatService from '../services/chat-service.js';
import { buildAgentContext } from '../agent/context-builder.js';
import { agentLoop } from '../agent/agent-runtime.js';
import { emitToSession, emitToUser, emitToSessionEvent } from '../ws/socket-manager.js';
import { logger } from '../lib/logger.js';
import { evaluateMessage, getGovernanceSettings, hasBlockPolicies } from '../services/governance-service.js';
import { reflectOnSession } from '../services/experience-service.js';
import { notify } from '../services/notification-service.js';
import { enqueueCognitiveExtraction } from '../jobs/cognitive-extraction-scheduler.js';
import {
  isCognitiveEnabledForOrg,
  getCognitiveEnabled,
  setCognitiveEnabled,
} from '../services/cognitive-profile-service.js';

const router: ReturnType<typeof Router> = Router();

/**
 * POST /sessions — create a new chat session
 */
router.post('/sessions', requireAuth, async (req, res, next) => {
  try {
    const { title } = req.body as { title?: string };
    const session = await chatService.createSession(req.user!.id, title);
    res.status(201).json({ data: session });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /sessions — list current user's active sessions
 */
router.get('/sessions', requireAuth, async (req, res, next) => {
  try {
    const sessions = await chatService.listSessions(req.user!.id);
    res.json({ data: sessions });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /sessions/shared — list org-shared sessions visible to the user
 */
router.get('/sessions/shared', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.json({ data: [] });
      return;
    }
    const sessions = await chatService.listSharedSessions(req.user!.id, orgId);
    res.json({ data: sessions });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /sessions/unread-counts — per-session unread count for the current user
 */
router.get('/sessions/unread-counts', requireAuth, async (req, res, next) => {
  try {
    const counts = await chatService.getUnreadCounts(req.user!.id);
    res.json({ data: counts });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /sessions/:id — get session with messages (verify ownership, collab, or org-visible)
 */
router.get('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const session = await chatService.getSession(id, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    // Transform attachment storagePath -> url for the API response
    const reactionMap = await chatService.getReactionsForMessages(session.messages.map((m) => m.id));
    const messages = session.messages.map((msg) => ({
      ...msg,
      attachments: (msg.attachments ?? []).map(chatService.toAttachmentResponse),
      reactions: reactionMap[msg.id] ?? [],
    }));
    const messageAuthors = await chatService.getMessageAuthors(messages);
    const lastReadMessageId = await chatService.getSessionRead(id, req.user!.id);
    res.json({ data: { ...session, messages, messageAuthors, lastReadMessageId } });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /sessions/:id — rename a session
 */
router.patch('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const { title } = req.body as { title?: string };
    if (!title?.trim()) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const session = await chatService.updateSessionTitle(id, req.user!.id, title.trim());
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ data: session });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /sessions/:id/visibility — toggle org visibility
 */
router.patch('/sessions/:id/visibility', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const { visibility } = req.body as { visibility?: SessionVisibility };
    if (!visibility || !['private', 'org'].includes(visibility)) {
      res.status(400).json({ error: 'visibility must be "private" or "org"' });
      return;
    }
    const session = await chatService.setVisibility(id, req.user!.id, visibility);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ data: session });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /sessions/:id — archive a session
 */
router.delete('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const session = await chatService.archiveSession(id, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ data: session, message: 'Session archived' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:id/messages — send a message and trigger the agent
 * Allows owner or contributor collaborators to send messages.
 */
router.post('/sessions/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.id as string;
    const userId = req.user!.id;
    const { content, model, providerId, activeArtifactId, attachmentIds, cognitiveQuery, timezone } = req.body as {
      content?: string;
      model?: string;
      providerId?: string;
      activeArtifactId?: string;
      attachmentIds?: string[];
      cognitiveQuery?: { subjectUserId: string };
      timezone?: string;
    };

    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    // Check write access (owner or contributor)
    const access = await chatService.getSessionWriteAccess(sessionId, userId);
    if (!access) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Load session for title check
    const session = await chatService.getSession(sessionId, userId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Save the user message with attribution
    const userMessage = await chatService.addMessage(sessionId, 'user', content, undefined, userId);

    // Link uploaded attachments to this message
    if (attachmentIds && attachmentIds.length > 0) {
      await chatService.linkAttachments(userMessage.id, attachmentIds);
    }

    // Auto-title: if the session has no title, derive one from the first message (owner only)
    if (!session.title && access === 'owner') {
      const title = deriveSessionTitle(content);
      await chatService.updateSessionTitle(sessionId, userId, title);
    }

    // Governance compliance check
    const orgId = req.user!.orgId;
    if (orgId) {
      const settings = await getGovernanceSettings(orgId);
      if (settings.enabled && settings.checkUserMessages) {
        const blocking = await hasBlockPolicies(orgId);

        if (blocking) {
          // Synchronous check — must complete before sending to LLM
          const violations = await evaluateMessage({
            orgId, userId, sessionId,
            messageId: userMessage.id, messageRole: 'user', content,
          });

          const blocked = violations.find(v => v.enforcement === 'block');
          if (blocked) {
            emitToSessionEvent(sessionId, 'governance:blocked', {
              messageId: userMessage.id,
              policyName: blocked.policyName,
              severity: blocked.severity,
              reason: `This message was blocked by the "${blocked.policyName}" governance policy.`,
            });
            res.status(403).json({
              error: 'Message blocked by governance policy',
              data: { policyName: blocked.policyName, severity: blocked.severity },
            });
            return;
          }
        } else {
          // No blocking policies — fire-and-forget
          evaluateMessage({
            orgId, userId, sessionId,
            messageId: userMessage.id, messageRole: 'user', content,
          }).catch(err => logger.error({ err }, 'Governance evaluation failed'));
        }
      }
    }

    // Respond immediately with 202
    res.status(202).json({ data: { messageId: userMessage.id } });

    // Build agent context and run the agent loop asynchronously.
    runAgent(sessionId, session.userId, model, providerId, content, activeArtifactId, cognitiveQuery?.subjectUserId, timezone, userMessage.id).catch((err) => {
      logger.error({ err, sessionId }, 'Agent loop unhandled error');
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:id/read — mark a message as read for the current user
 */
router.post('/sessions/:id/read', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.id as string;
    const { lastMessageId } = req.body as { lastMessageId?: string };
    if (!lastMessageId) {
      res.status(400).json({ error: 'lastMessageId is required' });
      return;
    }
    const result = await chatService.markSessionRead(sessionId, req.user!.id, lastMessageId);
    if (!result) {
      res.status(404).json({ error: 'Session or message not found' });
      return;
    }
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:id/messages/:messageId/reactions — add a reaction
 */
router.post('/sessions/:id/messages/:messageId/reactions', requireAuth, async (req, res, next) => {
  try {
    const { emoji } = req.body as { emoji?: string };
    if (!emoji || !chatService.isAllowedReactionEmoji(emoji)) {
      res.status(400).json({ error: 'emoji must be one of the allowed reactions' });
      return;
    }
    const sessionId = req.params.id as string;
    const messageId = req.params.messageId as string;
    const result = await chatService.addMessageReaction(sessionId, messageId, req.user!.id, emoji);
    if (!result) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    emitToSessionEvent(sessionId, 'message:reaction', {
      messageId,
      userId: req.user!.id,
      emoji,
      op: 'add',
    });
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /sessions/:id/messages/:messageId/reactions/:emoji — remove a reaction
 */
router.delete('/sessions/:id/messages/:messageId/reactions/:emoji', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.id as string;
    const messageId = req.params.messageId as string;
    const emoji = decodeURIComponent(req.params.emoji as string);
    const result = await chatService.removeMessageReaction(sessionId, messageId, req.user!.id, emoji);
    if (result === null) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (result) {
      emitToSessionEvent(sessionId, 'message:reaction', {
        messageId,
        userId: req.user!.id,
        emoji,
        op: 'remove',
      });
    }
    res.json({ data: { messageId, emoji, removed: result } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:id/messages/:messageId/feedback — rate a message
 */
router.post('/sessions/:id/messages/:messageId/feedback', requireAuth, async (req, res, next) => {
  try {
    const { rating } = req.body as { rating?: 'positive' | 'negative' };
    if (!rating || !['positive', 'negative'].includes(rating)) {
      res.status(400).json({ error: 'rating must be "positive" or "negative"' });
      return;
    }
    const messageId = req.params.messageId as string;
    const { prisma } = await import('../lib/prisma.js');
    const message = await prisma.chatMessage.findFirst({
      where: { id: messageId, session: { id: req.params.id as string } },
    });
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    const metadata = (message.metadata as Record<string, unknown>) ?? {};
    await prisma.chatMessage.update({
      where: { id: messageId },
      data: { metadata: { ...metadata, feedback: rating } as never },
    });
    res.json({ data: { messageId, rating } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:id/join — join an org-visible session as a contributor
 */
router.post('/sessions/:id/join', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.id as string;
    const result = await chatService.joinSession(sessionId, req.user!.id);
    if (!result) {
      res.status(404).json({ error: 'Session not found or not accessible' });
      return;
    }
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /sessions/:id/collaborators — list collaborators
 */
router.get('/sessions/:id/collaborators', requireAuth, async (req, res, next) => {
  try {
    const collaborators = await chatService.listCollaborators(req.params.id as string);
    res.json({ data: collaborators });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:id/collaborators — add a collaborator
 */
router.post('/sessions/:id/collaborators', requireAuth, async (req, res, next) => {
  try {
    const { userId, role } = req.body as { userId?: string; role?: string };
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    const validRole = role === 'contributor' ? 'contributor' : 'viewer';
    const sessionId = req.params.id as string;
    const result = await chatService.addCollaborator(
      sessionId,
      req.user!.id,
      userId,
      validRole,
    );
    if (!result) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Notify the added user via WebSocket (legacy ephemeral event for any
    // existing client listeners) and persist via the notification spine.
    const session = await chatService.getSession(sessionId, req.user!.id);
    emitToUser(userId, 'collaborator:added', {
      sessionId,
      sessionTitle: session?.title ?? null,
      addedByName: req.user!.name ?? 'Someone',
      role: validRole,
    });
    void notify({
      userId,
      type: 'collaborator_added',
      title: `${req.user!.name ?? 'Someone'} added you to a chat`,
      body: session?.title ?? 'Untitled chat',
      sessionId,
      entityType: 'chat_session',
      entityId: sessionId,
    });

    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /sessions/:id/collaborators/:userId — remove a collaborator
 */
router.delete('/sessions/:id/collaborators/:userId', requireAuth, async (req, res, next) => {
  try {
    const result = await chatService.removeCollaborator(
      req.params.id as string,
      req.user!.id,
      req.params.userId as string,
    );
    if (!result) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ message: 'Collaborator removed' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:sessionId/messages/:messageId/promote-to-task
 * — explicit user-initiated chat→task creation. Idempotent on (messageId, user).
 */
router.post('/sessions/:sessionId/messages/:messageId/promote-to-task', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.sessionId as string;
    const messageId = req.params.messageId as string;
    const {
      title,
      description,
      attachMessageIds,
      attachRecentN,
      targetStatus,
      priority,
      provenance,
    } = req.body as {
      title?: string;
      description?: string;
      attachMessageIds?: string[];
      attachRecentN?: number;
      targetStatus?: 'backlog' | 'planning';
      priority?: number;
      provenance?: 'chat_button' | 'chat_slash' | 'agent_create' | 'agent_propose_accepted';
    };

    // Permission: caller must have read access to the session.
    const session = await chatService.getSession(sessionId, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Validate the message belongs to this session.
    const { prisma } = await import('../lib/prisma.js');
    const message = await prisma.chatMessage.findFirst({
      where: { id: messageId, sessionId },
      select: { id: true, content: true },
    });
    if (!message) {
      res.status(404).json({ error: 'Message not found in session' });
      return;
    }

    // Synthesise title/description if omitted (best-effort; falls back to content).
    let finalTitle = title?.trim();
    let finalDescription = description?.trim();
    if (!finalTitle) {
      finalTitle = message.content.slice(0, 80).replace(/\s+/g, ' ').trim() || 'New task';
    }
    if (!finalDescription) {
      finalDescription = message.content.length > 80 ? message.content : undefined;
    }

    const result = await chatService.promoteMessageToTask({
      sessionId,
      messageId,
      userId: req.user!.id,
      title: finalTitle,
      description: finalDescription,
      attachMessageIds,
      attachRecentN: attachRecentN ?? 4,
      targetStatus: targetStatus === 'planning' ? 'planning' : 'backlog',
      priority,
      provenance: provenance ?? 'chat_button',
    });

    // If targetStatus = 'planning', enqueue the planner so it auto-progresses.
    if (!result.existing && targetStatus === 'planning') {
      const { enqueuePlanning } = await import('../services/task-planner.js');
      enqueuePlanning(result.task.id, req.user!.id).catch((err) => {
        logger.error({ err, taskId: result.task.id }, 'Failed to enqueue planning for promoted task');
      });
    }

    // Notify the creator's chat UI (so the chip can render under the message).
    emitToUser(req.user!.id, 'task:created_from_chat', {
      taskId: result.task.id,
      title: result.task.title,
      status: result.task.status,
      sessionId,
      originatingMessageId: messageId,
      messageCount: result.messageCount,
      existing: result.existing,
    });

    res.status(result.existing ? 200 : 201).json({
      data: {
        ...result.task,
        existing: result.existing,
        messageCount: result.messageCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /sessions/:sessionId/active-tasks
 * — count of in-flight tasks (planning + executing) promoted from this session.
 */
router.get('/sessions/:sessionId/active-tasks', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.sessionId as string;
    const session = await chatService.getSession(sessionId, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const summary = await chatService.countActiveTasksFromSession(sessionId, req.user!.id);
    res.json({ data: summary });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:sessionId/messages/:messageId/tasks/:taskId/unlink
 * — undo a chat→task promotion: archives the task and de-links it from
 * the message. Caller must own the task.
 */
router.post('/sessions/:sessionId/messages/:messageId/tasks/:taskId/unlink', requireAuth, async (req, res, next) => {
  try {
    const ok = await chatService.unlinkPromotedTask({
      sessionId: req.params.sessionId as string,
      messageId: req.params.messageId as string,
      taskId: req.params.taskId as string,
      userId: req.user!.id,
    });
    if (!ok) {
      res.status(404).json({ error: 'Task not found or not owned by you' });
      return;
    }
    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /users/search — search org members for collaborator autocomplete
 */
router.get('/users/search', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.json({ data: [] });
      return;
    }
    const q = (req.query.q as string) || '';
    if (q.length < 2) {
      res.json({ data: [] });
      return;
    }
    const users = await chatService.searchOrgMembers(orgId, q, req.user!.id);
    res.json({ data: users });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /integrations/active — list connected integration IDs
 */
router.get('/integrations/active', requireAuth, async (_req, res, next) => {
  try {
    const { mcpGateway } = await import('../mcp/gateway.js');
    const integrations = mcpGateway.getConnectedIntegrations();
    res.json({ data: integrations });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /cognitive-profile/status — get user's cognitive profile opt-in status
 */
router.get('/cognitive-profile/status', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.json({ data: { orgEnabled: false, userEnabled: false } });
      return;
    }
    const orgEnabled = await isCognitiveEnabledForOrg(orgId);
    const userEnabled = orgEnabled ? await getCognitiveEnabled(req.user!.id, orgId) : false;
    res.json({ data: { orgEnabled, userEnabled } });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /cognitive-profile/status — toggle user's cognitive profile opt-in/out
 */
router.put('/cognitive-profile/status', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.status(400).json({ error: 'No organization context' });
      return;
    }
    const orgEnabled = await isCognitiveEnabledForOrg(orgId);
    if (!orgEnabled) {
      res.status(400).json({ error: 'Cognitive profiles are not enabled for this organization' });
      return;
    }
    const { enabled } = req.body as { enabled?: boolean };
    await setCognitiveEnabled(req.user!.id, orgId, !!enabled);
    res.json({ message: 'Cognitive profile status updated' });
  } catch (err) {
    next(err);
  }
});

/**
 * Derives a short session title from the first user message.
 * Truncates to 60 chars at a word boundary.
 */
function deriveSessionTitle(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= 60) return oneLine;
  const cut = oneLine.slice(0, 60);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + '…';
}

/**
 * Runs the agent loop for a session, emitting events via WebSocket
 * and saving the final assistant message. On error, persists an
 * assistant message describing the failure and emits an error event.
 */
async function runAgent(
  sessionId: string,
  ownerUserId: string,
  model?: string,
  providerId?: string,
  latestMessage?: string,
  activeArtifactId?: string,
  cognitiveQuerySubjectId?: string,
  timezone?: string,
  respondingToMessageId?: string,
): Promise<void> {
  let assistantContent = '';
  let errorMessage: string | null = null;
  let sawErrorEvent = false;
  const startTime = Date.now();
  let iterationCount = 0;
  let totalTokens = 0;
  const toolFailures: string[] = [];
  let contextSources: Array<{ index: number; type: string; label: string; content: string }> = [];

  try {
    const context = await buildAgentContext(ownerUserId, sessionId, latestMessage, activeArtifactId, {
      cognitiveQuerySubjectId,
      timezone,
    });
    if (model) context.model = model;
    if (providerId) context.providerId = providerId;
    contextSources = context.sources ?? [];

    // Emit memory debug info for dev/debug tools
    if (contextSources.length > 0) {
      emitToSessionEvent(sessionId, 'memory:debug', {
        sources: contextSources,
        rollingSummary: null,
        timestamp: new Date().toISOString(),
      });
    }

    // Load conversation history — skip tool-role messages (providers reject
    // them without matching tool_use_id linkage from the original call).
    const dbMessages = await chatService.getMessages(sessionId);
    const messages: LLMMessage[] = dbMessages
      .filter((m) => {
        if (m.role === 'tool') return false;
        // Skip task-progress system messages — they're UI-only.
        if (m.role === 'system') {
          const meta = (m.metadata as Record<string, unknown> | null) ?? {};
          if (meta.kind === 'task_progress') return false;
        }
        return true;
      })
      .map((m) => {
        // Check for image attachments on this message
        const imageAttachments = (m.attachments ?? []).filter(
          (a) => a.mimeType.startsWith('image/'),
        );

        if (imageAttachments.length > 0 && m.role === 'user' && context.visionEnabled !== false) {
          // Build multimodal content with images + text
          const parts: ContentPart[] = [];

          for (const att of imageAttachments) {
            try {
              const filePath = join(process.cwd(), att.storagePath);
              const buffer = readFileSync(filePath);
              parts.push({
                type: 'image',
                mimeType: att.mimeType,
                data: buffer.toString('base64'),
              });
            } catch {
              // Skip unreadable attachments
            }
          }

          if (m.content) {
            parts.push({ type: 'text', text: m.content });
          }

          return {
            role: m.role as LLMMessage['role'],
            content: parts.length > 0 ? parts : m.content,
          };
        }

        return {
          role: m.role as LLMMessage['role'],
          content: m.content,
        };
      });

    // Rolling summary: if conversation is long, summarize older messages
    const rawForSummary = dbMessages
      .filter((m) => {
        if (m.role === 'tool') return false;
        // Skip task-progress system messages — they're UI-only.
        if (m.role === 'system') {
          const meta = (m.metadata as Record<string, unknown> | null) ?? {};
          if (meta.kind === 'task_progress') return false;
        }
        return true;
      })
      .map((m) => ({ role: m.role, content: m.content }));
    const rollingSummary = await chatService.summarizeEarlierMessages(rawForSummary);

    let finalMessages = messages;
    if (rollingSummary) {
      // Keep only the last 10 messages, prepend summary as a system message
      const keepRecent = 10;
      finalMessages = messages.slice(Math.max(0, messages.length - keepRecent));
      // Inject summary into the agent context for system prompt
      context.rollingSummary = rollingSummary;
    }

    for await (const event of agentLoop(context, finalMessages)) {
      emitToSession(sessionId, event);

      if (event.type === 'text_delta') {
        assistantContent += event.content;
      } else if (event.type === 'error') {
        sawErrorEvent = true;
        errorMessage = event.message;
      } else if (event.type === 'done') {
        totalTokens += (event.usage?.inputTokens ?? 0) + (event.usage?.outputTokens ?? 0);
        iterationCount++;
      } else if (event.type === 'tool_progress' && event.status === 'failed') {
        toolFailures.push(event.toolName);
      }
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Agent execution failed';
    logger.error({ err, sessionId }, 'Agent loop threw');
    emitToSession(sessionId, {
      type: 'error',
      message: 'Agent encountered an unexpected error',
    });
  } finally {
    // Always persist whatever was produced. If there was an error, append
    // a note so the user sees context on page refresh.
    try {
      if (assistantContent || errorMessage) {
        const finalContent = errorMessage
          ? assistantContent
            ? `${assistantContent}\n\n_[Error: ${errorMessage}]_`
            : `_[Error: ${errorMessage}]_`
          : assistantContent;

        await chatService.addMessage(
          sessionId,
          'assistant',
          finalContent,
          {
            error: errorMessage ?? undefined,
            errorSource: sawErrorEvent ? 'llm' : errorMessage ? 'runtime' : undefined,
            sources: contextSources.length > 0 ? contextSources : undefined,
          },
          undefined,
          respondingToMessageId,
        );
      }
    } catch (persistErr) {
      logger.error({ err: persistErr, sessionId }, 'Failed to persist assistant message');
    }

    // Phase 2: Governance check on AI response
    if (assistantContent && !errorMessage) {
      try {
        const session = await chatService.getSession(sessionId, ownerUserId);
        if (session) {
          // Look up user's org
          const { prisma } = await import('../lib/prisma.js');
          const owner = await prisma.user.findUnique({
            where: { id: ownerUserId },
            include: { team: { select: { orgId: true } } },
          });
          const orgId = owner?.team?.orgId;
          if (orgId) {
            evaluateMessage({
              orgId, userId: ownerUserId, sessionId,
              messageId: `assistant_${Date.now()}`, messageRole: 'assistant',
              content: assistantContent,
            }).catch(err => logger.error({ err }, 'Governance check on AI response failed'));
          }
        }
      } catch (govErr) {
        logger.error({ err: govErr }, 'Governance AI response check setup failed');
      }
    }

    // Post-session reflection — fire-and-forget
    const durationMs = Date.now() - startTime;
    const user = await (async () => {
      try {
        const { prisma } = await import('../lib/prisma.js');
        const u = await prisma.user.findUnique({
          where: { id: ownerUserId },
          include: { team: { select: { orgId: true } } },
        });
        return u;
      } catch { return null; }
    })();
    const orgIdForReflection = user?.team?.orgId;
    if (orgIdForReflection) {
      reflectOnSession({
        sessionId,
        userId: ownerUserId,
        orgId: orgIdForReflection,
        durationMs,
        iterationCount,
        tokenCount: totalTokens || undefined,
        toolFailures: toolFailures.length > 0 ? toolFailures : undefined,
      }).catch(err => logger.error({ err, sessionId }, 'Post-session reflection failed'));

      // Cognitive pattern extraction — gated behind org setting
      isCognitiveEnabledForOrg(orgIdForReflection).then(enabled => {
        if (enabled) {
          enqueueCognitiveExtraction({
            sessionId,
            userId: ownerUserId,
            orgId: orgIdForReflection,
          }).catch(err => logger.error({ err, sessionId }, 'Cognitive extraction enqueue failed'));
        }
      }).catch(err => logger.error({ err }, 'Cognitive org check failed'));
    }
  }
}

export default router;
