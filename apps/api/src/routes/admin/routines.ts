import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as analyticsService from '../../services/routine-analytics-service.js';
import * as healthService from '../../services/routine-health-service.js';
import { prisma } from '../../lib/prisma.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET / — list all routines in the org (admin only)
 */
router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.json({ data: [] });
      return;
    }

    // Get all routines for the org (across all scopes)
    const routines = await prisma.routine.findMany({
      where: {
        OR: [
          { orgId },
          { user: { team: { orgId } } },
        ],
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        runs: { take: 1, orderBy: { startedAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: routines });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /analytics — aggregated routine analytics for the org
 */
router.get('/analytics', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.json({ data: [] });
      return;
    }

    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;

    const analytics = await analyticsService.getOrgRoutineAnalytics(orgId, { from, to });
    res.json({ data: analytics });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /analytics/top-consumers — top token-consuming routines
 */
router.get('/analytics/top-consumers', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.json({ data: [] });
      return;
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const consumers = await analyticsService.getTopConsumers(orgId, limit);
    res.json({ data: consumers });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /alerts — list health alerts for the org
 */
router.get('/alerts', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.json({ data: [] });
      return;
    }

    const alerts = await healthService.listAlerts(orgId);
    res.json({ data: alerts });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /alerts — create a health alert
 */
router.post('/alerts', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.status(400).json({ error: 'Organization context required' });
      return;
    }

    const { routineId, alertType, threshold } = req.body as {
      routineId?: string;
      alertType?: string;
      threshold?: Record<string, unknown>;
    };

    if (!routineId || !alertType || !threshold) {
      res.status(400).json({ error: 'routineId, alertType, and threshold are required' });
      return;
    }

    const alert = await healthService.createAlert(orgId, { routineId, alertType, threshold });
    res.status(201).json({ data: alert });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /alerts/:id — delete a health alert
 */
router.delete('/alerts/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.status(400).json({ error: 'Organization context required' });
      return;
    }

    const result = await healthService.deleteAlert(req.params.id as string, orgId);
    if (!result) {
      res.status(404).json({ error: 'Alert not found' });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
