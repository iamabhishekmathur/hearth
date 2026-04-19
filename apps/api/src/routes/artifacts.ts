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
