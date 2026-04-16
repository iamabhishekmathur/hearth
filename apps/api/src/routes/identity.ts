import { Router } from 'express';
import type { AgentFileType } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import * as identityService from '../services/identity-service.js';

const router: ReturnType<typeof Router> = Router();

function getScope(user: Express.User) {
  return {
    orgId: user.orgId!,
    userId: user.id,
    role: user.role,
  };
}

/**
 * GET /identity/:level/:fileType — get an identity document
 */
router.get('/:level/:fileType', requireAuth, async (req, res, next) => {
  try {
    const scope = getScope(req.user!);
    const level = req.params.level as 'org' | 'user';
    const fileType = req.params.fileType as AgentFileType;

    if (!['org', 'user'].includes(level) || !['soul', 'identity'].includes(fileType)) {
      res.status(400).json({ error: 'Invalid level or fileType' });
      return;
    }

    const doc = await identityService.getIdentity(scope, fileType, level);
    res.json({ data: doc });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /identity/:level/:fileType — create or update an identity document
 */
router.put('/:level/:fileType', requireAuth, async (req, res, next) => {
  try {
    const scope = getScope(req.user!);
    const level = req.params.level as 'org' | 'user';
    const fileType = req.params.fileType as AgentFileType;
    const { content } = req.body as { content?: string };

    if (!['org', 'user'].includes(level) || !['soul', 'identity'].includes(fileType)) {
      res.status(400).json({ error: 'Invalid level or fileType' });
      return;
    }

    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const doc = await identityService.upsertIdentity(scope, fileType, level, content);
    res.json({ data: doc });
  } catch (err) {
    if ((err as Error).message.includes('Only admins') || (err as Error).message.includes('only available')) {
      res.status(403).json({ error: (err as Error).message });
      return;
    }
    next(err);
  }
});

export default router;
