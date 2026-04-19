import type { Prisma } from '@prisma/client';
import type {
  GovernancePolicy,
  GovernanceViolation,
  GovernanceSettings,
  GovernanceStats,
  GovernanceSeverity,
  GovernanceEnforcement,
  PaginatedResponse,
} from '@hearth/shared';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { logAudit } from './audit-service.js';
import { emitToOrg, emitToSessionEvent } from '../ws/socket-manager.js';
import { providerRegistry } from '../llm/provider-registry.js';

// ── In-memory policy cache ──

interface CachedPolicies {
  policies: Awaited<ReturnType<typeof loadPoliciesFromDb>>;
  loadedAt: number;
}

const policyCache = new Map<string, CachedPolicies>();
const CACHE_TTL_MS = 60_000;

function invalidateCache(orgId: string): void {
  policyCache.delete(orgId);
}

/** Clear the entire policy cache — exposed for testing */
export function _clearPolicyCache(): void {
  policyCache.clear();
}

async function getCachedPolicies(orgId: string) {
  const cached = policyCache.get(orgId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.policies;
  }
  const policies = await loadPoliciesFromDb(orgId);
  policyCache.set(orgId, { policies, loadedAt: Date.now() });
  return policies;
}

async function loadPoliciesFromDb(orgId: string) {
  return prisma.governancePolicy.findMany({
    where: { orgId, enabled: true },
  });
}

// ── Settings ──

const DEFAULT_SETTINGS: GovernanceSettings = {
  enabled: false,
  checkUserMessages: true,
  checkAiResponses: false,
  notifyAdmins: true,
  monitoringBanner: true,
};

export async function getGovernanceSettings(orgId: string): Promise<GovernanceSettings> {
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  const settings = org?.settings as Record<string, unknown> | null;
  if (!settings?.governance) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(settings.governance as Partial<GovernanceSettings>) };
}

export async function updateGovernanceSettings(
  orgId: string,
  newSettings: GovernanceSettings,
): Promise<void> {
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  const current = (org?.settings as Record<string, unknown>) ?? {};
  await prisma.org.update({
    where: { id: orgId },
    data: {
      settings: { ...current, governance: newSettings } as unknown as Prisma.InputJsonValue,
    },
  });
}

// ── Policy CRUD ──

interface CreatePolicyInput {
  name: string;
  description?: string;
  category?: string;
  severity?: GovernanceSeverity;
  ruleType: string;
  ruleConfig: Record<string, unknown>;
  enforcement?: GovernanceEnforcement;
  scope?: Record<string, unknown>;
}

interface UpdatePolicyInput {
  name?: string;
  description?: string;
  category?: string;
  severity?: GovernanceSeverity;
  ruleType?: string;
  ruleConfig?: Record<string, unknown>;
  enforcement?: GovernanceEnforcement;
  scope?: Record<string, unknown>;
  enabled?: boolean;
}

export async function createPolicy(
  orgId: string,
  createdBy: string,
  input: CreatePolicyInput,
): Promise<GovernancePolicy> {
  const record = await prisma.governancePolicy.create({
    data: {
      orgId,
      createdBy,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? 'custom',
      severity: input.severity ?? 'warning',
      ruleType: input.ruleType,
      ruleConfig: input.ruleConfig as Prisma.InputJsonValue,
      enforcement: input.enforcement ?? 'monitor',
      scope: (input.scope ?? {}) as Prisma.InputJsonValue,
    },
  });
  invalidateCache(orgId);

  logAudit({
    orgId,
    userId: createdBy,
    action: 'governance_policy_change',
    entityType: 'governance_policy',
    entityId: record.id,
    details: { action: 'created', name: input.name },
  }).catch(() => {});

  return toPolicy(record);
}

