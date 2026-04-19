import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    org: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    governancePolicy: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    governanceViolation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
      groupBy: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
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
  providerRegistry: {
    chatWithFallback: vi.fn(),
  },
}));

import { prisma } from '../lib/prisma.js';
import { emitToOrg, emitToSessionEvent } from '../ws/socket-manager.js';
import { logAudit } from './audit-service.js';
import { providerRegistry } from '../llm/provider-registry.js';
import {
  getGovernanceSettings,
  updateGovernanceSettings,
  createPolicy,
  updatePolicy,
  deletePolicy,
  listPolicies,
  getPolicy,
  evaluateMessage,
  hasBlockPolicies,
  listViolations,
  getViolation,
  reviewViolation,
  getViolationStats,
  exportViolations,
  _clearPolicyCache,
} from './governance-service.js';

// ── Helpers ──

const ORG_ID = 'org-1';
const USER_ID = 'user-1';
const SESSION_ID = 'session-1';
const NOW = new Date('2026-04-17T12:00:00Z');

function makePolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'policy-1',
    orgId: ORG_ID,
    name: 'No PII',
    description: 'Block PII sharing',
    category: 'data_privacy',
    severity: 'warning',
    ruleType: 'keyword',
    ruleConfig: { keywords: ['password', 'SSN'], matchMode: 'any', caseSensitive: false },
    enforcement: 'monitor',
    scope: {},
    enabled: true,
    createdBy: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeViolation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'violation-1',
    orgId: ORG_ID,
    policyId: 'policy-1',
    userId: USER_ID,
    sessionId: SESSION_ID,
    messageId: 'msg-1',
    messageRole: 'user',
    severity: 'warning',
    contentSnippet: 'my password is 1234',
    matchDetails: { matchedKeywords: ['password'] },
    enforcement: 'monitor',
    status: 'open',
    reviewedBy: null,
    reviewNote: null,
    reviewedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
  _clearPolicyCache();
});

describe('Governance Settings', () => {
  it('returns default settings when org has no governance config', async () => {
    (prisma.org.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      settings: {},
    });

    const settings = await getGovernanceSettings(ORG_ID);
    expect(settings).toEqual({
      enabled: false,
      checkUserMessages: true,
      checkAiResponses: false,
      notifyAdmins: true,
      monitoringBanner: true,
    });
  });

  it('returns stored settings when governance config exists', async () => {
    (prisma.org.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      settings: {
        governance: {
          enabled: true,
          checkUserMessages: true,
          checkAiResponses: true,
          notifyAdmins: false,
          monitoringBanner: false,
        },
      },
    });

    const settings = await getGovernanceSettings(ORG_ID);
    expect(settings.enabled).toBe(true);
    expect(settings.checkAiResponses).toBe(true);
    expect(settings.notifyAdmins).toBe(false);
  });

  it('updates governance settings in org JSON', async () => {
    (prisma.org.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      settings: { existingKey: 'preserved' },
    });
    (prisma.org.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await updateGovernanceSettings(ORG_ID, {
      enabled: true,
      checkUserMessages: true,
      checkAiResponses: false,
      notifyAdmins: true,
      monitoringBanner: true,
    });

    expect(prisma.org.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ORG_ID },
        data: expect.objectContaining({
          settings: expect.objectContaining({
            existingKey: 'preserved',
            governance: expect.objectContaining({ enabled: true }),
          }),
        }),
      }),
    );
  });
});

