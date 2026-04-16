import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as ssoService from '../../services/sso-service.js';
import type { SSOConfig } from '../../services/sso-service.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /admin/sso — get SSO config for the current org
 */
router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const config = await ssoService.getSSOConfig(req.user!.orgId!);
    res.json({ data: config });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /admin/sso — save SSO config
 */
router.put('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const config = req.body as SSOConfig;

    if (!config.type || !['saml', 'oidc'].includes(config.type)) {
      res.status(400).json({ error: 'type must be saml or oidc' });
      return;
    }

    // Validate required fields
    const errors =
      config.type === 'saml'
        ? ssoService.validateSAMLConfig(config)
        : ssoService.validateOIDCConfig(config);

    if (errors.length > 0) {
      res.status(400).json({ error: errors.join(', ') });
      return;
    }

    await ssoService.saveSSOConfig(req.user!.orgId!, config);
    res.json({ message: 'SSO configuration saved' });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /admin/sso — remove SSO config
 */
router.delete('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    await prisma.org.update({
      where: { id: req.user!.orgId! },
      data: { ssoConfig: Prisma.DbNull },
    });
    res.json({ message: 'SSO configuration removed' });
  } catch (err) {
    next(err);
  }
});

export default router;
