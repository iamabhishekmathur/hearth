import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──
// Mirrors governance-service.test.ts so this file can stand alone. It ADDS the
// cases the existing suite does not cover: GOV-E-07 (llm_evaluation fails OPEN)
// and GOV-VIOL-22 (teamIds-only scope returns true for everyone).

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    org: { findUnique: vi.fn(), update: vi.fn() },
    governancePolicy: { findMany: vi.fn() },
    governanceViolation: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../ws/socket-manager.js', () => ({
  emitToOrg: vi.fn(),
  emitToSession: vi.fn(),
  emitToSessionEvent: vi.fn(),
}));

vi.mock('./audit-service.js', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../llm/provider-registry.js', () => ({
  providerRegistry: { chatWithFallback: vi.fn() },
}));

import { prisma } from '../lib/prisma.js';
import { providerRegistry } from '../llm/provider-registry.js';
import { evaluateMessage, _clearPolicyCache } from './governance-service.js';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const ORG_ID = 'org-1';
const USER_ID = 'user-1';
const SESSION_ID = 'session-1';
const NOW = new Date('2026-06-09T12:00:00Z');

function makePolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'policy-1',
    orgId: ORG_ID,
    name: 'Sensitive',
    description: 'Block sensitive content',
    category: 'data_privacy',
    severity: 'critical',
    ruleType: 'keyword',
    ruleConfig: { keywords: ['banned'], matchMode: 'any', caseSensitive: false },
    enforcement: 'block',
    scope: {},
    enabled: true,
    createdBy: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function enableGovernance() {
  asMock(prisma.org.findUnique).mockResolvedValue({
    settings: {
      governance: {
        enabled: true,
        checkUserMessages: true,
        checkAiResponses: false,
        notifyAdmins: true,
        monitoringBanner: true,
      },
    },
  });
}

function callEvaluate(content: string, userId = USER_ID) {
  return evaluateMessage({
    orgId: ORG_ID,
    userId,
    sessionId: SESSION_ID,
    messageId: 'msg-1',
    messageRole: 'user',
    content,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _clearPolicyCache();
  enableGovernance();
  asMock(prisma.user.findUnique).mockResolvedValue({ name: 'Test User' });
  asMock(prisma.governanceViolation.create).mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'violation-1',
      status: 'open',
      reviewedBy: null,
      reviewNote: null,
      reviewedAt: null,
      createdAt: NOW,
      ...data,
    }),
  );
  asMock(prisma.auditLog.create).mockResolvedValue({ id: 'audit-1', createdAt: NOW });
});

// ── GOV-E-07: llm_evaluation fails OPEN ──

describe('GOV-E-07: llm_evaluation provider failure', () => {
  it('DEFECT (GOV-E-07): a BLOCK policy fails OPEN when the LLM provider errors (pins current behavior)', async () => {
    // DEFECT (GOV-E-07 / Part 3 #9): evaluateLLM swallows provider errors and
    // returns { matched: false }. A block-enforcement llm_evaluation policy
    // therefore produces NO violation when the provider is down — content that
    // should be blocked passes. When hardened to fail closed this flips.
    asMock(prisma.governancePolicy.findMany).mockResolvedValue([
      makePolicy({
        ruleType: 'llm_evaluation',
        ruleConfig: { prompt: 'Does this leak secrets?' },
        enforcement: 'block',
      }),
    ]);
    asMock(providerRegistry.chatWithFallback).mockImplementation(() => {
      throw new Error('all providers down');
    });

    const violations = await callEvaluate('here is a secret value');

    // Current behavior: no violation recorded — fails open.
    expect(violations).toHaveLength(0);
    expect(prisma.governanceViolation.create).not.toHaveBeenCalled();
  });

  it('DEFECT (GOV-E-07): fails open when the stream rejects mid-iteration', async () => {
    asMock(prisma.governancePolicy.findMany).mockResolvedValue([
      makePolicy({
        ruleType: 'llm_evaluation',
        ruleConfig: { prompt: 'check' },
        enforcement: 'block',
      }),
    ]);
    // eslint-disable-next-line require-yield
    async function* broken() {
      throw new Error('stream error');
    }
    asMock(providerRegistry.chatWithFallback).mockReturnValue(broken());

    const violations = await callEvaluate('anything');
    expect(violations).toHaveLength(0);
  });

  it('control: a healthy LLM still flags a VIOLATION response', async () => {
    asMock(prisma.governancePolicy.findMany).mockResolvedValue([
      makePolicy({ ruleType: 'llm_evaluation', ruleConfig: { prompt: 'check' } }),
    ]);
    async function* ok() {
      yield { type: 'text_delta' as const, content: 'VIOLATION: leaked data' };
      yield { type: 'done' as const, usage: { input_tokens: 10, output_tokens: 5 } };
    }
    asMock(providerRegistry.chatWithFallback).mockReturnValue(ok());

    const violations = await callEvaluate('leaked data here');
    expect(violations).toHaveLength(1);
  });
});

// ── GOV-VIOL-22: teamIds-only scope returns true for everyone ──

describe('GOV-VIOL-22: team scoping not enforced', () => {
  it('DEFECT (GOV-VIOL-22): a teamIds-only scope applies to EVERY user (pins current behavior)', async () => {
    // DEFECT (GOV-VIOL-22 / Part 3 #9): policyApplies returns true when a policy
    // is scoped to teamIds only (no userIds) — team membership is never checked.
    // A user who is NOT in the scoped team still gets evaluated/flagged. When team
    // scoping is wired this flips to no violation for out-of-team users.
    asMock(prisma.governancePolicy.findMany).mockResolvedValue([
      makePolicy({
        scope: { teamIds: ['team-finance'] },
        ruleConfig: { keywords: ['banned'], matchMode: 'any', caseSensitive: false },
      }),
    ]);

    const violations = await callEvaluate('this is banned content', 'user-outside-team');

    // Current behavior: violation IS created even though the user isn't in team-finance.
    expect(violations).toHaveLength(1);
    expect(prisma.governanceViolation.create).toHaveBeenCalledTimes(1);
  });

  it('control: a userIds scope correctly excludes a non-listed user', async () => {
    asMock(prisma.governancePolicy.findMany).mockResolvedValue([
      makePolicy({
        scope: { userIds: ['someone-else'] },
        ruleConfig: { keywords: ['banned'], matchMode: 'any', caseSensitive: false },
      }),
    ]);

    const violations = await callEvaluate('this is banned content', 'user-1');
    expect(violations).toHaveLength(0);
  });

  it('control: a userIds scope includes the listed user', async () => {
    asMock(prisma.governancePolicy.findMany).mockResolvedValue([
      makePolicy({
        scope: { userIds: ['user-1'] },
        ruleConfig: { keywords: ['banned'], matchMode: 'any', caseSensitive: false },
      }),
    ]);

    const violations = await callEvaluate('this is banned content', 'user-1');
    expect(violations).toHaveLength(1);
  });

  it('DEFECT (GOV-VIOL-22): a combined teamIds+userIds scope still applies via the userIds path only', async () => {
    // With both set, only the userIds membership gates evaluation; the teamIds part
    // is inert. A user listed in userIds is evaluated; the team list is ignored.
    asMock(prisma.governancePolicy.findMany).mockResolvedValue([
      makePolicy({
        scope: { teamIds: ['team-x'], userIds: ['user-1'] },
        ruleConfig: { keywords: ['banned'], matchMode: 'any', caseSensitive: false },
      }),
    ]);

    const inUser = await callEvaluate('banned content', 'user-1');
    expect(inUser).toHaveLength(1);
  });
});
