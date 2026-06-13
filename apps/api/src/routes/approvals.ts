import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as approvalService from '../services/approval-service.js';
import { finalizeApprovedRun } from '../services/routine-delivery.js';
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
    const approval = await approvalService.getApprovalRequest(req.params.id as string, req.user!.orgId);
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

    let result;
    try {
      result = await approvalService.resolveApproval(
        req.params.id as string,
        req.user!.id,
        decision as 'approved' | 'rejected' | 'edited',
        { comment, editedOutput, orgId: req.user!.orgId, callerRole: req.user!.role },
      );
    } catch (err) {
      if (err instanceof approvalService.ApprovalForbiddenError) {
        res.status(403).json({ error: 'Only the routine owner or an admin can resolve this approval' });
        return;
      }
      throw err;
    }

    if (!result) {
      res.status(404).json({ error: 'Approval request not found or already resolved' });
      return;
    }

    // If approved or edited, resume the run: deliver the (possibly edited)
    // output and finalize the run as a success. This closes the approval loop —
    // before this the run was only flipped back to `running` and its output was
    // never delivered.
    if (decision === 'approved' || decision === 'edited') {
      await finalizeApprovedRun(result.run.id);
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