export async function updatePolicy(
  policyId: string,
  orgId: string,
  input: UpdatePolicyInput,
): Promise<GovernancePolicy> {
  const data: Prisma.GovernancePolicyUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.category !== undefined) data.category = input.category;
  if (input.severity !== undefined) data.severity = input.severity;
  if (input.ruleType !== undefined) data.ruleType = input.ruleType;
  if (input.ruleConfig !== undefined) data.ruleConfig = input.ruleConfig as Prisma.InputJsonValue;
  if (input.enforcement !== undefined) data.enforcement = input.enforcement;
  if (input.scope !== undefined) data.scope = input.scope as Prisma.InputJsonValue;
  if (input.enabled !== undefined) data.enabled = input.enabled;

  const record = await prisma.governancePolicy.update({
    where: { id: policyId, orgId },
    data,
  });
  invalidateCache(orgId);
  return toPolicy(record);
}

export async function deletePolicy(policyId: string, orgId: string): Promise<void> {
  // Delete violations first, then the policy
  await prisma.governanceViolation.deleteMany({ where: { policyId, orgId } });
  await prisma.governancePolicy.delete({ where: { id: policyId, orgId } });
  invalidateCache(orgId);
}

export async function listPolicies(orgId: string): Promise<GovernancePolicy[]> {
  const records = await prisma.governancePolicy.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { violations: true } } },
  });
  return records.map((r) => ({
    ...toPolicy(r),
    violationCount: r._count.violations,
  }));
}

export async function getPolicy(policyId: string, orgId: string): Promise<GovernancePolicy | null> {
  const record = await prisma.governancePolicy.findFirst({
    where: { id: policyId, orgId },
  });
  return record ? toPolicy(record) : null;
}

// ── Evaluation ──

export async function evaluateMessage(params: {
  orgId: string;
  userId: string;
  sessionId: string;
  messageId: string;
  messageRole: string;
  content: string;
}): Promise<GovernanceViolation[]> {
  const settings = await getGovernanceSettings(params.orgId);
  if (!settings.enabled) return [];
  if (params.messageRole === 'user' && !settings.checkUserMessages) return [];
  if (params.messageRole === 'assistant' && !settings.checkAiResponses) return [];

  const policies = await getCachedPolicies(params.orgId);
  const violations: GovernanceViolation[] = [];

  for (const policy of policies) {
    // Phase 3: scope check
    if (!policyApplies(policy, params.userId)) continue;

    let matchResult: { matched: boolean; details: Record<string, unknown> } | null = null;

    if (policy.ruleType === 'keyword') {
      matchResult = evaluateKeyword(policy.ruleConfig as Record<string, unknown>, params.content);
    } else if (policy.ruleType === 'regex') {
      matchResult = evaluateRegex(policy.ruleConfig as Record<string, unknown>, params.content);
    } else if (policy.ruleType === 'llm_evaluation') {
      matchResult = await evaluateLLM(policy, params.content);
    }

    if (matchResult?.matched) {
      const snippet = params.content.slice(0, 500);
      const record = await prisma.governanceViolation.create({
        data: {
          orgId: params.orgId,
          policyId: policy.id,
          userId: params.userId,
          sessionId: params.sessionId,
          messageId: params.messageId,
          messageRole: params.messageRole,
          severity: policy.severity,
          contentSnippet: snippet,
          matchDetails: matchResult.details as Prisma.InputJsonValue,
          enforcement: policy.enforcement,
        },
      });

      const violation = toViolation(record, policy.name);
      violations.push(violation);

      // Audit log (feeds activity feed)
      logAudit({
        orgId: params.orgId,
        userId: params.userId,
        action: 'governance_violation',
        entityType: 'governance_violation',
        entityId: record.id,
        details: {
          policyName: policy.name,
          severity: policy.severity,
          enforcement: policy.enforcement,
          snippet: snippet.slice(0, 100),
        },
      }).catch(() => {});

      // Real-time admin notification
      if (settings.notifyAdmins) {
        const user = await prisma.user.findUnique({
          where: { id: params.userId },
          select: { name: true },
        });
        emitToOrg(params.orgId, 'governance:violation', {
          violationId: record.id,
          userId: params.userId,
          userName: user?.name ?? 'Unknown',
          policyName: policy.name,
          severity: policy.severity,
          snippet: snippet.slice(0, 100),
        });
      }

      // Phase 3: emit session-level events for warn/block enforcement
      if (policy.enforcement === 'warn') {
        emitToSessionEvent(params.sessionId, 'governance:warning', {
          messageId: params.messageId,
          policyName: policy.name,
          reason: `Heads up: this message was flagged by "${policy.name}".`,
        });
      }
    }
  }

  return violations;
}

