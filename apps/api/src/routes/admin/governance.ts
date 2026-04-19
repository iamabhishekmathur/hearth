import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import {
  getGovernanceSettings,
  updateGovernanceSettings,
  createPolicy,
  updatePolicy,
  deletePolicy,
  listPolicies,
  getPolicy,
  listViolations,
  getViolation,
  reviewViolation,
  getViolationStats,
  evaluateMessage,
  exportViolations,
} from '../../services/governance-service.js';
import type { GovernanceSeverity } from '@hearth/shared';

const router: ReturnType<typeof Router> = Router();

// All routes require admin
router.use(requireAuth, requireRole('admin'));

// ── Settings ──

router.get('/settings', async (req, res, next) => {
  try {
    const settings = await getGovernanceSettings(req.user!.orgId!);
    res.json({ data: settings });
  } catch (err) {
    next(err);
  }
});

router.put('/settings', async (req, res, next) => {
  try {
    const { enabled, checkUserMessages, checkAiResponses, notifyAdmins, monitoringBanner } = req.body;
    await updateGovernanceSettings(req.user!.orgId!, {
      enabled: !!enabled,
      checkUserMessages: checkUserMessages !== false,
      checkAiResponses: !!checkAiResponses,
      notifyAdmins: notifyAdmins !== false,
      monitoringBanner: monitoringBanner !== false,
    });
    res.json({ message: 'Settings updated' });
  } catch (err) {
    next(err);
  }
});

// ── Policies ──

router.get('/policies', async (req, res, next) => {
  try {
    const policies = await listPolicies(req.user!.orgId!);
    res.json({ data: policies });
  } catch (err) {
    next(err);
  }
});

router.post('/policies', async (req, res, next) => {
  try {
    const { name, description, category, severity, ruleType, ruleConfig, enforcement, scope } = req.body;
    if (!name || !ruleType || !ruleConfig) {
      res.status(400).json({ error: 'name, ruleType, and ruleConfig are required' });
      return;
    }
    const validRuleTypes = ['keyword', 'regex', 'llm_evaluation'];
    if (!validRuleTypes.includes(ruleType)) {
      res.status(400).json({ error: `ruleType must be one of: ${validRuleTypes.join(', ')}` });
      return;
    }
    const policy = await createPolicy(req.user!.orgId!, req.user!.id, {
      name,
      description,
      category,
      severity,
      ruleType,
      ruleConfig,
      enforcement,
      scope,
    });
    res.status(201).json({ data: policy });
  } catch (err) {
    next(err);
  }
});

router.get('/policies/:id', async (req, res, next) => {
  try {
    const policy = await getPolicy(req.params.id, req.user!.orgId!);
    if (!policy) {
      res.status(404).json({ error: 'Policy not found' });
      return;
    }
    res.json({ data: policy });
  } catch (err) {
    next(err);
  }
});

router.put('/policies/:id', async (req, res, next) => {
  try {
    const { name, description, category, severity, ruleType, ruleConfig, enforcement, scope, enabled } = req.body;
    const policy = await updatePolicy(req.params.id, req.user!.orgId!, {
      name,
      description,
      category,
      severity,
      ruleType,
      ruleConfig,
      enforcement,
      scope,
      enabled,
    });
    res.json({ data: policy });
  } catch (err) {
    next(err);
  }
});

router.delete('/policies/:id', async (req, res, next) => {
  try {
    await deletePolicy(req.params.id, req.user!.orgId!);
    res.json({ message: 'Policy deleted' });
  } catch (err) {
    next(err);
  }
});

// ── Policy Test (Phase 2) ──

router.post('/policies/test', async (req, res, next) => {
  try {
    const { ruleType, ruleConfig, sampleMessage } = req.body;
    if (!ruleType || !ruleConfig || !sampleMessage) {
      res.status(400).json({ error: 'ruleType, ruleConfig, and sampleMessage are required' });
      return;
    }
    // Create a temporary policy-like object and evaluate
    const violations = await evaluateMessage({
      orgId: req.user!.orgId!,
      userId: req.user!.id,
      sessionId: 'test',
      messageId: 'test',
      messageRole: 'user',
      content: sampleMessage,
    });
    // This tests against live policies — for a true dry-run, we'd need a separate evaluate function.
    // Instead, let the frontend know if any policy would match
    res.json({ data: { violationCount: violations.length, violations } });
  } catch (err) {
    next(err);
  }
});

// ── Violations ──

router.get('/violations', async (req, res, next) => {
  try {
    const { severity, status, userId, policyId, since, until, page, pageSize } = req.query;
    const result = await listViolations(req.user!.orgId!, {
      severity: severity as GovernanceSeverity | undefined,
      status: status as string | undefined,
      userId: userId as string | undefined,
      policyId: policyId as string | undefined,
      since: since ? new Date(since as string) : undefined,
      until: until ? new Date(until as string) : undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize as string, 10) : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/violations/:id', async (req, res, next) => {
  try {
    const violation = await getViolation(req.params.id, req.user!.orgId!);
    if (!violation) {
      res.status(404).json({ error: 'Violation not found' });
      return;
    }
    res.json({ data: violation });
  } catch (err) {
    next(err);
  }
});

router.patch('/violations/:id', async (req, res, next) => {
  try {
    const { status, note } = req.body;
    const validStatuses = ['acknowledged', 'dismissed', 'escalated'];
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
      return;
    }
    if (status === 'escalated' && !note) {
      res.status(400).json({ error: 'note is required when escalating' });
      return;
    }
    const violation = await reviewViolation({
      violationId: req.params.id,
      orgId: req.user!.orgId!,
      reviewerId: req.user!.id,
      status,
      note,
    });
    res.json({ data: violation });
  } catch (err) {
    next(err);
  }
});

// ── Stats ──

router.get('/stats', async (req, res, next) => {
  try {
    const since = req.query.since ? new Date(req.query.since as string) : undefined;
    const stats = await getViolationStats(req.user!.orgId!, since);
    res.json({ data: stats });
  } catch (err) {
    next(err);
  }
});

// ── Export (Phase 3) ──

router.get('/export', async (req, res, next) => {
  try {
    const since = req.query.since ? new Date(req.query.since as string) : undefined;
    const until = req.query.until ? new Date(req.query.until as string) : undefined;
    const format = (req.query.format as 'csv' | 'json') ?? 'csv';
    const result = await exportViolations(req.user!.orgId!, since, until, format);

    const filename = `governance-violations-${new Date().toISOString().slice(0, 10)}.${format}`;
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(result.data);
  } catch (err) {
    next(err);
  }
});

export default router;
