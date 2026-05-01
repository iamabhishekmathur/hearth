import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import * as chatService from '../services/chat-service.js';
import { emitToUser, emitToSessionEvent } from '../ws/socket-manager.js';
import { logger } from '../lib/logger.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET / — list pending task suggestions for the current user.
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const status = (req.query.status as string) || 'pending';
    const items = await prisma.taskSuggestion.findMany({
      where: { userId: req.user!.id, status },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ data: items });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /:id/accept — accept a suggestion → create the real task.
 */
router.post('/:id/accept', requireAuth, async (req, res, next) => {
  try {
    const suggestion = await prisma.taskSuggestion.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id },
    });
    if (!suggestion) {
      res.status(404).json({ error: 'Suggestion not found' });
      return;
    }
    if (suggestion.status !== 'pending') {
      res.status(409).json({ error: 'Suggestion already resolved' });
      return;
    }

    const { targetStatus, title, description } = req.body as {
      targetStatus?: 'backlog' | 'planning';
      title?: string;
      description?: string;
    };

    const attachIds = Array.isArray(suggestion.suggestedContextMessageIds)
      ? (suggestion.suggestedContextMessageIds as string[])
      : [];

    const result = await chatService.promoteMessageToTask({
      sessionId: suggestion.sessionId,
      messageId: suggestion.messageId,
      userId: req.user!.id,
      title: title?.trim() || suggestion.proposedTitle,
      description: description?.trim() || suggestion.proposedDescription || undefined,
      attachMessageIds: attachIds.length > 0 ? attachIds : undefined,
      targetStatus: targetStatus === 'planning' ? 'planning' : 'backlog',
      provenance: 'agent_propose_accepted',
    });

    await prisma.taskSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: 'accepted',
        acceptedTaskId: result.task.id,
        resolvedAt: new Date(),
      },
    });

    if (!result.existing && targetStatus === 'planning') {
      const { enqueuePlanning } = await import('../services/task-planner.js');
      enqueuePlanning(result.task.id, req.user!.id).catch((err) => {
        logger.error({ err, taskId: result.task.id }, 'Failed to enqueue planning for accepted suggestion');
      });
    }

    emitToUser(req.user!.id, 'task:created_from_chat', {
      taskId: result.task.id,
      title: result.task.title,
      status: result.task.status,
      sessionId: suggestion.sessionId,
      originatingMessageId: suggestion.messageId,
      messageCount: result.messageCount,
      existing: result.existing,
    });
    emitToSessionEvent(suggestion.sessionId, 'task:suggestion_resolved', {
      suggestionId: suggestion.id,
      status: 'accepted',
      acceptedTaskId: result.task.id,
    });

    res.status(201).json({ data: { suggestionId: suggestion.id, task: result.task } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /:id/dismiss — dismiss a suggestion without creating a task.
 */
router.post('/:id/dismiss', requireAuth, async (req, res, next) => {
  try {
    const suggestion = await prisma.taskSuggestion.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id },
    });
    if (!suggestion) {
      res.status(404).json({ error: 'Suggestion not found' });
      return;
    }
    if (suggestion.status !== 'pending') {
      res.status(409).json({ error: 'Suggestion already resolved' });
      return;
    }
    await prisma.taskSuggestion.update({
      where: { id: suggestion.id },
      data: { status: 'dismissed', resolvedAt: new Date() },
    });
    emitToSessionEvent(suggestion.sessionId, 'task:suggestion_resolved', {
      suggestionId: suggestion.id,
      status: 'dismissed',
    });
    res.json({ data: { suggestionId: suggestion.id, status: 'dismissed' } });
  } catch (err) {
    next(err);
  }
});

export default router;
