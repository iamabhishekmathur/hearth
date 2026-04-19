import { Router, type Router as RouterType } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import * as decisionService from '../services/decision-service.js';
import type { CreateDecisionRequest, UpdateDecisionRequest, DecisionSearchRequest, RecordOutcomeRequest, CreateDecisionLinkRequest } from '@hearth/shared';

const router: RouterType = Router();
router.use(requireAuth);

async function getOrgId(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { team: { select: { orgId: true } } },
  });
  const org = user?.team?.orgId
    ? { id: user.team.orgId }
    : await prisma.org.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  return org?.id ?? '';
}

// List decisions (cursor-paginated)
router.get('/', async (req, res) => {
  try {
    const orgId = await getOrgId(req.user!.id);
    const scope = { orgId, userId: req.user!.id, teamId: req.user!.teamId ?? null, role: req.user!.role };
    const result = await decisionService.listDecisions(scope, {
      cursor: req.query.cursor as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      domain: req.query.domain as string | undefined,
      status: req.query.status as string | undefined,
      scope: req.query.scope as string | undefined,
      teamId: req.query.teamId as string | undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list decisions' });
  }
});

// Create decision
router.post('/', async (req, res) => {
  try {
    const orgId = await getOrgId(req.user!.id);
    const scope = { orgId, userId: req.user!.id, teamId: req.user!.teamId ?? null, role: req.user!.role };
    const data = req.body as CreateDecisionRequest;
    if (!data.title || !data.reasoning) {
      return res.status(400).json({ error: 'title and reasoning are required' });
    }
    const decision = await decisionService.createDecision(scope, data);
    res.status(201).json({ data: decision });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create decision' });
  }
});

// Search decisions
router.post('/search', async (req, res) => {
  try {
    const orgId = await getOrgId(req.user!.id);
    const scope = { orgId, userId: req.user!.id, teamId: req.user!.teamId ?? null, role: req.user!.role };
    const searchReq = req.body as DecisionSearchRequest;
    if (!searchReq.query) {
      return res.status(400).json({ error: 'query is required' });
    }
    const result = await decisionService.searchDecisions(scope, searchReq);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to search decisions' });
  }
});

// Pending review
router.get('/pending-review', async (req, res) => {
  try {
    const orgId = await getOrgId(req.user!.id);
    const decisions = await decisionService.listPendingReview(orgId);
    res.json({ data: decisions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get pending review' });
  }
});

// Patterns
router.get('/patterns', async (req, res) => {
  try {
    const orgId = await getOrgId(req.user!.id);
    const patterns = await decisionService.listPatterns(orgId, req.query.domain as string | undefined);
    res.json({ data: patterns });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list patterns' });
  }
});

// Principles
router.get('/principles', async (req, res) => {
  try {
    const orgId = await getOrgId(req.user!.id);
    const principles = await decisionService.listPrinciples(orgId, req.query.domain as string | undefined);
    res.json({ data: principles });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list principles' });
  }
});

// Get decision by ID
router.get('/:id', async (req, res) => {
  try {
    const orgId = await getOrgId(req.user!.id);
    const decision = await decisionService.getDecision(req.params.id, orgId);
    if (!decision) return res.status(404).json({ error: 'Decision not found' });
    res.json({ data: decision });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get decision' });
  }
});

// Update decision
router.patch('/:id', async (req, res) => {
  try {
    const orgId = await getOrgId(req.user!.id);
    const data = req.body as UpdateDecisionRequest;
    const decision = await decisionService.updateDecision(req.params.id, orgId, data);
    if (!decision) return res.status(404).json({ error: 'Decision not found' });
    res.json({ data: decision });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update decision' });
  }
});

// Archive (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const orgId = await getOrgId(req.user!.id);
    const decision = await decisionService.updateDecision(req.params.id, orgId, { status: 'archived' });
    if (!decision) return res.status(404).json({ error: 'Decision not found' });
    res.json({ data: { archived: true } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to archive decision' });
  }
});

// Get decision graph
router.get('/:id/graph', async (req, res) => {
  try {
    const orgId = await getOrgId(req.user!.id);
    const depth = req.query.depth ? parseInt(req.query.depth as string) : 2;
    const graph = await decisionService.getDecisionGraph(req.params.id, orgId, depth);
    res.json({ data: graph });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get decision graph' });
  }
});

// Add link
router.post('/:id/dependencies', async (req, res) => {
  try {
    const { toDecisionId, relationship, description } = req.body as CreateDecisionLinkRequest;
    if (!toDecisionId || !relationship) {
      return res.status(400).json({ error: 'toDecisionId and relationship are required' });
    }
    const link = await decisionService.addDecisionLink(
      req.params.id, toDecisionId, relationship, description, req.user!.id,
    );
    res.status(201).json({ data: link });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add link' });
  }
});

// Remove link
router.delete('/:id/dependencies/:depId', async (req, res) => {
  try {
    await decisionService.removeDecisionLink(req.params.depId);
    res.json({ data: { removed: true } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove link' });
  }
});

// Record outcome
router.post('/:id/outcomes', async (req, res) => {
  try {
    const orgId = await getOrgId(req.user!.id);
    const data = req.body as RecordOutcomeRequest;
    if (!data.verdict || !data.description) {
      return res.status(400).json({ error: 'verdict and description are required' });
    }
    const outcome = await decisionService.recordOutcome(req.params.id, req.user!.id, orgId, data);
    if (!outcome) return res.status(404).json({ error: 'Decision not found' });
    res.status(201).json({ data: outcome });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record outcome' });
  }
});

// List outcomes
router.get('/:id/outcomes', async (req, res) => {
  try {
    const outcomes = await prisma.decisionOutcome.findMany({
      where: { decisionId: req.params.id },
      include: { observedBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: outcomes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list outcomes' });
  }
});

// Confirm draft
router.post('/:id/confirm', async (req, res) => {
  try {
    const orgId = await getOrgId(req.user!.id);
    const success = await decisionService.confirmDecision(req.params.id, orgId, req.user!.id);
    res.json({ data: { confirmed: success } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to confirm decision' });
  }
});

// Dismiss draft
router.post('/:id/dismiss', async (req, res) => {
  try {
    const orgId = await getOrgId(req.user!.id);
    const success = await decisionService.dismissDecision(req.params.id, orgId);
    res.json({ data: { dismissed: success } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to dismiss decision' });
  }
});

export default router;
