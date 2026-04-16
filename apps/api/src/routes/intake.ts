import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as taskService from '../services/task-service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router: ReturnType<typeof Router> = Router();

/**
 * POST /intake/dismiss/:taskId — dismiss a false-positive auto-detected task
 */
router.post('/dismiss/:taskId', requireAuth, async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.taskId as string)) {
      res.status(400).json({ error: 'Invalid task ID format' });
      return;
    }

    const task = await taskService.getTask(req.params.taskId as string, req.user!.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (task.status !== 'auto_detected') {
      res.status(422).json({ error: 'Can only dismiss auto-detected tasks' });
      return;
    }

    const updated = await taskService.updateTask(task.id, req.user!.id, { status: 'archived' });
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