describe('Policy CRUD', () => {
  it('creates a policy and invalidates cache', async () => {
    const created = makePolicy();
    (prisma.governancePolicy.create as ReturnType<typeof vi.fn>).mockResolvedValue(created);

    const result = await createPolicy(ORG_ID, USER_ID, {
      name: 'No PII',
      ruleType: 'keyword',
      ruleConfig: { keywords: ['password'] },
    });

    expect(result.id).toBe('policy-1');
    expect(result.name).toBe('No PII');
    expect(prisma.governancePolicy.create).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'governance_policy_change',
        entityType: 'governance_policy',
      }),
    );
  });

  it('updates a policy', async () => {
    const updated = makePolicy({ name: 'Updated Name' });
    (prisma.governancePolicy.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const result = await updatePolicy('policy-1', ORG_ID, { name: 'Updated Name' });
    expect(result.name).toBe('Updated Name');
  });

  it('deletes a policy and its violations', async () => {
    (prisma.governanceViolation.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 5 });
    (prisma.governancePolicy.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await deletePolicy('policy-1', ORG_ID);
    expect(prisma.governanceViolation.deleteMany).toHaveBeenCalledWith({
      where: { policyId: 'policy-1', orgId: ORG_ID },
    });
    expect(prisma.governancePolicy.delete).toHaveBeenCalledWith({
      where: { id: 'policy-1', orgId: ORG_ID },
    });
  });

  it('lists policies with violation counts', async () => {
    (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...makePolicy(), _count: { violations: 3 } },
      { ...makePolicy({ id: 'policy-2', name: 'No Secrets' }), _count: { violations: 0 } },
    ]);

    const policies = await listPolicies(ORG_ID);
    expect(policies).toHaveLength(2);
    expect(policies[0].violationCount).toBe(3);
    expect(policies[1].violationCount).toBe(0);
  });

  it('gets a single policy', async () => {
    (prisma.governancePolicy.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makePolicy());

    const policy = await getPolicy('policy-1', ORG_ID);
    expect(policy).not.toBeNull();
    expect(policy!.id).toBe('policy-1');
  });

  it('returns null for non-existent policy', async () => {
    (prisma.governancePolicy.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const policy = await getPolicy('nonexistent', ORG_ID);
    expect(policy).toBeNull();
  });
});

