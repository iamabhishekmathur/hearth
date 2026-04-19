import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type { OrgCognitiveSettings } from '@hearth/shared';

const router: ReturnType<typeof Router> = Router();

// Admin routes require admin role
router.use(requireAuth, requireRole('admin'));

/**
 * GET /settings — get org-level cognitive profile settings
 */
router.get('/settings', async (req, res, next) => {
  try {
    const orgId = req.user!.orgId!;
    const org = await prisma.org.findUnique({
      where: { id: orgId },
      select: { settings: true },
    });
    const settings = (org?.settings as Record<string, unknown>) ?? {};
    const cognitive: OrgCognitiveSettings = {
      enabled: false,
      ...(settings.cognitiveProfiles as Record<string, unknown> ?? {}),
    };
    res.json({ data: cognitive });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /settings — update org-level cognitive profile settings
 */
router.put('/settings', async (req, res, next) => {
  try {
    const orgId = req.user!.orgId!;
    const { enabled } = req.body as { enabled?: boolean };

    const org = await prisma.org.findUnique({
      where: { id: orgId },
      select: { settings: true },
    });
    const current = (org?.settings as Record<string, unknown>) ?? {};

    await prisma.org.update({
      where: { id: orgId },
      data: {
        settings: {
          ...current,
          cognitiveProfiles: { enabled: !!enabled },
        } as unknown as Prisma.InputJsonValue,
      },
    });

    res.json({ message: 'Cognitive profile settings updated' });
  } catch (err) {
    next(err);
  }
});

export default router;
