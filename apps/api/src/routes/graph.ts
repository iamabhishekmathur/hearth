import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import {
  findOutgoingEdges,
  findIncomingEdges,
  navigate,
  type NavNode,
} from '../services/graph-service.js';
import type { EntityKind } from '@prisma/client';

const router: ReturnType<typeof Router> = Router();

const ENTITY_KINDS = new Set<string>([
  'task',
  'person',
  'meeting',
  'chat_message',
  'chat_session',
  'user',
  'external_ref',
]);

function isEntityKind(v: unknown): v is EntityKind {
  return typeof v === 'string' && ENTITY_KINDS.has(v);
}

/**
 * GET /graph/edges?fromType&fromId  (or ?toType&toId)
 * Read the navigation graph edges for a node, scoped to the caller's org.
 * Exactly one of the (fromType,fromId) or (toType,toId) pairs must be given.
 */
router.get('/edges', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.status(400).json({ error: 'Organization context required' });
      return;
    }

    const { fromType, fromId, toType, toId, kind } = req.query as Record<string, string | undefined>;
    const includeStale = req.query.includeStale === 'true';

    if (fromType || fromId) {
      if (!isEntityKind(fromType) || !fromId) {
        res.status(400).json({ error: 'fromType (entity kind) and fromId are required' });
        return;
      }
      const edges = await findOutgoingEdges(orgId, fromType, fromId, {
        kind: kind as never,
        includeStale,
      });
      res.json({ data: edges });
      return;
    }

    if (toType || toId) {
      if (!isEntityKind(toType) || !toId) {
        res.status(400).json({ error: 'toType (entity kind) and toId are required' });
        return;
      }
      const edges = await findIncomingEdges(orgId, toType, toId, {
        kind: kind as never,
        includeStale,
      });
      res.json({ data: edges });
      return;
    }

    res.status(400).json({ error: 'Provide either fromType+fromId or toType+toId' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /graph/persons  — list persons in the caller's org (optionally filter by
 * a single handle via ?slackUserId / ?email / ?notionUserId / ?googleId).
 */
router.get('/persons', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.status(400).json({ error: 'Organization context required' });
      return;
    }

    const { slackUserId, email, notionUserId, googleId } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = { orgId };
    if (slackUserId) where.slackUserId = slackUserId;
    if (email) where.email = email;
    if (notionUserId) where.notionUserId = notionUserId;
    if (googleId) where.googleId = googleId;

    const persons = await prisma.person.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ data: persons });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /graph/navigate?type&id&depth&budget
 * BFS walk of the graph from a seed node, scoped to the caller's org.
 */
router.get('/navigate', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.status(400).json({ error: 'Organization context required' });
      return;
    }

    const { type, id } = req.query as Record<string, string | undefined>;
    if (!isEntityKind(type) || !id) {
      res.status(400).json({ error: 'type (entity kind) and id are required' });
      return;
    }

    const depth = Math.min(Math.max(parseInt(String(req.query.depth ?? '2'), 10) || 2, 1), 6);
    const budget = Math.min(Math.max(parseInt(String(req.query.budget ?? '50'), 10) || 50, 1), 200);

    const seed: NavNode = { type, id };
    const trace = await navigate(orgId, seed, { depth, budget });
    res.json({ data: trace });
  } catch (err) {
    next(err);
  }
});

export default router;