describe('evaluateMessage', () => {
  function setupGovernanceEnabled() {
    (prisma.org.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
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

  function setupGovernanceDisabled() {
    (prisma.org.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      settings: { governance: { enabled: false } },
    });
  }

  it('returns empty array when governance is disabled', async () => {
    setupGovernanceDisabled();

    const violations = await evaluateMessage({
      orgId: ORG_ID,
      userId: USER_ID,
      sessionId: SESSION_ID,
      messageId: 'msg-1',
      messageRole: 'user',
      content: 'my password is hunter2',
    });

    expect(violations).toEqual([]);
    expect(prisma.governanceViolation.create).not.toHaveBeenCalled();
  });

  it('skips AI response checking when checkAiResponses is off', async () => {
    setupGovernanceEnabled();
    // checkAiResponses is false in setupGovernanceEnabled

    const violations = await evaluateMessage({
      orgId: ORG_ID,
      userId: USER_ID,
      sessionId: SESSION_ID,
      messageId: 'msg-1',
      messageRole: 'assistant',
      content: 'here is your password: hunter2',
    });

    expect(violations).toEqual([]);
  });

  describe('keyword matching', () => {
    beforeEach(() => {
      setupGovernanceEnabled();
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Test User' });
    });

    it('detects keyword match (any mode)', async () => {
      // Seed cache by providing policies
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          ruleConfig: { keywords: ['password', 'SSN'], matchMode: 'any', caseSensitive: false },
        }),
      ]);

      const violation = makeViolation();
      (prisma.governanceViolation.create as ReturnType<typeof vi.fn>).mockResolvedValue(violation);
      (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'audit-1', createdAt: NOW });

      const violations = await evaluateMessage({
        orgId: ORG_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'my password is hunter2',
      });

      expect(violations).toHaveLength(1);
      expect(violations[0].severity).toBe('warning');
      expect(prisma.governanceViolation.create).toHaveBeenCalledTimes(1);
    });

    it('does NOT match when keyword is absent', async () => {
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          ruleConfig: { keywords: ['password', 'SSN'], matchMode: 'any', caseSensitive: false },
        }),
      ]);

      const violations = await evaluateMessage({
        orgId: ORG_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'what is the weather today?',
      });

      expect(violations).toHaveLength(0);
      expect(prisma.governanceViolation.create).not.toHaveBeenCalled();
    });

    it('case-insensitive keyword match', async () => {
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          ruleConfig: { keywords: ['SECRET'], matchMode: 'any', caseSensitive: false },
        }),
      ]);

      const violation = makeViolation();
      (prisma.governanceViolation.create as ReturnType<typeof vi.fn>).mockResolvedValue(violation);
      (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'audit-1', createdAt: NOW });

      const violations = await evaluateMessage({
        orgId: ORG_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'the secret is out',
      });

      expect(violations).toHaveLength(1);
    });

    it('case-sensitive keyword match only when configured', async () => {
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          ruleConfig: { keywords: ['SECRET'], matchMode: 'any', caseSensitive: true },
        }),
      ]);

      // lowercase "secret" should NOT match case-sensitive "SECRET"
      const violations = await evaluateMessage({
        orgId: ORG_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'the secret is out',
      });

      expect(violations).toHaveLength(0);
    });

    it('match mode "all" requires every keyword present', async () => {
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          ruleConfig: { keywords: ['password', 'email'], matchMode: 'all', caseSensitive: false },
        }),
      ]);

      // Only "password" is present, not "email"
      const violations = await evaluateMessage({
        orgId: ORG_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'my password is hunter2',
      });

      expect(violations).toHaveLength(0);
    });

    it('match mode "all" matches when all keywords present', async () => {
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          ruleConfig: { keywords: ['password', 'email'], matchMode: 'all', caseSensitive: false },
        }),
      ]);

      const violation = makeViolation();
      (prisma.governanceViolation.create as ReturnType<typeof vi.fn>).mockResolvedValue(violation);
      (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'audit-1', createdAt: NOW });

      const violations = await evaluateMessage({
        orgId: ORG_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'my email password is hunter2',
      });

      expect(violations).toHaveLength(1);
    });
  });

  describe('regex matching', () => {
    beforeEach(() => {
      setupGovernanceEnabled();
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Test User' });
    });

    it('detects regex match (SSN pattern)', async () => {
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          ruleType: 'regex',
          ruleConfig: { pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b', flags: '' },
        }),
      ]);

      const violation = makeViolation();
      (prisma.governanceViolation.create as ReturnType<typeof vi.fn>).mockResolvedValue(violation);
      (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'audit-1', createdAt: NOW });

      const violations = await evaluateMessage({
        orgId: ORG_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'my SSN is 123-45-6789',
      });

      expect(violations).toHaveLength(1);
    });

    it('does NOT match when regex does not match', async () => {
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          ruleType: 'regex',
          ruleConfig: { pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b', flags: '' },
        }),
      ]);

      const violations = await evaluateMessage({
        orgId: ORG_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'just a normal message',
      });

      expect(violations).toHaveLength(0);
    });

    it('handles invalid regex gracefully', async () => {
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          ruleType: 'regex',
          ruleConfig: { pattern: '[invalid', flags: '' },
        }),
      ]);

      const violations = await evaluateMessage({
        orgId: ORG_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'anything here',
      });

      // Should not crash, should return no violations
      expect(violations).toHaveLength(0);
    });
  });

  describe('LLM evaluation (Phase 2)', () => {
    beforeEach(() => {
      setupGovernanceEnabled();
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Test User' });
    });

    async function* streamLLMResponse(text: string) {
      yield { type: 'text_delta' as const, content: text };
      yield { type: 'done' as const, usage: { input_tokens: 100, output_tokens: 10 } };
    }

    it('detects LLM violation', async () => {
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          ruleType: 'llm_evaluation',
          ruleConfig: { prompt: 'Does this share PII?' },
          description: 'No PII sharing',
        }),
      ]);

      (providerRegistry.chatWithFallback as ReturnType<typeof vi.fn>).mockReturnValue(
        streamLLMResponse('VIOLATION: Contains email address'),
      );

      const violation = makeViolation();
      (prisma.governanceViolation.create as ReturnType<typeof vi.fn>).mockResolvedValue(violation);
      (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'audit-1', createdAt: NOW });

      const violations = await evaluateMessage({
        orgId: ORG_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'my email is john@example.com',
      });

      expect(violations).toHaveLength(1);
      expect(providerRegistry.chatWithFallback).toHaveBeenCalledTimes(1);
    });

    it('does NOT flag when LLM says PASS', async () => {
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          ruleType: 'llm_evaluation',
          ruleConfig: { prompt: 'Does this share PII?' },
        }),
      ]);

      (providerRegistry.chatWithFallback as ReturnType<typeof vi.fn>).mockReturnValue(
        streamLLMResponse('PASS'),
      );

      const violations = await evaluateMessage({
        orgId: ORG_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'what is the weather?',
      });

      expect(violations).toHaveLength(0);
    });
  });

  describe('enforcement modes', () => {
    beforeEach(() => {
      setupGovernanceEnabled();
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Test User' });
    });

    it('emits governance:warning event for warn enforcement', async () => {
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          enforcement: 'warn',
          ruleConfig: { keywords: ['danger'], matchMode: 'any', caseSensitive: false },
        }),
      ]);

      const violation = makeViolation({ enforcement: 'warn' });
      (prisma.governanceViolation.create as ReturnType<typeof vi.fn>).mockResolvedValue(violation);
      (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'audit-1', createdAt: NOW });

      await evaluateMessage({
        orgId: ORG_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'this is danger zone',
      });

      expect(emitToSessionEvent).toHaveBeenCalledWith(
        SESSION_ID,
        'governance:warning',
        expect.objectContaining({
          messageId: 'msg-1',
          policyName: 'No PII',
        }),
      );
    });

    it('emits governance:violation to org room when notifyAdmins is on', async () => {
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          ruleConfig: { keywords: ['secret'], matchMode: 'any', caseSensitive: false },
        }),
      ]);

      const violation = makeViolation();
      (prisma.governanceViolation.create as ReturnType<typeof vi.fn>).mockResolvedValue(violation);
      (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'audit-1', createdAt: NOW });

      await evaluateMessage({
        orgId: ORG_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'the secret code is XYZ',
      });

      expect(emitToOrg).toHaveBeenCalledWith(
        ORG_ID,
        'governance:violation',
        expect.objectContaining({
          userId: USER_ID,
          userName: 'Test User',
          policyName: 'No PII',
          severity: 'warning',
        }),
      );
    });

    it('creates audit log for violations', async () => {
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          ruleConfig: { keywords: ['password'], matchMode: 'any', caseSensitive: false },
        }),
      ]);

      const violation = makeViolation();
      (prisma.governanceViolation.create as ReturnType<typeof vi.fn>).mockResolvedValue(violation);
      (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'audit-1', createdAt: NOW });

      await evaluateMessage({
        orgId: ORG_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'password is abc123',
      });

      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: ORG_ID,
          userId: USER_ID,
          action: 'governance_violation',
          entityType: 'governance_violation',
        }),
      );
    });
  });

  describe('multiple policies', () => {
    beforeEach(() => {
      setupGovernanceEnabled();
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Test User' });
      (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'audit-1', createdAt: NOW });
    });

    it('evaluates all policies and returns all violations', async () => {
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          id: 'policy-keyword',
          name: 'No Passwords',
          ruleConfig: { keywords: ['password'], matchMode: 'any', caseSensitive: false },
        }),
        makePolicy({
          id: 'policy-regex',
          name: 'No SSN',
          ruleType: 'regex',
          ruleConfig: { pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b', flags: '' },
        }),
      ]);

      (prisma.governanceViolation.create as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeViolation({ id: 'v1', policyId: 'policy-keyword' }))
        .mockResolvedValueOnce(makeViolation({ id: 'v2', policyId: 'policy-regex' }));

      const violations = await evaluateMessage({
        orgId: ORG_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'password is linked to SSN 123-45-6789',
      });

      expect(violations).toHaveLength(2);
      expect(prisma.governanceViolation.create).toHaveBeenCalledTimes(2);
    });

    it('skips disabled policies (not in cache)', async () => {
      // Cache only returns enabled policies
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({ enabled: true, ruleConfig: { keywords: ['password'], matchMode: 'any', caseSensitive: false } }),
        // disabled policy would NOT be returned by the cache query
      ]);

      const violation = makeViolation();
      (prisma.governanceViolation.create as ReturnType<typeof vi.fn>).mockResolvedValue(violation);

      const violations = await evaluateMessage({
        orgId: ORG_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'my password is abc',
      });

      expect(violations).toHaveLength(1);
    });
  });

  describe('scope filtering (Phase 3)', () => {
    beforeEach(() => {
      setupGovernanceEnabled();
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Test User' });
    });

    it('applies policy with empty scope to all users', async () => {
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          scope: {},
          ruleConfig: { keywords: ['banned'], matchMode: 'any', caseSensitive: false },
        }),
      ]);

      const violation = makeViolation();
      (prisma.governanceViolation.create as ReturnType<typeof vi.fn>).mockResolvedValue(violation);
      (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'audit-1', createdAt: NOW });

      const violations = await evaluateMessage({
        orgId: ORG_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'banned word here',
      });

      expect(violations).toHaveLength(1);
    });

    it('applies policy scoped to specific user', async () => {
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          scope: { userIds: ['user-1'] },
          ruleConfig: { keywords: ['banned'], matchMode: 'any', caseSensitive: false },
        }),
      ]);

      const violation = makeViolation();
      (prisma.governanceViolation.create as ReturnType<typeof vi.fn>).mockResolvedValue(violation);
      (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'audit-1', createdAt: NOW });

      const violations = await evaluateMessage({
        orgId: ORG_ID,
        userId: 'user-1',
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'banned content',
      });

      expect(violations).toHaveLength(1);
    });

    it('skips policy scoped to different user', async () => {
      (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makePolicy({
          scope: { userIds: ['user-other'] },
          ruleConfig: { keywords: ['banned'], matchMode: 'any', caseSensitive: false },
        }),
      ]);

      const violations = await evaluateMessage({
        orgId: ORG_ID,
        userId: 'user-1',
        sessionId: SESSION_ID,
        messageId: 'msg-1',
        messageRole: 'user',
        content: 'banned content',
      });

      expect(violations).toHaveLength(0);
    });
  });
});

