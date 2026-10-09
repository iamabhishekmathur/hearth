import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock prisma before importing the service. The service only touches
// chatMessage.findFirst (load the plan) and chatMessage.updateMany (the
// idempotent approval flip).
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    chatMessage: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));
vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }));

import { approvePlanForBuild, isActionablePlan } from './plan-service.js';

const PLAN = { steps: [{ index: 1, text: 'do thing' }], summary: 's' };

function planMessage(over: Record<string, unknown> = {}) {
  return {
    id: 'msg_plan',
    orgId: 'org_1',
    metadata: { agentMode: 'plan', plan: { ...PLAN, approved: false } },
    respondingTo: { createdBy: 'priya' },
    ...over,
  };
}

describe('approvePlanForBuild — J3 contract (W4)', () => {
  beforeEach(() => {
    prismaMock.chatMessage.findFirst.mockReset();
    prismaMock.chatMessage.updateMany.mockReset();
  });

  it('not_found when the plan message does not exist', async () => {
    prismaMock.chatMessage.findFirst.mockResolvedValue(null);
    const r = await approvePlanForBuild({ sessionId: 's', messageId: 'm', userId: 'priya', sessionOwnerId: 'priya' });
    expect(r.status).toBe('not_found');
  });

  it('J3 build-without-approval: empty plan → no_plan (route maps to 409)', async () => {
    prismaMock.chatMessage.findFirst.mockResolvedValue(
      planMessage({ metadata: { plan: { steps: [], approved: false } } }),
    );
    const r = await approvePlanForBuild({ sessionId: 's', messageId: 'm', userId: 'priya', sessionOwnerId: 'priya' });
    expect(r.status).toBe('no_plan');
    expect(prismaMock.chatMessage.updateMany).not.toHaveBeenCalled();
  });

  it('J3 build-without-approval: absent plan → no_plan', async () => {
    prismaMock.chatMessage.findFirst.mockResolvedValue(planMessage({ metadata: { agentMode: 'build' } }));
    const r = await approvePlanForBuild({ sessionId: 's', messageId: 'm', userId: 'priya', sessionOwnerId: 'priya' });
    expect(r.status).toBe('no_plan');
  });

  it('J3 approve-by-non-owner: Ben approving Priya’s plan → forbidden (route 403)', async () => {
    prismaMock.chatMessage.findFirst.mockResolvedValue(planMessage());
    const r = await approvePlanForBuild({ sessionId: 's', messageId: 'm', userId: 'ben', sessionOwnerId: 'priya' });
    expect(r.status).toBe('forbidden');
    expect(prismaMock.chatMessage.updateMany).not.toHaveBeenCalled();
  });

  it('owner approves → approved, returns the plan + orgId for the single Build run', async () => {
    prismaMock.chatMessage.findFirst.mockResolvedValue(planMessage());
    prismaMock.chatMessage.updateMany.mockResolvedValue({ count: 1 });
    const r = await approvePlanForBuild({ sessionId: 's', messageId: 'm', userId: 'priya', sessionOwnerId: 'priya' });
    expect(r.status).toBe('approved');
    if (r.status === 'approved') {
      expect(r.orgId).toBe('org_1');
      expect(r.plan.steps).toHaveLength(1);
    }
    // The flip targets only the not-yet-approved row (idempotency guard).
    const where = prismaMock.chatMessage.updateMany.mock.calls[0][0].where;
    expect(where.NOT).toEqual({ metadata: { path: ['plan', 'approved'], equals: true } });
  });

  it('J3 double-approve / double-click: the second flip matches 0 rows → already_approved (no 2nd Build)', async () => {
    prismaMock.chatMessage.findFirst.mockResolvedValue(planMessage());
    // First call wins the flip, second call loses it.
    prismaMock.chatMessage.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const first = await approvePlanForBuild({ sessionId: 's', messageId: 'm', userId: 'priya', sessionOwnerId: 'priya' });
    const second = await approvePlanForBuild({ sessionId: 's', messageId: 'm', userId: 'priya', sessionOwnerId: 'priya' });

    expect(first.status).toBe('approved');
    expect(second.status).toBe('already_approved');
  });

  it('owner falls back to session owner when the plan message has no linked request', async () => {
    prismaMock.chatMessage.findFirst.mockResolvedValue(planMessage({ respondingTo: null }));
    prismaMock.chatMessage.updateMany.mockResolvedValue({ count: 1 });
    const r = await approvePlanForBuild({ sessionId: 's', messageId: 'm', userId: 'priya', sessionOwnerId: 'priya' });
    expect(r.status).toBe('approved');
  });
});

describe('isActionablePlan', () => {
  it('true only for a plan with ≥1 step', () => {
    expect(isActionablePlan({ steps: [{ index: 1, text: 'x' }] })).toBe(true);
    expect(isActionablePlan({ steps: [] })).toBe(false);
    expect(isActionablePlan(null)).toBe(false);
    expect(isActionablePlan(undefined)).toBe(false);
  });
});
