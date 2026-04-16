import { Router } from 'express';
import type { LLMMessage, SessionVisibility } from '@hearth/shared';
import { requireAuth } from '../middleware/auth.js';
import * as chatService from '../services/chat-service.js';
import { buildAgentContext } from '../agent/context-builder.js';
import { agentLoop } from '../agent/agent-runtime.js';
import { emitToSession, emitToUser } from '../ws/socket-manager.js';
import { logger } from '../lib/logger.js';

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
    res.json({ data: session });
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
    const { content, model, providerId } = req.body as {
      content?: string;
      model?: string;
      providerId?: string;
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

    // Auto-title: if the session has no title, derive one from the first message (owner only)
    if (!session.title && access === 'owner') {
      const title = deriveSessionTitle(content);
      await chatService.updateSessionTitle(sessionId, userId, title);
    }

    // Respond immediately with 202
    res.status(202).json({ data: { messageId: userMessage.id } });

    // Build agent context and run the agent loop asynchronously.
    runAgent(sessionId, session.userId, model, providerId, content).catch((err) => {
      logger.error({ err, sessionId }, 'Agent loop unhandled error');
    });
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

    // Notify the added user via WebSocket
    const session = await chatService.getSession(sessionId, req.user!.id);
    emitToUser(userId, 'collaborator:added', {
      sessionId,
      sessionTitle: session?.title ?? null,
      addedByName: req.user!.name ?? 'Someone',
      role: validRole,
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
): Promise<void> {
  let assistantContent = '';
  let errorMessage: string | null = null;
  let sawErrorEvent = false;

  try {
    const context = await buildAgentContext(ownerUserId, sessionId, latestMessage);
    if (model) context.model = model;
    if (providerId) context.providerId = providerId;

    // Load conversation history — skip tool-role messages (providers reject
    // them without matching tool_use_id linkage from the original call).
    const dbMessages = await chatService.getMessages(sessionId);
    const messages: LLMMessage[] = dbMessages
      .filter((m) => m.role !== 'tool')
      .map((m) => ({
        role: m.role as LLMMessage['role'],
        content: m.content,
      }));

    for await (const event of agentLoop(context, messages)) {
      emitToSession(sessionId, event);

      if (event.type === 'text_delta') {
        assistantContent += event.content;
      } else if (event.type === 'error') {
        sawErrorEvent = true;
        errorMessage = event.message;
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

        await chatService.addMessage(sessionId, 'assistant', finalContent, {
          error: errorMessage ?? undefined,
          errorSource: sawErrorEvent ? 'llm' : errorMessage ? 'runtime' : undefined,
        });
      }
    } catch (persistErr) {
      logger.error({ err: persistErr, sessionId }, 'Failed to persist assistant message');
    }
  }
}

export default router;