describe('hasBlockPolicies', () => {
  it('returns true when a block policy exists', async () => {
    (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makePolicy({ enforcement: 'block' }),
    ]);

    const result = await hasBlockPolicies(ORG_ID);
    expect(result).toBe(true);
  });

  it('returns false when no block policy exists', async () => {
    (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makePolicy({ enforcement: 'monitor' }),
      makePolicy({ id: 'p2', enforcement: 'warn' }),
    ]);

    const result = await hasBlockPolicies(ORG_ID);
    expect(result).toBe(false);
  });
});

describe('Violation Review Workflow (Phase 2)', () => {
  it('acknowledges a violation', async () => {
    const reviewed = makeViolation({
      status: 'acknowledged',
      reviewedBy: 'admin-1',
      reviewedAt: NOW,
    });
    (prisma.governanceViolation.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...reviewed,
      policy: { name: 'No PII' },
    });

    const result = await reviewViolation({
      violationId: 'violation-1',
      orgId: ORG_ID,
      reviewerId: 'admin-1',
      status: 'acknowledged',
    });

    expect(result.status).toBe('acknowledged');
    expect(prisma.governanceViolation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'acknowledged',
          reviewedBy: 'admin-1',
        }),
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'governance_policy_change',
        entityType: 'governance_violation',
      }),
    );
  });

  it('dismisses a violation', async () => {
    const reviewed = makeViolation({ status: 'dismissed', reviewedBy: 'admin-1' });
    (prisma.governanceViolation.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...reviewed,
      policy: { name: 'No PII' },
    });

    const result = await reviewViolation({
      violationId: 'violation-1',
      orgId: ORG_ID,
      reviewerId: 'admin-1',
      status: 'dismissed',
    });

    expect(result.status).toBe('dismissed');
  });

  it('escalates a violation with note', async () => {
    const reviewed = makeViolation({
      status: 'escalated',
      reviewedBy: 'admin-1',
      reviewNote: 'needs security team review',
    });
    (prisma.governanceViolation.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...reviewed,
      policy: { name: 'No PII' },
    });

    const result = await reviewViolation({
      violationId: 'violation-1',
      orgId: ORG_ID,
      reviewerId: 'admin-1',
      status: 'escalated',
      note: 'needs security team review',
    });

    expect(result.status).toBe('escalated');
    expect(result.reviewNote).toBe('needs security team review');
  });
});