/**
 * Check if any enabled policy in the org uses block enforcement.
 */
export async function hasBlockPolicies(orgId: string): Promise<boolean> {
  const policies = await getCachedPolicies(orgId);
  return policies.some((p) => p.enforcement === 'block');
}

// ── Keyword evaluation ──

function evaluateKeyword(
  config: Record<string, unknown>,
  content: string,
): { matched: boolean; details: Record<string, unknown> } {
  const keywords = (config.keywords as string[]) ?? [];
  const matchMode = (config.matchMode as string) ?? 'any';
  const caseSensitive = (config.caseSensitive as boolean) ?? false;
  const normalizedContent = caseSensitive ? content : content.toLowerCase();

  const matched: string[] = [];
  for (const kw of keywords) {
    const normalizedKw = caseSensitive ? kw : kw.toLowerCase();
    if (normalizedContent.includes(normalizedKw)) {
      matched.push(kw);
    }
  }

  const isMatch = matchMode === 'all' ? matched.length === keywords.length : matched.length > 0;
  return { matched: isMatch, details: { matchedKeywords: matched } };
}

// ── Regex evaluation ──

function evaluateRegex(
  config: Record<string, unknown>,
  content: string,
): { matched: boolean; details: Record<string, unknown> } {
  const pattern = config.pattern as string;
  const flags = (config.flags as string) ?? 'i';
  if (!pattern) return { matched: false, details: {} };

  try {
    const regex = new RegExp(pattern, flags);
    const matches = content.match(regex);
    return { matched: !!matches, details: { regexMatches: matches?.slice(0, 5) ?? [] } };
  } catch {
    return { matched: false, details: { error: 'Invalid regex pattern' } };
  }
}

// ── LLM evaluation (Phase 2) ──

async function evaluateLLM(
  policy: { name: string; description: string | null; ruleConfig: unknown },
  content: string,
): Promise<{ matched: boolean; details: Record<string, unknown> }> {
  try {
    const config = policy.ruleConfig as Record<string, unknown>;
    const prompt = (config.prompt as string) ?? policy.description ?? policy.name;
    const truncatedContent = content.slice(0, 4000);

    const evaluationPrompt = `You are a compliance evaluator. Based on the following policy, determine if the message violates it.

Policy: ${policy.description || policy.name}
Evaluation criteria: ${prompt}

Message to evaluate:
"""
${truncatedContent}
"""

Respond with exactly one line: "VIOLATION: <reason>" or "PASS"`;

    // Collect streaming response into text
    let text = '';
    for await (const event of providerRegistry.chatWithFallback(
      {
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'user', content: evaluationPrompt }],
        maxTokens: 150,
        temperature: 0,
      },
      'anthropic',
    )) {
      if (event.type === 'text_delta') {
        text += event.content;
      }
    }

    const result = text.trim();
    if (result.startsWith('VIOLATION:')) {
      return {
        matched: true,
        details: { reason: result.slice(10).trim(), evaluationType: 'llm' },
      };
    }
    return { matched: false, details: { evaluationType: 'llm' } };
  } catch (err) {
    logger.error({ err }, 'LLM governance evaluation failed');
    return { matched: false, details: { error: 'LLM evaluation failed' } };
  }
}

// ── Phase 3: Scope check ──

function policyApplies(
  policy: { scope: unknown },
  userId: string,
): boolean {
  const scope = policy.scope as { teamIds?: string[]; userIds?: string[] } | null;
  if (!scope) return true;
  if (!scope.teamIds?.length && !scope.userIds?.length) return true;
  if (scope.userIds?.includes(userId)) return true;
  // Team scoping would require looking up user's team — kept simple for now
  return !scope.userIds?.length; // If only teamIds are set but no userIds, allow (team check deferred)
}

// ── Violation Queries ──

export interface ViolationFilters {
  severity?: GovernanceSeverity;
  status?: string;
  userId?: string;
  policyId?: string;
  since?: Date;
  until?: Date;
  page?: number;
  pageSize?: number;
}

