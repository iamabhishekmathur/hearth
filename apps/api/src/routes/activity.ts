import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as feedService from '../services/activity-feed-service.js';
import * as reactionService from '../services/activity-reaction-service.js';
import * as signalService from '../services/proactive-signal-service.js';
import { REACTION_EMOJIS } from '@hearth/shared';
import { redis } from '../lib/redis.js';
import { tenantKeyFor } from '../lib/redis-keys.js';

const router: ReturnType<typeof Router> = Router();

const SIGNAL_CACHE_TTL = 4 * 60 * 60; // 4 hours

/**
 * GET / — get activity feed for the user's org (cursor-based pagination)
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    if (!req.user!.orgId) {
      res.status(400).json({ error: 'User must belong to an organization' });
      return;
    }

    const cursor = req.query.cursor as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const action = req.query.action as string | undefined;
    const userId = req.query.userId as string | undefined;
    const since = req.query.since ? new Date(req.query.since as string) : undefined;

    const result = await feedService.getFeedCursor({
      orgId: req.user!.orgId,
      userId,
      action,
      cursor,
      since,
      limit,
    });

    // Enrich with reactions + metrics
    const ids = result.data.map((e) => e.id);
    const [reactionsMap] = await Promise.all([
      reactionService.getReactionsForEvents(ids),
      feedService.enrichWithMetrics(result.data),
    ]);
    for (const event of result.data) {
      event.reactions = reactionsMap.get(event.id) ?? [];
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /signals — get proactive signal recommendations for the current user
 */
router.get('/signals', requireAuth, async (req, res, next) => {
  try {
    if (!req.user!.orgId) {
      res.status(400).json({ error: 'User must belong to an organization' });
      return;
    }

    const cacheKey = tenantKeyFor(req.user!.orgId, 'signals', req.user!.id);

    // Try cache first
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          res.json({ data: JSON.parse(cached) });
          return;
        }
      } catch {
        // Cache miss or error — compute fresh
      }
    }

    const signals = await signalService.computeSignals({
      userId: req.user!.id,
      orgId: req.user!.orgId,
    });

    // Cache result
    if (redis) {
      try {
        await redis.set(cacheKey, JSON.stringify(signals), 'EX', SIGNAL_CACHE_TTL);
      } catch {
        // Cache write failed — non-critical
      }
    }

    res.json({ data: signals });
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

/**
 * POST /:id/reactions — add a reaction to an activity event
 */
router.post('/:id/reactions', requireAuth, async (req, res, next) => {
  try {
    if (!req.user!.orgId) {
      res.status(400).json({ error: 'User must belong to an organization' });
      return;
    }

    const { emoji } = req.body;
    if (!emoji || !(REACTION_EMOJIS as readonly string[]).includes(emoji)) {
      res.status(400).json({ error: 'Invalid emoji' });
      return;
    }

    await reactionService.addReaction({
      auditLogId: req.params.id as string,
      userId: req.user!.id,
      emoji,
      orgId: req.user!.orgId,
      userName: req.user!.name ?? 'Unknown',
    });

    res.json({ data: { success: true } });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /:id/reactions/:emoji — remove a reaction from an activity event
 */
router.delete('/:id/reactions/:emoji', requireAuth, async (req, res, next) => {
  try {
    if (!req.user!.orgId) {
      res.status(400).json({ error: 'User must belong to an organization' });
      return;
    }

    await reactionService.removeReaction({
      auditLogId: req.params.id as string,
      userId: req.user!.id,
      emoji: req.params.emoji as string,
      orgId: req.user!.orgId,
      userName: req.user!.name ?? 'Unknown',
    });

    res.json({ data: { success: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
