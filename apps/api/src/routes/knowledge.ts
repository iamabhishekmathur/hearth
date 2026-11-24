/**
 * Knowledge loop, Phase 2 — the Review inbox API (`/api/v1/knowledge`).
 *
 * Behind the org feature flag `knowledgeLoop`. With the flag off every route
 * here answers 404, as if it did not exist. A card is visible only to an
 * owner of its target; everyone else (other members, other orgs) gets 404.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireOrg } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { isFeatureEnabled } from '../lib/feature-flags.js';
import { logAudit } from '../services/audit-service.js';
import type { KnowledgeProposalStatus } from '@hearth/shared';
import type { KnowledgeActor } from '../services/knowledge-owner.js';
import {
  PROPOSAL_STATUSES,
  approveProposal,
  getProposal,
  listProposals,
  rejectProposal,
  type DecisionResult,
} from '../services/knowledge-proposals.js';
import { MAX_AFTER_CHARS, runCuratorForOrg } from '../services/knowledge-curator.js';
import { getAdminSummary, getMyImpact } from '../services/knowledge-notify.js';
import { getPreferences } from '../services/notification-preferences.js';

const router: ReturnType<typeof Router> = Router();
router.use(requireAuth, requireOrg);

function actorOf(req: Request): KnowledgeActor {
  return {
    userId: req.user!.id,
    orgId: req.user!.orgId,
    teamId: req.user!.teamId,
    role: req.user!.role,
  };
}

async function flagOn(req: Request): Promise<boolean> {
  const org = await prisma.org.findUnique({
    where: { id: req.user!.orgId! },
    select: { settings: true },
  });
  return isFeatureEnabled(org?.settings, 'knowledgeLoop');
}

function notFound(res: Response): void {
  res.status(404).json({ error: 'Proposal not found' });
}

function sendDecision(res: Response, result: DecisionResult): void {
  switch (result.status) {
    case 'ok':
      res.json({ data: result.proposal });
      return;
    case 'not_found':
      notFound(res);
      return;
    case 'already_decided':
      res.status(409).json({
        error: 'This proposal was already decided',
        code: 'already_decided',
        status: result.current,
      });
      return;
    case 'target_gone':
      res.status(410).json({
        error: 'The item this proposal changes was deleted',
        code: 'target_gone',
      });
      return;
    case 'conflict':
      res.status(409).json({
        error: 'The item changed since this was proposed. Take a fresh look.',
        code: 'version_conflict',
        currentVersion: result.currentVersion,
        currentContent: result.currentContent,
      });
      return;
  }
}

const STATUS_FILTERS = [...PROPOSAL_STATUSES, 'all'] as const;
type StatusFilter = KnowledgeProposalStatus | 'all';
const listQuery = z.object({
  status: z
    .string()
    .refine((v): v is StatusFilter => (STATUS_FILTERS as readonly string[]).includes(v))
    .optional(),
});

/** GET /proposals?status= — the caller's cards that are due (default: pending). */
router.get('/proposals', async (req, res, next) => {
  try {
    if (!(await flagOn(req))) return notFound(res);
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }
    const data = await listProposals(actorOf(req), {
      status: parsed.data.status as StatusFilter | undefined,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/** GET /proposals/:id — one card with its evidence, as far as the caller may see it. */
router.get('/proposals/:id', async (req, res, next) => {
  try {
    if (!(await flagOn(req))) return notFound(res);
    const proposal = await getProposal(actorOf(req), req.params.id as string);
    if (!proposal) return notFound(res);
    res.json({ data: proposal });
  } catch (err) {
    next(err);
  }
});

const approveSchema = z
  .object({
    after: z.string().trim().min(1).max(MAX_AFTER_CHARS).optional(),
    baseVersion: z.number().int().positive().optional(),
  })
  .strict();

/** POST /proposals/:id/approve — apply the change (optionally edited). */
router.post('/proposals/:id/approve', async (req, res, next) => {
  try {
    if (!(await flagOn(req))) return notFound(res);
    const parsed = approveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'after must be non-empty text; baseVersion a positive integer' });
      return;
    }
    const actor = actorOf(req);
    const result = await approveProposal(actor, req.params.id as string, parsed.data);
    if (result.status === 'ok') {
      const edited = result.proposal.status === 'edited';
      void logAudit({
        orgId: actor.orgId!,
        userId: actor.userId,
        action: edited ? 'knowledge_proposal_edited' : 'knowledge_proposal_approved',
        entityType: result.proposal.targetType,
        entityId: result.proposal.targetId,
        details: { proposalId: result.proposal.id, resultVersion: result.resultVersion },
      });
    }
    sendDecision(res, result);
  } catch (err) {
    next(err);
  }
});

const rejectSchema = z.object({ reason: z.string().max(500).optional() }).strict();

/** POST /proposals/:id/reject — turn the change down; the reason reaches the curator. */
router.post('/proposals/:id/reject', async (req, res, next) => {
  try {
    if (!(await flagOn(req))) return notFound(res);
    const parsed = rejectSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'reason must be text of at most 500 characters' });
      return;
    }
    const actor = actorOf(req);
    const result = await rejectProposal(actor, req.params.id as string, parsed.data.reason);
    if (result.status === 'ok') {
      void logAudit({
        orgId: actor.orgId!,
        userId: actor.userId,
        action: 'knowledge_proposal_rejected',
        entityType: result.proposal.targetType,
        entityId: result.proposal.targetId,
        details: { proposalId: result.proposal.id, withReason: !!result.proposal.rejectReason },
      });
    }
    sendDecision(res, result);
  } catch (err) {
    next(err);
  }
});

const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(31).optional() });

/**
 * GET /my-impact?days=7 — Phase 3: how many items the caller's input helped
 * fix (approved or edited cards) in the window. Counts only. With the
 * caller's `knowledgeImpact` switch off the count is always 0.
 */
router.get('/my-impact', async (req, res, next) => {
  try {
    if (!(await flagOn(req))) return notFound(res);
    const parsed = daysQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'days must be an integer from 1 to 31' });
      return;
    }
    const actor = actorOf(req);
    const impact = await getMyImpact(actor, { days: parsed.data.days });
    const prefs = await getPreferences(actor.userId, actor.role);
    res.json({ data: prefs.knowledgeImpact ? impact : { ...impact, count: 0 } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin-summary?days=7 — Phase 3, admins only: what changed, what
 * waits, and which areas have no owner.
 */
router.get('/admin-summary', async (req, res, next) => {
  try {
    if (!(await flagOn(req))) return notFound(res);
    if (req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Only an admin can see the knowledge summary' });
      return;
    }
    const parsed = daysQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'days must be an integer from 1 to 31' });
      return;
    }
    const data = await getAdminSummary(req.user!.orgId!, { days: parsed.data.days });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /curator/run — admins: run the curator for this org now (it normally
 * runs at 04:00 UTC). Returns the run summary (counts only).
 */
router.post('/curator/run', async (req, res, next) => {
  try {
    if (!(await flagOn(req))) return notFound(res);
    if (req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Only an admin can run the curator' });
      return;
    }
    const summary = await runCuratorForOrg(req.user!.orgId!);
    res.json({ data: summary });
  } catch (err) {
    next(err);
  }
});

export default router;
