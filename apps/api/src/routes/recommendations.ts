import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as sherpaService from '../services/sherpa-service.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /skills — get personalized skill recommendations
 */
router.get('/skills', requireAuth, async (req, res, next) => {
  try {
    if (!req.user!.orgId) {
      res.status(400).json({ error: 'User must belong to an organization' });
      return;
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 6;
    const recommendations = await sherpaService.getRecommendations(
      req.user!.id,
      req.user!.orgId,
      limit,
    );
    res.json({ data: recommendations });
  } catch (err) {
    next(err);
  }
});

export default router;