describe('Violation Queries', () => {
  it('lists violations with pagination', async () => {
    (prisma.governanceViolation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...makeViolation(), policy: { name: 'No PII' }, user: { name: 'Alice' } },
    ]);
    (prisma.governanceViolation.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    const result = await listViolations(ORG_ID, { page: 1, pageSize: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.data[0].policyName).toBe('No PII');
    expect(result.data[0].userName).toBe('Alice');
  });

  it('lists violations with severity filter', async () => {
    (prisma.governanceViolation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.governanceViolation.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    await listViolations(ORG_ID, { severity: 'critical', page: 1 });

    expect(prisma.governanceViolation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: ORG_ID,
          severity: 'critical',
        }),
      }),
    );
  });

  it('gets a single violation with details', async () => {
    (prisma.governanceViolation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...makeViolation(),
      policy: { name: 'No PII' },
      user: { name: 'Alice' },
    });

    const violation = await getViolation('violation-1', ORG_ID);
    expect(violation).not.toBeNull();
    expect(violation!.policyName).toBe('No PII');
    expect(violation!.userName).toBe('Alice');
  });
});

describe('Violation Stats', () => {
  it('aggregates violation statistics', async () => {
    (prisma.governanceViolation.count as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(15)  // total
      .mockResolvedValueOnce(8);  // open
    (prisma.governanceViolation.groupBy as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([  // bySeverity
        { severity: 'warning', _count: 10 },
        { severity: 'critical', _count: 5 },
      ])
      .mockResolvedValueOnce([  // topPolicies
        { policyId: 'policy-1', _count: 12 },
      ]);
    (prisma.governanceViolation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { createdAt: new Date('2026-04-15') },
      { createdAt: new Date('2026-04-15') },
      { createdAt: new Date('2026-04-16') },
    ]);
    (prisma.governancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'policy-1', name: 'No PII' },
    ]);

    const stats = await getViolationStats(ORG_ID);

    expect(stats.totalViolations).toBe(15);
    expect(stats.openViolations).toBe(8);
    expect(stats.bySeverity.warning).toBe(10);
    expect(stats.bySeverity.critical).toBe(5);
    expect(stats.bySeverity.info).toBe(0);
    expect(stats.byDay).toHaveLength(30);
    expect(stats.topPolicies).toHaveLength(1);
    expect(stats.topPolicies[0].policyName).toBe('No PII');
  });
});

describe('Compliance Export (Phase 3)', () => {
  it('exports violations as CSV', async () => {
    (prisma.governanceViolation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        ...makeViolation(),
        policy: { name: 'No PII' },
        user: { name: 'Alice', email: 'alice@example.com' },
        reviewer: null,
      },
    ]);

    const result = await exportViolations(ORG_ID, undefined, undefined, 'csv');
    expect(result.contentType).toBe('text/csv');
    expect(result.data).toContain('timestamp,user_email');
    expect(result.data).toContain('alice@example.com');
    expect(result.data).toContain('No PII');
  });

  it('exports violations as JSON', async () => {
    (prisma.governanceViolation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        ...makeViolation(),
        policy: { name: 'No PII' },
        user: { name: 'Alice', email: 'alice@example.com' },
        reviewer: null,
      },
    ]);

    const result = await exportViolations(ORG_ID, undefined, undefined, 'json');
    expect(result.contentType).toBe('application/json');
    const parsed = JSON.parse(result.data);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].userEmail).toBe('alice@example.com');
    expect(parsed[0].policyName).toBe('No PII');
  });
});
