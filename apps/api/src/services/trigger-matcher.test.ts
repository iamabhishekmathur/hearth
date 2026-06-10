import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──
// The matching helpers (event type + filter evaluation) are private, so we drive
// them through findMatchingTriggers by stubbing the prisma query to return a set
// of candidate triggers and asserting which survive the in-memory filter.

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    routineTrigger: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { prisma } from '../lib/prisma.js';
import { findMatchingTriggers } from './trigger-matcher.js';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function makeTrigger(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trigger-1',
    eventType: 'push',
    filters: {},
    routine: { id: 'r1', userId: 'u1', enabled: true, prompt: 'p', parameters: {} },
    ...overrides,
  };
}

async function match(triggers: unknown[], eventType: string, payload: Record<string, unknown>) {
  asMock(prisma.routineTrigger.findMany).mockResolvedValue(triggers);
  return findMatchingTriggers('endpoint-1', eventType, payload);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Event type matching (TRIG-H-03/H-04) ──

describe('event type matching', () => {
  it('matches an exact event type', async () => {
    const result = await match([makeTrigger({ eventType: 'push' })], 'push', {});
    expect(result).toHaveLength(1);
  });

  it('does not match a different event type', async () => {
    const result = await match([makeTrigger({ eventType: 'pull_request' })], 'push', {});
    expect(result).toHaveLength(0);
  });

  it('matches a bare "*" wildcard against any event (TRIG-H-04)', async () => {
    const result = await match([makeTrigger({ eventType: '*' })], 'anything.here', {});
    expect(result).toHaveLength(1);
  });

  it('matches a "prefix.*" wildcard (TRIG-H-04)', async () => {
    const result = await match(
      [makeTrigger({ eventType: 'pull_request.*' })],
      'pull_request.opened',
      {},
    );
    expect(result).toHaveLength(1);
  });

  it('does not match a prefix wildcard against a different prefix', async () => {
    const result = await match(
      [makeTrigger({ eventType: 'pull_request.*' })],
      'issues.opened',
      {},
    );
    expect(result).toHaveLength(0);
  });

  it('queries only active triggers for the endpoint', async () => {
    await match([], 'push', {});
    expect(asMock(prisma.routineTrigger.findMany).mock.calls[0][0].where).toEqual(
      expect.objectContaining({ webhookEndpointId: 'endpoint-1', status: 'active' }),
    );
  });
});

// ── Filter evaluation (TRIG-H-05) ──

describe('filter evaluation', () => {
  it('passes a trigger with no filters', async () => {
    const result = await match([makeTrigger({ filters: {} })], 'push', { anything: true });
    expect(result).toHaveLength(1);
  });

  it('matches an implicit equality filter', async () => {
    const result = await match(
      [makeTrigger({ filters: { action: 'opened' } })],
      'push',
      { action: 'opened' },
    );
    expect(result).toHaveLength(1);
  });

  it('rejects an implicit equality filter that does not match', async () => {
    const result = await match(
      [makeTrigger({ filters: { action: 'opened' } })],
      'push',
      { action: 'closed' },
    );
    expect(result).toHaveLength(0);
  });

  it('matches a $eq operator (TRIG-H-05)', async () => {
    const result = await match(
      [makeTrigger({ filters: { 'repo.name': { $eq: 'hearth' } } })],
      'push',
      { repo: { name: 'hearth' } },
    );
    expect(result).toHaveLength(1);
  });

  it('resolves nested dot-notation fields', async () => {
    const result = await match(
      [makeTrigger({ filters: { 'a.b.c': { $eq: 42 } } })],
      'push',
      { a: { b: { c: 42 } } },
    );
    expect(result).toHaveLength(1);
  });

  it('treats a missing nested field as undefined (no match for $eq)', async () => {
    const result = await match(
      [makeTrigger({ filters: { 'a.b': { $eq: 'x' } } })],
      'push',
      { a: {} },
    );
    expect(result).toHaveLength(0);
  });

  it('matches a $not operator', async () => {
    const result = await match(
      [makeTrigger({ filters: { action: { $not: 'closed' } } })],
      'push',
      { action: 'opened' },
    );
    expect(result).toHaveLength(1);
  });

  it('rejects a $not operator when value equals the excluded value', async () => {
    const result = await match(
      [makeTrigger({ filters: { action: { $not: 'closed' } } })],
      'push',
      { action: 'closed' },
    );
    expect(result).toHaveLength(0);
  });

  it('matches a $contains operator on a string', async () => {
    const result = await match(
      [makeTrigger({ filters: { title: { $contains: 'urgent' } } })],
      'push',
      { title: 'this is urgent please' },
    );
    expect(result).toHaveLength(1);
  });

  it('rejects $contains when the substring is absent', async () => {
    const result = await match(
      [makeTrigger({ filters: { title: { $contains: 'urgent' } } })],
      'push',
      { title: 'all good' },
    );
    expect(result).toHaveLength(0);
  });

  it('rejects $contains when the value is not a string', async () => {
    const result = await match(
      [makeTrigger({ filters: { count: { $contains: '5' } } })],
      'push',
      { count: 5 },
    );
    expect(result).toHaveLength(0);
  });

  it('matches a $in operator', async () => {
    const result = await match(
      [makeTrigger({ filters: { state: { $in: ['open', 'reopened'] } } })],
      'push',
      { state: 'reopened' },
    );
    expect(result).toHaveLength(1);
  });

  it('rejects a $in operator when value is not in the list', async () => {
    const result = await match(
      [makeTrigger({ filters: { state: { $in: ['open', 'reopened'] } } })],
      'push',
      { state: 'closed' },
    );
    expect(result).toHaveLength(0);
  });

  it('requires ALL filter conditions to pass (AND semantics)', async () => {
    const result = await match(
      [makeTrigger({ filters: { action: 'opened', 'repo.name': { $eq: 'hearth' } } })],
      'push',
      { action: 'opened', repo: { name: 'other' } },
    );
    expect(result).toHaveLength(0);
  });

  it('filters a mixed batch, keeping only matching triggers', async () => {
    const result = await match(
      [
        makeTrigger({ id: 't1', eventType: 'push', filters: {} }),
        makeTrigger({ id: 't2', eventType: 'pull_request', filters: {} }),
        makeTrigger({ id: 't3', eventType: 'push', filters: { action: 'opened' } }),
      ],
      'push',
      { action: 'closed' },
    );
    expect(result.map((t) => t.id)).toEqual(['t1']);
  });
});
