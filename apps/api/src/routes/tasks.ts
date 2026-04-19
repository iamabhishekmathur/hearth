import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { TaskStatus, TaskSource, TaskContextItemType, ReviewDecision } from '@hearth/shared';
import { requireAuth } from '../middleware/auth.js';
import * as taskService from '../services/task-service.js';
import * as contextService from '../services/task-context-service.js';
import { enqueueExtraction } from '../jobs/task-context-extraction-job.js';
import { enqueueExecution } from '../services/task-executor.js';
import { enqueuePlanning } from '../services/task-planner.js';
import { emitToTask } from '../ws/socket-manager.js';
import { logger } from '../lib/logger.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /tasks — list tasks with optional status filter
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const status = req.query.status as TaskStatus | undefined;
    const parentOnly = req.query.parentOnly === 'true';
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;

    const result = await taskService.listTasks(req.user!.id, { status, parentOnly, page });
    res.json({
      data: result.tasks,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /tasks/:id — get task detail with comments, steps, subtasks
 */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const task = await taskService.getTask(req.params.id as string, req.user!.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json({ data: task });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /tasks — create a task
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { title, description, source, priority, parentTaskId } = req.body as {
      title?: string;
      description?: string;
      source?: TaskSource;
      priority?: number;
      parentTaskId?: string;
    };

    if (!title || !source) {
      res.status(400).json({ error: 'title and source are required' });
      return;
    }

    const validSources: TaskSource[] = ['email', 'slack', 'meeting', 'manual', 'agent_proposed', 'sub_agent'];
    if (!validSources.includes(source)) {
      res.status(400).json({ error: 'Invalid source' });
      return;
    }

    const task = await taskService.createTask(req.user!.id, {
      title,
      description,
      source,
      priority,
      parentTaskId,
    });

    res.status(201).json({ data: task });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /tasks/:id — update a task (including status transitions)
 */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const { title, description, status, priority } = req.body as {
      title?: string;
      description?: string;
      status?: TaskStatus;
      priority?: number;
    };

    const task = await taskService.updateTask(req.params.id as string, req.user!.id, {
      title,
      description,
      status,
      priority,
    });

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    // Emit real-time update
    emitToTask(task.id, { type: 'task:updated', task });

    // Trigger planning agent when transitioning into 'planning'
    if (status === 'planning' && task.status === 'planning') {
      enqueuePlanning(task.id, req.user!.id).catch((err) => {
        logger.error({ err, taskId: task.id }, 'Failed to enqueue task planning');
      });
    }

    // Trigger execution when status changes to 'executing'
    // (Planning worker also triggers this, but direct transitions still need it.)
    if (status === 'executing' && task.status === 'executing') {
      enqueueExecution(task.id, req.user!.id).catch((err) => {
        logger.error({ err, taskId: task.id }, 'Failed to enqueue task execution');
      });
    }

    res.json({ data: task });
  } catch (err) {
    if ((err as Error).message.includes('Invalid status transition')) {
      res.status(422).json({ error: (err as Error).message });
      return;
    }
    next(err);
  }
});

/**
 * DELETE /tasks/:id — delete a task
 */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const task = await taskService.deleteTask(req.params.id as string, req.user!.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json({ data: task, message: 'Task deleted' });
  } catch (err) {
    next(err);
  }
});

// ── Comments sub-endpoints ──

/**
 * GET /tasks/:id/comments
 */
router.get('/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const comments = await taskService.listComments(req.params.id as string);
    res.json({ data: comments });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /tasks/:id/comments
 */
router.post('/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const { content } = req.body as { content?: string };
    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const comment = await taskService.addComment(req.params.id as string, req.user!.id, content);

    // Emit real-time
    emitToTask(req.params.id as string, { type: 'task:comment', comment });

    res.status(201).json({ data: comment });
  } catch (err) {
    next(err);
  }
});

// ── Execution Steps sub-endpoints ──

