import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as notificationService from '../services/notification-service.js';
import {
  getPreferences,
  preferencesPatchSchema,
  updatePreferences,
} from '../services/notification-preferences.js';
import { prisma } from '../lib/prisma.js';
import { isFeatureEnabled } from '../lib/feature-flags.js';
import type { NotificationPreferencesResponse } from '@hearth/shared';

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

async function knowledgeLoopOn(orgId: string | null | undefined): Promise<boolean> {
  if (!orgId) return false;
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { settings: true } });
  return isFeatureEnabled(org?.settings, 'knowledgeLoop');
}

/** GET /preferences — the caller's switches (defaults filled in). */
router.get('/preferences', requireAuth, async (req, res, next) => {
  try {
    const data: NotificationPreferencesResponse = {
      prefs: await getPreferences(req.user!.id, req.user!.role),
      knowledgeLoop: await knowledgeLoopOn(req.user!.orgId),
    };
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/** PUT /preferences — set any subset of the switches (booleans only). */
router.put('/preferences', requireAuth, async (req, res, next) => {
  try {
    const parsed = preferencesPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error:
          'Preferences must be an object of booleans: knowledgeSummary, knowledgeEmail, adminWeeklySummary, knowledgeImpact',
      });
      return;
    }
    const prefs = await updatePreferences(req.user!.id, req.user!.role, parsed.data);
    const data: NotificationPreferencesResponse = {
      prefs,
      knowledgeLoop: await knowledgeLoopOn(req.user!.orgId),
    };
    res.json({ data });
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
