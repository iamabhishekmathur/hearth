import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as notificationService from '../services/notification-service.js';

const router: ReturnType<typeof Router> = Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const unreadOnly = req.query.unreadOnly === 'true' || req.query.unreadOnly === '1';
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const [items, unreadCount] = await Promise.all([
      notificationService.listNotifications(req.user!.id, { unreadOnly, limit }),
      notificationService.getUnreadCount(req.user!.id),
    ]);
    res.json({ data: { items, unreadCount } });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/read', requireAuth, async (req, res, next) => {
  try {
    const ok = await notificationService.markRead(req.user!.id, req.params.id as string);
    if (!ok) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

router.post('/read-all', requireAuth, async (_req, res, next) => {
  try {
    const updated = await notificationService.markAllRead(_req.user!.id);
    res.json({ data: { updated } });
  } catch (err) {
    next(err);
  }
});

export default router;