/**
 * GET /tasks/:id/steps
 */
router.get('/:id/steps', requireAuth, async (req, res, next) => {
  try {
    const steps = await taskService.listExecutionSteps(req.params.id as string);
    res.json({ data: steps });
  } catch (err) {
    next(err);
  }
});

// ── Context (for "+ Add context" from card) ──

/**
 * POST /tasks/:id/context — merge a patch into task.context JSON
 */
router.post('/:id/context', requireAuth, async (req, res, next) => {
  try {
    const patch = req.body as Record<string, unknown> | undefined;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      res.status(400).json({ error: 'Request body must be a JSON object' });
      return;
    }

    const task = await taskService.setContext(req.params.id as string, req.user!.id, patch);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    emitToTask(task.id, { type: 'task:updated', task });
    res.json({ data: task });
  } catch (err) {
    next(err);
  }
});

// ── Reviews (human-in-the-loop gate) ──

/**
 * GET /tasks/:id/reviews
 */
router.get('/:id/reviews', requireAuth, async (req, res, next) => {
  try {
    const reviews = await taskService.listReviews(req.params.id as string);
    res.json({ data: reviews });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /tasks/:id/reviews — approve or request changes
 *
 * Side effects:
 *   decision=approved          → task moves review → done
 *   decision=changes_requested → task moves review → planning, feedback stored
 *                                in task.context.reviewFeedback, planner re-runs
 */
router.post('/:id/reviews', requireAuth, async (req, res, next) => {
  try {
    const { decision, feedback } = req.body as {
      decision?: ReviewDecision;
      feedback?: string;
    };

    if (decision !== 'approved' && decision !== 'changes_requested') {
      res
        .status(400)
        .json({ error: 'decision must be "approved" or "changes_requested"' });
      return;
    }

    if (decision === 'changes_requested' && (!feedback || !feedback.trim())) {
      res.status(400).json({ error: 'feedback is required when requesting changes' });
      return;
    }

    const taskId = req.params.id as string;
    const existing = await taskService.getTask(taskId, req.user!.id);
    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (existing.status !== 'review') {
      res.status(422).json({
        error: `Reviews can only be submitted for tasks in review, current status: ${existing.status}`,
      });
      return;
    }

    const review = await taskService.createReview(taskId, req.user!.id, {
      decision,
      feedback,
    });
    emitToTask(taskId, { type: 'task:review', review });

    if (decision === 'approved') {
      const updated = await taskService.updateTask(taskId, req.user!.id, { status: 'done' });
      if (updated) emitToTask(taskId, { type: 'task:updated', task: updated });
    } else {
      // Persist feedback into context so the next planning run can use it
      await taskService.setContext(taskId, req.user!.id, {
        reviewFeedback: feedback,
      });
      const updated = await taskService.updateTask(taskId, req.user!.id, {
        status: 'planning',
      });
      if (updated) emitToTask(taskId, { type: 'task:updated', task: updated });

      // Re-run the planner with the reviewer's feedback
      enqueuePlanning(taskId, req.user!.id, feedback).catch((err) => {
        logger.error({ err, taskId }, 'Failed to enqueue re-planning after review');
      });
    }

    res.status(201).json({ data: review });
  } catch (err) {
    if ((err as Error).message.includes('Invalid status transition')) {
      res.status(422).json({ error: (err as Error).message });
      return;
    }
    next(err);
  }
});

// ── Replan ──

/**
 * POST /tasks/:id/replan — trigger re-planning with optional feedback
 * Works from planning (retry) or executing (interrupt and replan).
 */
router.post('/:id/replan', requireAuth, async (req, res, next) => {
  try {
    const taskId = req.params.id as string;
    const { feedback } = req.body as { feedback?: string };

    if (!feedback || !feedback.trim()) {
      res.status(400).json({ error: 'Feedback is required when replanning' });
      return;
    }

    const task = await taskService.getTask(taskId, req.user!.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    // If already in planning, just re-enqueue with feedback
    if (task.status === 'planning') {
      await enqueuePlanning(taskId, req.user!.id, feedback);
      res.json({ data: task, message: 'Replanning enqueued' });
      return;
    }

    // From executing: transition back to planning, then enqueue
    if (task.status === 'executing') {
      const updated = await taskService.updateTask(taskId, req.user!.id, { status: 'planning' });
      if (!updated) {
        res.status(422).json({ error: 'Failed to transition task to planning' });
        return;
      }
      emitToTask(taskId, { type: 'task:updated', task: updated });

      if (feedback) {
        await taskService.setContext(taskId, req.user!.id, { replanFeedback: feedback });
      }

      await enqueuePlanning(taskId, req.user!.id, feedback);
      res.json({ data: updated, message: 'Replanning enqueued' });
      return;
    }

    res.status(422).json({
      error: `Cannot replan from status "${task.status}". Task must be in planning or executing.`,
    });
  } catch (err) {
    next(err);
  }
});

// ── Subtasks ──

/**
 * POST /tasks/:id/subtasks
 */
router.post('/:id/subtasks', requireAuth, async (req, res, next) => {
  try {
    const { title, description } = req.body as { title?: string; description?: string };
    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const subtask = await taskService.createSubtask(req.params.id as string, req.user!.id, {
      title,
      description,
    });

    emitToTask(req.params.id as string, { type: 'task:subtask', subtask });

    res.status(201).json({ data: subtask });
  } catch (err) {
    next(err);
  }
});

// ── Context Items (rich context: links, files, text blocks, MCP references) ──

const VALID_CONTEXT_TYPES: TaskContextItemType[] = [
  'note', 'link', 'file', 'image', 'text_block', 'mcp_reference',
];

/**
 * GET /tasks/:id/context-items — list all context items for a task
 */
router.get('/:id/context-items', requireAuth, async (req, res, next) => {
  try {
    const items = await contextService.listContextItems(req.params.id as string);
    res.json({ data: items });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /tasks/:id/context-items — add a context item (note, link, text_block, mcp_reference)
 */
router.post('/:id/context-items', requireAuth, async (req, res, next) => {
  try {
    const { type, rawValue, label, mcpIntegrationId, mcpResourceType, mcpResourceId } = req.body as {
      type?: TaskContextItemType;
      rawValue?: string;
      label?: string;
      mcpIntegrationId?: string;
      mcpResourceType?: string;
      mcpResourceId?: string;
    };

    if (!type || !VALID_CONTEXT_TYPES.includes(type)) {
      res.status(400).json({ error: `type must be one of: ${VALID_CONTEXT_TYPES.join(', ')}` });
      return;
    }
    if (!rawValue) {
      res.status(400).json({ error: 'rawValue is required' });
      return;
    }

    const taskId = req.params.id as string;
    const task = await taskService.getTask(taskId, req.user!.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const item = await contextService.createContextItem(taskId, req.user!.id, {
      type,
      rawValue,
      label,
      mcpIntegrationId,
      mcpResourceType,
      mcpResourceId,
    });

    emitToTask(taskId, { type: 'task:context_item_added', item });

    // Enqueue extraction for types that need async processing
    if (type === 'link' || type === 'mcp_reference') {
      enqueueExtraction(item.id, taskId).catch((err) => {
        logger.error({ err, itemId: item.id }, 'Failed to enqueue context extraction');
      });
    }

    res.status(201).json({ data: item });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /tasks/:id/context-items/upload — upload file/image as context item
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_PATTERNS = [/^image\//, /^application\/pdf$/, /^text\//, /^application\/json$/];
const UPLOADS_ROOT = path.resolve('uploads');

const contextUpload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      const now = new Date();
      const dir = path.join(UPLOADS_ROOT, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req, file, cb) {
      const safeName = file.originalname.replace(/[/\\]/g, '_').slice(-100);
      cb(null, `${crypto.randomUUID()}-${safeName}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_MIME_PATTERNS.some((p) => p.test(file.mimetype))) {
      cb(new Error(`File type ${file.mimetype} is not allowed`));
      return;
    }
    cb(null, true);
  },
});

router.post('/:id/context-items/upload', requireAuth, contextUpload.single('file'), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const taskId = req.params.id as string;
    const task = await taskService.getTask(taskId, req.user!.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const relativePath = path.relative(UPLOADS_ROOT, file.path);
    const isImage = file.mimetype.startsWith('image/');

    const item = await contextService.createContextItem(taskId, req.user!.id, {
      type: isImage ? 'image' : 'file',
      rawValue: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storagePath: relativePath,
    });

    emitToTask(taskId, { type: 'task:context_item_added', item });

    // Enqueue extraction for files (not images — vision analysis is opt-in)
    if (!isImage) {
      enqueueExtraction(item.id, taskId).catch((err) => {
        logger.error({ err, itemId: item.id }, 'Failed to enqueue file extraction');
      });
    }

    res.status(201).json({ data: item });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /tasks/:id/context-items/:itemId — update label or sortOrder
 */
router.patch('/:id/context-items/:itemId', requireAuth, async (req, res, next) => {
  try {
    const { label, sortOrder } = req.body as { label?: string; sortOrder?: number };
    const item = await contextService.getContextItem(req.params.itemId as string);
    if (!item || item.taskId !== req.params.id) {
      res.status(404).json({ error: 'Context item not found' });
      return;
    }

    const updated = await contextService.updateContextItem(req.params.itemId as string, { label, sortOrder });
    emitToTask(req.params.id as string, { type: 'task:context_item_updated', item: updated });
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /tasks/:id/context-items/:itemId — remove context item
 */
router.delete('/:id/context-items/:itemId', requireAuth, async (req, res, next) => {
  try {
    const item = await contextService.getContextItem(req.params.itemId as string);
    if (!item || item.taskId !== req.params.id) {
      res.status(404).json({ error: 'Context item not found' });
      return;
    }

    // Delete file from disk if it's a file/image
    if (item.storagePath) {
      const fullPath = path.resolve(UPLOADS_ROOT, item.storagePath);
      fs.unlink(fullPath, () => { /* ignore errors */ });
    }

    await contextService.deleteContextItem(req.params.itemId as string);
    emitToTask(req.params.id as string, { type: 'task:context_item_removed', itemId: item.id });
    res.json({ message: 'Context item deleted' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /tasks/:id/context-items/:itemId/refresh — re-run extraction
 */
router.post('/:id/context-items/:itemId/refresh', requireAuth, async (req, res, next) => {
  try {
    const item = await contextService.getContextItem(req.params.itemId as string);
    if (!item || item.taskId !== req.params.id) {
      res.status(404).json({ error: 'Context item not found' });
      return;
    }

    await contextService.updateExtractionResult(item.id, {
      extractionStatus: 'pending',
      extractionError: null,
    });
    await enqueueExtraction(item.id, req.params.id as string);

    res.json({ message: 'Extraction re-queued' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /tasks/:id/context-items/:itemId/analyze — trigger vision analysis for images
 */
router.post('/:id/context-items/:itemId/analyze', requireAuth, async (req, res, next) => {
  try {
    const item = await contextService.getContextItem(req.params.itemId as string);
    if (!item || item.taskId !== req.params.id) {
      res.status(404).json({ error: 'Context item not found' });
      return;
    }
    if (item.type !== 'image') {
      res.status(400).json({ error: 'Vision analysis is only available for images' });
      return;
    }

    // Mark as pending and enqueue — the extractor will handle image analysis
    await contextService.updateExtractionResult(item.id, {
      extractionStatus: 'pending',
    });
    await enqueueExtraction(item.id, req.params.id as string);

    res.json({ message: 'Vision analysis queued' });
  } catch (err) {
    next(err);
  }
});

export default router;