export async function listViolations(
  orgId: string,
  filters: ViolationFilters,
): Promise<PaginatedResponse<GovernanceViolation>> {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const skip = (page - 1) * pageSize;

  const where: Prisma.GovernanceViolationWhereInput = {
    orgId,
    ...(filters.severity && { severity: filters.severity }),
    ...(filters.status && { status: filters.status as 'open' | 'acknowledged' | 'dismissed' | 'escalated' }),
    ...(filters.userId && { userId: filters.userId }),
    ...(filters.policyId && { policyId: filters.policyId }),
    ...(filters.since || filters.until
      ? {
          createdAt: {
            ...(filters.since && { gte: filters.since }),
            ...(filters.until && { lte: filters.until }),
          },
        }
      : {}),
  };

  const [records, total] = await Promise.all([
    prisma.governanceViolation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: {
        policy: { select: { name: true } },
        user: { select: { name: true } },
      },
    }),
    prisma.governanceViolation.count({ where }),
  ]);

  return {
    data: records.map((r) => ({
      ...toViolation(r, r.policy.name),
      userName: r.user.name,
    })),
    total,
    page,
    pageSize,
  };
}

export async function getViolation(
  violationId: string,
  orgId: string,
): Promise<GovernanceViolation | null> {
  const record = await prisma.governanceViolation.findFirst({
    where: { id: violationId, orgId },
    include: {
      policy: { select: { name: true } },
      user: { select: { name: true } },
    },
  });
  if (!record) return null;
  return {
    ...toViolation(record, record.policy.name),
    userName: record.user.name,
  };
}

export async function reviewViolation(params: {
  violationId: string;
  orgId: string;
  reviewerId: string;
  status: 'acknowledged' | 'dismissed' | 'escalated';
  note?: string;
}): Promise<GovernanceViolation> {
  const record = await prisma.governanceViolation.update({
    where: { id: params.violationId, orgId: params.orgId },
    data: {
      status: params.status,
      reviewedBy: params.reviewerId,
      reviewNote: params.note ?? null,
      reviewedAt: new Date(),
    },
    include: { policy: { select: { name: true } } },
  });

  logAudit({
    orgId: params.orgId,
    userId: params.reviewerId,
    action: 'governance_policy_change',
    entityType: 'governance_violation',
    entityId: params.violationId,
    details: { newStatus: params.status, note: params.note },
  }).catch(() => {});

  return toViolation(record, record.policy.name);
}

// ── Stats ──

