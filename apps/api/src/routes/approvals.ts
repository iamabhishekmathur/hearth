import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as approvalService from '../services/approval-service.js';
import { enqueueRoutineNow } from '../jobs/routine-scheduler.js';
import { prisma } from '../lib/prisma.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET / — list pending approvals for the current user
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const approvals = await approvalService.getPendingApprovalsForUser(req.user!.id);
    res.json({ data: approvals });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /:id — get approval request details
 */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const approval = await approvalService.getApprovalRequest(req.params.id as string);
    if (!approval) {
      res.status(404).json({ error: 'Approval request not found' });
      return;
    }
    res.json({ data: approval });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /:id/resolve — approve, reject, or edit+approve an approval request
 */
router.post('/:id/resolve', requireAuth, async (req, res, next) => {
  try {
    const { decision, comment, editedOutput } = req.body as {
      decision?: string;
      comment?: string;
      editedOutput?: string;
    };

    if (!decision || !['approved', 'rejected', 'edited'].includes(decision)) {
      res.status(400).json({ error: 'decision must be one of: approved, rejected, edited' });
      return;
    }

    const result = await approvalService.resolveApproval(
      req.params.id as string,
      req.user!.id,
      decision as 'approved' | 'rejected' | 'edited',
      { comment, editedOutput },
    );

    if (!result) {
      res.status(404).json({ error: 'Approval request not found or already resolved' });
      return;
    }

    // If approved or edited, resume the routine (enqueue resume job)
    if (decision === 'approved' || decision === 'edited') {
      const run = await prisma.routineRun.findUnique({
        where: { id: result.run.id },
        include: { routine: { select: { id: true, userId: true } } },
      });

      if (run) {
        // Update run status back to running
        await prisma.routineRun.update({
          where: { id: run.id },
          data: { status: 'running' },
        });
      }
    } else if (decision === 'rejected') {
      // Mark the run as failed
      await prisma.routineRun.update({
        where: { id: result.run.id },
        data: {
          status: 'failed',
          error: `Rejected by reviewer${comment ? `: ${comment}` : ''}`,
          completedAt: new Date(),
        },
      });
    }

    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
