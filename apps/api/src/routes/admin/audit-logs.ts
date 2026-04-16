import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { queryAuditLogs } from '../../services/audit-service.js';
import type { AuditAction, AuditEntityType } from '../../services/audit-service.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /admin/audit-logs — query audit logs (admin only)
 */
router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!req.user!.orgId) {
      res.status(400).json({ error: 'User must belong to an organization' });
      return;
    }

    const { userId, action, entityType, page, pageSize } = req.query as {
      userId?: string;
      action?: AuditAction;
      entityType?: AuditEntityType;
      page?: string;
      pageSize?: string;
    };

    const result = await queryAuditLogs({
      orgId: req.user!.orgId,
      userId,
      action,
      entityType,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