export async function getViolationStats(
  orgId: string,
  since?: Date,
): Promise<GovernanceStats> {
  const sinceDate = since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const where: Prisma.GovernanceViolationWhereInput = {
    orgId,
    createdAt: { gte: sinceDate },
  };

  const [total, open, bySeverityRaw, topPoliciesRaw] = await Promise.all([
    prisma.governanceViolation.count({ where }),
    prisma.governanceViolation.count({ where: { ...where, status: 'open' } }),
    prisma.governanceViolation.groupBy({
      by: ['severity'],
      where,
      _count: true,
    }),
    prisma.governanceViolation.groupBy({
      by: ['policyId'],
      where,
      _count: true,
      orderBy: { _count: { policyId: 'desc' } },
      take: 5,
    }),
  ]);

  const bySeverity: Record<GovernanceSeverity, number> = { info: 0, warning: 0, critical: 0 };
  for (const row of bySeverityRaw) {
    bySeverity[row.severity] = row._count;
  }

  // By day for chart — last 30 days
  const byDay: Array<{ date: string; count: number }> = [];
  const dayMap = new Map<string, number>();
  const violations = await prisma.governanceViolation.findMany({
    where,
    select: { createdAt: true },
  });
  for (const v of violations) {
    const day = v.createdAt.toISOString().slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }
  // Fill all 30 days
  for (let i = 29; i >= 0; i--) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    byDay.push({ date, count: dayMap.get(date) ?? 0 });
  }

  // Resolve policy names
  const policyIds = topPoliciesRaw.map((r) => r.policyId);
  const policyNames = await prisma.governancePolicy.findMany({
    where: { id: { in: policyIds } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(policyNames.map((p) => [p.id, p.name]));

  return {
    totalViolations: total,
    openViolations: open,
    bySeverity,
    byDay,
    topPolicies: topPoliciesRaw.map((r) => ({
      policyId: r.policyId,
      policyName: nameMap.get(r.policyId) ?? 'Unknown',
      count: r._count,
    })),
  };
}

// ── Compliance Export (Phase 3) ──

export async function exportViolations(
  orgId: string,
  since?: Date,
  until?: Date,
  format: 'csv' | 'json' = 'csv',
): Promise<{ contentType: string; data: string }> {
  const where: Prisma.GovernanceViolationWhereInput = {
    orgId,
    ...(since || until
      ? {
          createdAt: {
            ...(since && { gte: since }),
            ...(until && { lte: until }),
          },
        }
      : {}),
  };

  const records = await prisma.governanceViolation.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      policy: { select: { name: true } },
      user: { select: { name: true, email: true } },
      reviewer: { select: { name: true } },
    },
  });

  if (format === 'json') {
    return {
      contentType: 'application/json',
      data: JSON.stringify(records.map((r) => ({
        timestamp: r.createdAt.toISOString(),
        userEmail: r.user.email,
        userName: r.user.name,
        policyName: r.policy.name,
        severity: r.severity,
        contentSnippet: r.contentSnippet,
        matchDetails: r.matchDetails,
        enforcement: r.enforcement,
        status: r.status,
        reviewerName: r.reviewer?.name ?? null,
        reviewNote: r.reviewNote,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
      })), null, 2),
    };
  }

  // CSV
  const header = 'timestamp,user_email,user_name,policy_name,severity,content_snippet,enforcement,status,reviewer,review_note,reviewed_at';
  const rows = records.map((r) => {
    const escape = (s: string | null) => s ? `"${s.replace(/"/g, '""')}"` : '';
    return [
      r.createdAt.toISOString(),
      escape(r.user.email),
      escape(r.user.name),
      escape(r.policy.name),
      r.severity,
      escape(r.contentSnippet),
      r.enforcement,
      r.status,
      escape(r.reviewer?.name ?? null),
      escape(r.reviewNote),
      r.reviewedAt?.toISOString() ?? '',
    ].join(',');
  });

  return {
    contentType: 'text/csv',
    data: [header, ...rows].join('\n'),
  };
}

// ── Helpers ──

function toPolicy(record: {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  category: string;
  severity: string;
  ruleType: string;
  ruleConfig: unknown;
  enforcement: string;
  scope: unknown;
  enabled: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}): GovernancePolicy {
  return {
    id: record.id,
    orgId: record.orgId,
    name: record.name,
    description: record.description,
    category: record.category as GovernancePolicy['category'],
    severity: record.severity as GovernancePolicy['severity'],
    ruleType: record.ruleType as GovernancePolicy['ruleType'],
    ruleConfig: record.ruleConfig as Record<string, unknown>,
    enforcement: record.enforcement as GovernancePolicy['enforcement'],
    scope: record.scope as Record<string, unknown>,
    enabled: record.enabled,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toViolation(
  record: {
    id: string;
    orgId: string;
    policyId: string;
    userId: string;
    sessionId: string;
    messageId: string | null;
    messageRole: string;
    severity: string;
    contentSnippet: string;
    matchDetails: unknown;
    enforcement: string;
    status: string;
    reviewedBy: string | null;
    reviewNote: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
  },
  policyName?: string,
): GovernanceViolation {
  return {
    id: record.id,
    orgId: record.orgId,
    policyId: record.policyId,
    policyName,
    userId: record.userId,
    sessionId: record.sessionId,
    messageId: record.messageId,
    messageRole: record.messageRole,
    severity: record.severity as GovernanceViolation['severity'],
    contentSnippet: record.contentSnippet,
    matchDetails: record.matchDetails as Record<string, unknown>,
    enforcement: record.enforcement as GovernanceViolation['enforcement'],
    status: record.status as GovernanceViolation['status'],
    reviewedBy: record.reviewedBy,
    reviewNote: record.reviewNote,
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}
