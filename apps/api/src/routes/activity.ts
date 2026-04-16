import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as feedService from '../services/activity-feed-service.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET / — get activity feed for the user's org
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    if (!req.user!.orgId) {
      res.status(400).json({ error: 'User must belong to an organization' });
      return;
    }

    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const action = req.query.action as string | undefined;
    const userId = req.query.userId as string | undefined;

    const result = await feedService.getFeed({
      orgId: req.user!.orgId,
      userId,
      action,
      page,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /digest — get a summary of recent activity
 */
router.get('/digest', requireAuth, async (req, res, next) => {
  try {
    if (!req.user!.orgId) {
      res.status(400).json({ error: 'User must belong to an organization' });
      return;
    }

    const hours = req.query.hours ? parseInt(req.query.hours as string, 10) : 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const digest = await feedService.generateDigest(req.user!.orgId, since);
    res.json({ data: digest });
  } catch (err) {
    next(err);
  }
});

export default router;
