import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { publicRateLimit } from '../middleware/rate-limiter.js';
import * as sharingService from '../services/sharing-service.js';
import type { ContentFilter } from '../services/sharing-service.js';

const router: ReturnType<typeof Router> = Router();

/**
 * POST /chat/sessions/:id/share — create a share link
 */
router.post('/chat/sessions/:id/share', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.id as string;
    const userId = req.user!.id;
    const { contentFilter, shareType, expiresAt } = req.body as {
      contentFilter?: ContentFilter;
      shareType?: string; // backward compat
      expiresAt?: string;
    };

    // Support both new contentFilter and legacy shareType params
    let filter: ContentFilter = 'all';
    if (contentFilter && ['all', 'responses', 'prompts'].includes(contentFilter)) {
      filter = contentFilter;
    } else if (shareType) {
      // Legacy mapping
      const legacyMap: Record<string, ContentFilter> = {
        full: 'all',
        results_only: 'responses',
        template: 'prompts',
      };
      filter = legacyMap[shareType] ?? 'all';
    }

    const share = await sharingService.createShare(
      sessionId,
      userId,
      filter,
      expiresAt ? new Date(expiresAt) : undefined,
    );
    res.status(201).json({ data: share });
  } catch (err) {
    if ((err as Error).message === 'Session not found') {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    next(err);
  }
});

/**
 * GET /shared/:token — view a shared session (public, no auth)
 */
router.get('/shared/:token', publicRateLimit, async (req, res, next) => {
  try {
    const result = await sharingService.getSharedSession(req.params.token as string);
    if (!result) {
      res.status(404).json({ error: 'Shared session not found or expired' });
      return;
    }
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /chat/sessions/:id/duplicate — duplicate a session (optionally from a specific message)
 */
router.post('/chat/sessions/:id/duplicate', requireAuth, async (req, res, next) => {
  try {
    const { upToMessageId } = req.body as { upToMessageId?: string };
    const session = await sharingService.duplicateSession(
      req.params.id as string,
      req.user!.id,
      upToMessageId,
    );
    res.status(201).json({ data: session });
  } catch (err) {
    if ((err as Error).message === 'Session not found') {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    next(err);
  }
});

/**
 * POST /chat/sessions/:id/fork — fork a session (legacy alias for duplicate)
 */
router.post('/chat/sessions/:id/fork', requireAuth, async (req, res, next) => {
  try {
    const session = await sharingService.duplicateSession(req.params.id as string, req.user!.id);
    res.status(201).json({ data: session });
  } catch (err) {
    if ((err as Error).message === 'Session not found') {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    next(err);
  }
});

export default router;
