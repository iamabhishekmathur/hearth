import { Router } from 'express';
import type { TaskStatus, TaskSource, ReviewDecision } from '@hearth/shared';
import { requireAuth } from '../middleware/auth.js';
import * as taskService from '../services/task-service.js';
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

export default router;
