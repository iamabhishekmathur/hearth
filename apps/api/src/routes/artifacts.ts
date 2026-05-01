import { Router } from 'express';
import type { ArtifactType } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import * as chatService from '../services/chat-service.js';
import * as artifactService from '../services/artifact-service.js';
import { emitToSessionEvent } from '../ws/socket-manager.js';

const router: ReturnType<typeof Router> = Router();

const VALID_ARTIFACT_TYPES: ArtifactType[] = [
  'code',
  'document',
  'diagram',
  'table',
  'html',
  'image',
];

/**
 * POST /sessions/:sessionId/artifacts — create an artifact in a session
 */
router.post('/sessions/:sessionId/artifacts', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.sessionId as string;

    // Verify session access
    const session = await chatService.getSession(sessionId, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { type, title, content, language, parentMessageId } = req.body as {
      type?: string;
      title?: string;
      content?: string;
      language?: string;
      parentMessageId?: string;
    };

    if (!type || !VALID_ARTIFACT_TYPES.includes(type as ArtifactType)) {
      res.status(400).json({ error: `type must be one of: ${VALID_ARTIFACT_TYPES.join(', ')}` });
      return;
    }
    if (!title?.trim()) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const artifact = await artifactService.createArtifact({
      sessionId,
      type: type as ArtifactType,
      title: title.trim(),
      content,
      language,
      createdBy: req.user!.id,
      parentMessageId,
    });

    emitToSessionEvent(sessionId, 'artifact:created', artifact as unknown as Record<string, unknown>);

    res.status(201).json({ data: artifact });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /sessions/:sessionId/artifacts — list artifacts for a session
 */
router.get('/sessions/:sessionId/artifacts', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.sessionId as string;

    // Verify session access
    const session = await chatService.getSession(sessionId, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const artifacts = await artifactService.listArtifacts(sessionId);
    res.json({ data: artifacts });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /artifacts/:id — get a single artifact
 */
router.get('/artifacts/:id', requireAuth, async (req, res, next) => {
  try {
    const artifact = await artifactService.getArtifact(req.params.id as string);
    if (!artifact) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }

    // Verify session access
    const session = await chatService.getSession(artifact.sessionId, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }

    res.json({ data: artifact });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /artifacts/:id/promote-to-task — promote an artifact (and its
 * source chat exchange) into a task. Attaches the artifact's content
 * as a `text_block` context item in addition to the chat excerpt.
 */
router.post('/artifacts/:id/promote-to-task', requireAuth, async (req, res, next) => {
  try {
    const artifactId = req.params.id as string;
    const artifact = await artifactService.getArtifact(artifactId);
    if (!artifact) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }
    const session = await chatService.getSession(artifact.sessionId, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }
    const { title, description, targetStatus, priority } = req.body as {
      title?: string;
      description?: string;
      targetStatus?: 'backlog' | 'planning';
      priority?: number;
    };

    // Anchor message: the artifact's parent message if known, else the
    // most recent message in the session.
    const { prisma } = await import('../lib/prisma.js');
    const anchor = artifact.parentMessageId
      ? await prisma.chatMessage.findFirst({
          where: { id: artifact.parentMessageId, sessionId: artifact.sessionId },
          select: { id: true },
        })
      : await prisma.chatMessage.findFirst({
          where: { sessionId: artifact.sessionId },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
    if (!anchor) {
      res.status(400).json({ error: 'Cannot anchor task: no message in session' });
      return;
    }

    // Promote with the artifact's title as the default task title.
    const result = await chatService.promoteMessageToTask({
      sessionId: artifact.sessionId,
      messageId: anchor.id,
      userId: req.user!.id,
      title: title?.trim() || `Ship: ${artifact.title}`,
      description: description?.trim() || undefined,
      attachRecentN: 4,
      targetStatus: targetStatus === 'planning' ? 'planning' : 'backlog',
      priority,
      provenance: 'chat_button',
    });

    // Attach the artifact content as a text_block context item so the
    // planning agent can reference it directly (in addition to the
    // chat_excerpt that promoteMessageToTask already attached).
    if (!result.existing) {
      const contextService = await import('../services/task-context-service.js');
      try {
        await contextService.createContextItem(result.task.id, req.user!.id, {
          type: 'text_block',
          rawValue: artifact.content,
          label: `Artifact: ${artifact.title}`,
          extractedTitle: artifact.title,
        });
      } catch (err) {
        // Non-fatal — chat excerpt is already attached.
      }
    }

    if (!result.existing && targetStatus === 'planning') {
      const { enqueuePlanning } = await import('../services/task-planner.js');
      enqueuePlanning(result.task.id, req.user!.id).catch(() => { /* best-effort */ });
    }

    const { emitToUser } = await import('../ws/socket-manager.js');
    emitToUser(req.user!.id, 'task:created_from_chat', {
      taskId: result.task.id,
      title: result.task.title,
      status: result.task.status,
      sessionId: artifact.sessionId,
      originatingMessageId: anchor.id,
      messageCount: result.messageCount,
      existing: result.existing,
    });

    res.status(result.existing ? 200 : 201).json({
      data: { ...result.task, existing: result.existing, messageCount: result.messageCount },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /artifacts/:id — update an artifact
 */
router.patch('/artifacts/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await artifactService.getArtifact(req.params.id as string);
    if (!existing) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }

    // Verify session access
    const session = await chatService.getSession(existing.sessionId, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }

    const { title, content, language } = req.body as {
      title?: string;
      content?: string;
      language?: string;
    };

    const artifact = await artifactService.updateArtifact({
      artifactId: existing.id,
      title: title?.trim(),
      content,
      language,
      editedBy: req.user!.id,
    });

    if (!artifact) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }

    emitToSessionEvent(existing.sessionId, 'artifact:updated', artifact as unknown as Record<string, unknown>);

    res.json({ data: artifact });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /artifacts/:id — delete an artifact
 */
router.delete('/artifacts/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await artifactService.getArtifact(req.params.id as string);
    if (!existing) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }

    // Verify session access
    const session = await chatService.getSession(existing.sessionId, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }

    await artifactService.deleteArtifact(existing.id);

    emitToSessionEvent(existing.sessionId, 'artifact:deleted', { artifactId: existing.id });

    res.json({ message: 'Artifact deleted' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /artifacts/:id/versions — get version history for an artifact
 */
router.get('/artifacts/:id/versions', requireAuth, async (req, res, next) => {
  try {
    const existing = await artifactService.getArtifact(req.params.id as string);
    if (!existing) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }

    // Verify session access
    const session = await chatService.getSession(existing.sessionId, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }

    const versions = await artifactService.getArtifactVersions(existing.id);
    res.json({ data: versions });
  } catch (err) {
    next(err);
  }
});

export default router;
