import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { Prisma } from '@prisma/client';
import type { EntityKind, EdgeKind } from '@prisma/client';

export type { EntityKind, EdgeKind };

export interface ExternalRef {
  provider: string;
  externalId: string;
  hint?: string;
}

export interface Edge {
  id: string;
  orgId: string;
  fromType: EntityKind;
  fromId: string;
  toType: EntityKind;
  toId: string;
  kind: EdgeKind;
  weight: number | null;
  source: string | null;
  externalRef: Prisma.JsonValue | null;
  stale: boolean;
  createdAt: Date;
}

export interface UpsertEdgeInput {
  orgId: string;
  fromType: EntityKind;
  fromId: string;
  toType: EntityKind;
  toId: string;
  kind: EdgeKind;
  weight?: number;
  source?: string;
  externalRef?: ExternalRef;
}

/**
 * Insert an edge, or no-op if it already exists. Idempotent — the composite
 * (orgId, fromType, fromId, toType, toId, kind) is unique at the DB layer.
 */
export async function upsertEdge(input: UpsertEdgeInput): Promise<Edge> {
  const isExternal = input.toType === 'external_ref';
  if (isExternal && !input.externalRef) {
    throw new Error('upsertEdge: toType=external_ref requires an externalRef payload');
  }
  if (!isExternal && input.externalRef) {
    throw new Error('upsertEdge: externalRef must only be set when toType=external_ref');
  }

  return prisma.edge.upsert({
    where: {
      orgId_fromType_fromId_toType_toId_kind: {
        orgId: input.orgId,
        fromType: input.fromType,
        fromId: input.fromId,
        toType: input.toType,
        toId: input.toId,
        kind: input.kind,
      },
    },
    update: {},
    create: {
      orgId: input.orgId,
      fromType: input.fromType,
      fromId: input.fromId,
      toType: input.toType,
      toId: input.toId,
      kind: input.kind,
      weight: input.weight ?? null,
      source: input.source ?? null,
      externalRef: input.externalRef
        ? (input.externalRef as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
  }) as Promise<Edge>;
}

interface FindOptions {
  kind?: EdgeKind;
  includeStale?: boolean;
}

export async function findOutgoingEdges(
  orgId: string,
  fromType: EntityKind,
  fromId: string,
  opts: FindOptions = {},
): Promise<Edge[]> {
  const where: Prisma.EdgeWhereInput = { orgId, fromType, fromId };
  if (opts.kind) where.kind = opts.kind;
  if (!opts.includeStale) where.stale = false;
  return prisma.edge.findMany({ where }) as Promise<Edge[]>;
}

export async function findIncomingEdges(
  orgId: string,
  toType: EntityKind,
  toId: string,
  opts: FindOptions = {},
): Promise<Edge[]> {
  const where: Prisma.EdgeWhereInput = { orgId, toType, toId };
  if (opts.kind) where.kind = opts.kind;
  if (!opts.includeStale) where.stale = false;
  return prisma.edge.findMany({ where }) as Promise<Edge[]>;
}

/**
 * Find tasks that reference a given external entity (e.g. "which tasks point
 * at this Notion page?"). Uses the JSON externalRef payload for matching so we
 * don't depend on the synthetic "provider:id" toId convention.
 */
export async function findTasksLinkedToExternalRef(
  orgId: string,
  ref: { provider: string; externalId: string },
): Promise<Edge[]> {
  return prisma.edge.findMany({
    where: {
      orgId,
      fromType: 'task',
      toType: 'external_ref',
      stale: false,
      externalRef: {
        path: ['externalId'],
        equals: ref.externalId,
      },
      AND: {
        externalRef: {
          path: ['provider'],
          equals: ref.provider,
        },
      },
    },
  }) as Promise<Edge[]>;
}

// ── Navigation ─────────────────────────────────────────────────────────────

export interface NavNode {
  type: EntityKind;
  id: string;
}

export interface NavTraceEdge {
  fromType: EntityKind;
  fromId: string;
  toType: EntityKind;
  toId: string;
  kind: EdgeKind;
  externalRef: Prisma.JsonValue | null;
}

export interface NavTrace {
  nodes: NavNode[];
  edges: NavTraceEdge[];
  unfollowed: NavTraceEdge[];
  budgetExhausted: boolean;
}

export interface NavigateOptions {
  depth: number;
  budget: number; // max number of hop-fetches (one fetch = one outgoing-edges query)
}

/**
 * Breadth-first walk over the Edge graph from a seed node.
 *
 * Internal hops are pure DB walks; external_ref edges are recorded in the
 * trace as `unfollowed` (live integration resolution is a follow-up — this
 * slice intentionally does not call into MCP connectors).
 */
export async function navigate(
  orgId: string,
  seed: NavNode,
  opts: NavigateOptions,
): Promise<NavTrace> {
  const nodes: NavNode[] = [seed];
  const seen = new Set<string>([nodeKey(seed)]);
  const edges: NavTraceEdge[] = [];
  const unfollowed: NavTraceEdge[] = [];

  let frontier: NavNode[] = [seed];
  let fetches = 0;
  let depth = 0;
  let budgetExhausted = false;

  while (depth < opts.depth && frontier.length > 0) {
    const next: NavNode[] = [];

    for (const node of frontier) {
      if (fetches >= opts.budget) {
        budgetExhausted = true;
        break;
      }
      // External refs aren't traversed internally — would require live API call.
      if (node.type === 'external_ref') continue;

      fetches += 1;
      const outgoing = await findOutgoingEdges(orgId, node.type, node.id);

      for (const e of outgoing) {
        const traceEdge: NavTraceEdge = {
          fromType: e.fromType,
          fromId: e.fromId,
          toType: e.toType,
          toId: e.toId,
          kind: e.kind,
          externalRef: e.externalRef,
        };
        edges.push(traceEdge);

        const target: NavNode = { type: e.toType, id: e.toId };
        const key = nodeKey(target);
        if (!seen.has(key)) {
          seen.add(key);
          nodes.push(target);
          if (e.toType === 'external_ref') {
            unfollowed.push(traceEdge);
          } else {
            next.push(target);
          }
        }
      }
    }

    if (budgetExhausted) break;
    frontier = next;
    depth += 1;
  }

  logger.debug({ seed, fetches, depth, budgetExhausted, nodeCount: nodes.length }, 'navigate complete');

  return { nodes, edges, unfollowed, budgetExhausted };
}

function nodeKey(n: NavNode): string {
  return `${n.type}:${n.id}`;
}
