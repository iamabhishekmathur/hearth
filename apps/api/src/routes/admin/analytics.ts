import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { getUsageAnalytics } from '../../services/analytics-service.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /admin/analytics — usage analytics for the org
 */
router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
    const analytics = await getUsageAnalytics(req.user!.orgId!, days);
    res.json({ data: analytics });
  } catch (err) {
    next(err);
  }
});

export default router;
