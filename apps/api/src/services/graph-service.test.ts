import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    edge: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import { prisma } from '../lib/prisma.js';
import {
  upsertEdge,
  findOutgoingEdges,
  findIncomingEdges,
  findTasksLinkedToExternalRef,
  navigate,
  type Edge,
} from './graph-service.js';

const upsert = prisma.edge.upsert as ReturnType<typeof vi.fn>;
const findMany = prisma.edge.findMany as ReturnType<typeof vi.fn>;

const ORG = 'org_1';

function edge(overrides: Partial<Edge> = {}): Edge {
  return {
    id: 'e_1',
    orgId: ORG,
    fromType: 'task',
    fromId: 't_1',
    toType: 'person',
    toId: 'p_1',
    kind: 'produced_by',
    weight: null,
    source: 'test',
    externalRef: null,
    stale: false,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('graph-service', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('upsertEdge — internal-to-internal', () => {
    it('creates an edge between two internal entities', async () => {
      upsert.mockResolvedValue(edge());

      const result = await upsertEdge({
        orgId: ORG,
        fromType: 'task',
        fromId: 't_1',
        toType: 'person',
        toId: 'p_1',
        kind: 'produced_by',
        source: 'slack_webhook',
      });

      expect(result.id).toBe('e_1');
      expect(upsert).toHaveBeenCalledOnce();
      const call = upsert.mock.calls[0][0];
      expect(call.where).toEqual({
        orgId_fromType_fromId_toType_toId_kind: {
          orgId: ORG,
          fromType: 'task',
          fromId: 't_1',
          toType: 'person',
          toId: 'p_1',
          kind: 'produced_by',
        },
      });
      expect(call.update).toEqual({});
      expect(call.create.source).toBe('slack_webhook');
    });

    it('is idempotent — same edge upserted twice yields one row', async () => {
      upsert.mockResolvedValue(edge());

      await upsertEdge({
        orgId: ORG,
        fromType: 'task',
        fromId: 't_1',
        toType: 'person',
        toId: 'p_1',
        kind: 'produced_by',
      });
      await upsertEdge({
        orgId: ORG,
        fromType: 'task',
        fromId: 't_1',
        toType: 'person',
        toId: 'p_1',
        kind: 'produced_by',
      });

      expect(upsert).toHaveBeenCalledTimes(2);
      // Both calls hit the same composite unique key — DB layer enforces uniqueness
      expect(upsert.mock.calls[0][0].where).toEqual(upsert.mock.calls[1][0].where);
    });
  });

  describe('upsertEdge — internal-to-external_ref', () => {
    it('creates an edge with externalRef payload', async () => {
      upsert.mockResolvedValue(
        edge({
          toType: 'external_ref',
          toId: 'slack:T_thread_abc',
          kind: 'discussed_in',
          externalRef: { provider: 'slack', externalId: 'T_thread_abc' },
        }),
      );

      const result = await upsertEdge({
        orgId: ORG,
        fromType: 'task',
        fromId: 't_1',
        toType: 'external_ref',
        toId: 'slack:T_thread_abc',
        kind: 'discussed_in',
        externalRef: { provider: 'slack', externalId: 'T_thread_abc' },
        source: 'slack_webhook',
      });

      expect(result.externalRef).toEqual({
        provider: 'slack',
        externalId: 'T_thread_abc',
      });
      expect(upsert.mock.calls[0][0].create.externalRef).toEqual({
        provider: 'slack',
        externalId: 'T_thread_abc',
      });
    });

    it('rejects external_ref edges without an externalRef payload', async () => {
      await expect(
        upsertEdge({
          orgId: ORG,
          fromType: 'task',
          fromId: 't_1',
          toType: 'external_ref',
          toId: 'slack:T_thread_abc',
          kind: 'discussed_in',
          // externalRef omitted
        }),
      ).rejects.toThrow(/externalRef/i);
      expect(upsert).not.toHaveBeenCalled();
    });

    it('rejects external_ref payload on a non-external_ref edge', async () => {
      await expect(
        upsertEdge({
          orgId: ORG,
          fromType: 'task',
          fromId: 't_1',
          toType: 'person',
          toId: 'p_1',
          kind: 'produced_by',
          externalRef: { provider: 'slack', externalId: 'x' },
        }),
      ).rejects.toThrow(/externalRef/i);
    });
  });

  describe('findOutgoingEdges / findIncomingEdges', () => {
    it('finds outgoing edges by from entity', async () => {
      findMany.mockResolvedValue([
        edge({ id: 'e_1', toType: 'person', toId: 'p_1', kind: 'produced_by' }),
        edge({ id: 'e_2', toType: 'meeting', toId: 'm_1', kind: 'discussed_in' }),
      ]);

      const result = await findOutgoingEdges(ORG, 'task', 't_1');

      expect(result).toHaveLength(2);
      expect(findMany.mock.calls[0][0].where).toMatchObject({
        orgId: ORG,
        fromType: 'task',
        fromId: 't_1',
      });
    });

    it('finds incoming edges by to entity', async () => {
      findMany.mockResolvedValue([edge({ id: 'e_1' })]);

      await findIncomingEdges(ORG, 'person', 'p_1');

      expect(findMany.mock.calls[0][0].where).toMatchObject({
        orgId: ORG,
        toType: 'person',
        toId: 'p_1',
      });
    });

    it('filters by edge kind when provided', async () => {
      findMany.mockResolvedValue([]);

      await findOutgoingEdges(ORG, 'task', 't_1', { kind: 'discussed_in' });

      expect(findMany.mock.calls[0][0].where.kind).toBe('discussed_in');
    });

    it('excludes stale edges by default', async () => {
      findMany.mockResolvedValue([]);
      await findOutgoingEdges(ORG, 'task', 't_1');
      expect(findMany.mock.calls[0][0].where.stale).toBe(false);
    });

    it('includes stale edges when requested', async () => {
      findMany.mockResolvedValue([]);
      await findOutgoingEdges(ORG, 'task', 't_1', { includeStale: true });
      expect(findMany.mock.calls[0][0].where.stale).toBeUndefined();
    });
  });

  describe('findTasksLinkedToExternalRef', () => {
    it('finds tasks that point at a Notion page', async () => {
      findMany.mockResolvedValue([
        edge({
          fromType: 'task',
          fromId: 't_1',
          toType: 'external_ref',
          toId: 'notion:page_42',
          kind: 'references',
          externalRef: { provider: 'notion', externalId: 'page_42' },
        }),
      ]);

      const result = await findTasksLinkedToExternalRef(ORG, {
        provider: 'notion',
        externalId: 'page_42',
      });

      expect(result.map((e) => e.fromId)).toEqual(['t_1']);
      const where = findMany.mock.calls[0][0].where;
      expect(where.orgId).toBe(ORG);
      expect(where.fromType).toBe('task');
      expect(where.toType).toBe('external_ref');
    });

    it('returns empty array when no tasks link to the ref', async () => {
      findMany.mockResolvedValue([]);
      const result = await findTasksLinkedToExternalRef(ORG, {
        provider: 'slack',
        externalId: 'never_seen',
      });
      expect(result).toEqual([]);
    });
  });

  describe('navigate — internal BFS', () => {
    it('returns a trace with seed only when depth=0', async () => {
      const trace = await navigate(ORG, { type: 'task', id: 't_1' }, { depth: 0, budget: 10 });
      expect(trace.nodes).toEqual([{ type: 'task', id: 't_1' }]);
      expect(trace.edges).toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('walks one hop at depth=1', async () => {
      findMany.mockResolvedValueOnce([
        edge({ fromId: 't_1', toType: 'person', toId: 'p_1', kind: 'produced_by' }),
      ]);

      const trace = await navigate(ORG, { type: 'task', id: 't_1' }, { depth: 1, budget: 10 });

      expect(trace.nodes).toEqual([
        { type: 'task', id: 't_1' },
        { type: 'person', id: 'p_1' },
      ]);
      expect(trace.edges).toHaveLength(1);
      expect(trace.edges[0].kind).toBe('produced_by');
    });

    it('does not revisit a node already in the trace', async () => {
      // Person p_1 has an edge back to task t_1
      findMany
        .mockResolvedValueOnce([edge({ fromId: 't_1', toType: 'person', toId: 'p_1' })])
        .mockResolvedValueOnce([
          edge({ fromType: 'person', fromId: 'p_1', toType: 'task', toId: 't_1' }),
        ]);

      const trace = await navigate(ORG, { type: 'task', id: 't_1' }, { depth: 2, budget: 10 });

      // t_1 should appear once, not twice
      const taskNodes = trace.nodes.filter((n) => n.type === 'task' && n.id === 't_1');
      expect(taskNodes).toHaveLength(1);
    });

    it('stops at the configured depth', async () => {
      findMany
        .mockResolvedValueOnce([edge({ fromId: 't_1', toType: 'person', toId: 'p_1' })])
        .mockResolvedValueOnce([
          edge({ fromType: 'person', fromId: 'p_1', toType: 'meeting', toId: 'm_1' }),
        ])
        .mockResolvedValueOnce([
          edge({ fromType: 'meeting', fromId: 'm_1', toType: 'person', toId: 'p_2' }),
        ]);

      const trace = await navigate(ORG, { type: 'task', id: 't_1' }, { depth: 2, budget: 10 });

      const ids = trace.nodes.map((n) => n.id);
      expect(ids).toContain('t_1');
      expect(ids).toContain('p_1');
      expect(ids).toContain('m_1');
      expect(ids).not.toContain('p_2');
    });

    it('respects the budget — stops fetching further hops once exhausted', async () => {
      findMany.mockResolvedValue([
        edge({ id: 'e_1', toId: 'p_1' }),
        edge({ id: 'e_2', toId: 'p_2' }),
        edge({ id: 'e_3', toId: 'p_3' }),
      ]);

      const trace = await navigate(
        ORG,
        { type: 'task', id: 't_1' },
        { depth: 5, budget: 2 },
      );

      expect(trace.budgetExhausted).toBe(true);
      // budget=2 means at most 2 hop-fetches
      expect(findMany.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('marks external_ref edges as unfollowed in the trace', async () => {
      findMany.mockResolvedValueOnce([
        edge({
          toType: 'external_ref',
          toId: 'slack:T_thread',
          kind: 'discussed_in',
          externalRef: { provider: 'slack', externalId: 'T_thread' },
        }),
      ]);

      const trace = await navigate(ORG, { type: 'task', id: 't_1' }, { depth: 3, budget: 10 });

      const externalNode = trace.nodes.find((n) => n.type === 'external_ref');
      expect(externalNode).toBeDefined();
      // External refs are recorded but not traversed in this slice
      expect(trace.unfollowed.some((e) => e.toType === 'external_ref')).toBe(true);
    });

    it('returns an empty trace when seed has no outgoing edges', async () => {
      findMany.mockResolvedValue([]);
      const trace = await navigate(ORG, { type: 'task', id: 't_orphan' }, { depth: 3, budget: 10 });

      expect(trace.nodes).toEqual([{ type: 'task', id: 't_orphan' }]);
      expect(trace.edges).toEqual([]);
    });
  });
});
