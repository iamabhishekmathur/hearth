import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { generateEmbedding } from './embedding-service.js';
import { logAudit } from './audit-service.js';
import { emitToOrg } from '../ws/socket-manager.js';
import type {
  Decision,
  DecisionSearchRequest,
  DecisionGraphResponse,
  CreateDecisionRequest,
  UpdateDecisionRequest,
  RecordOutcomeRequest,
  OutcomeVerdict,
} from '@hearth/shared';

interface DecisionScope {
  orgId: string;
  userId: string;
  teamId: string | null;
  role: string;
}

/**
 * Create a decision with embedding, dedup check, and auto-linking.
 */
export async function createDecision(
  scope: DecisionScope,
  data: CreateDecisionRequest & { sessionId?: string },
): Promise<Decision> {
  // Generate embedding from title + reasoning
  const embeddingText = `${data.title}. ${data.reasoning}`;
  const embedding = await generateEmbedding(embeddingText);

  // Dedup check
  if (embedding) {
    const embeddingStr = `[${embedding.join(',')}]`;
    const similar = await prisma.$queryRawUnsafe<
      Array<{ id: string; similarity: number; domain: string | null; participants: string[] }>
    >(
      `SELECT id, 1 - (embedding <=> $1::vector) AS similarity, domain, participants
       FROM decisions
       WHERE org_id = $2 AND status NOT IN ('archived', 'superseded')
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT 3`,
      embeddingStr,
      scope.orgId,
    );

    if (similar.length > 0) {
      let bestScore = similar[0].similarity;
      // Boost by domain match
      if (data.domain && similar[0].domain === data.domain) bestScore += 0.05;
      // Boost by participant overlap
      if (data.participants?.some(p => similar[0].participants?.includes(p))) bestScore += 0.05;

      if (bestScore > 0.90) {
        // Merge: return existing decision (update it)
        logger.info({ existingId: similar[0].id, score: bestScore }, 'Decision dedup: merging');
        const existing = await prisma.decision.findUnique({ where: { id: similar[0].id } });
        if (existing) {
          return formatDecision(existing);
        }
      }
    }
  }

  // Compute quality score
  const quality = computeQuality(data);

  const decision = await prisma.decision.create({
    data: {
      orgId: scope.orgId,
      teamId: data.teamId ?? scope.teamId,
      createdById: scope.userId,
      sessionId: data.sessionId,
      title: data.title,
      description: data.description,
      reasoning: data.reasoning,
      alternatives: (data.alternatives ?? []) as Prisma.InputJsonValue,
      domain: data.domain,
      tags: data.tags ?? [],
      scope: data.scope ?? 'org',
      status: 'active',
      confidence: data.confidence ?? 'medium',
      source: data.source ?? 'manual',
      sourceRef: data.sourceRef ? (data.sourceRef as Prisma.InputJsonValue) : Prisma.DbNull,
      sensitivity: data.sensitivity ?? 'normal',
      participants: data.participants ?? [],
      quality,
      importance: 0.5,
    },
  });

  // Store embedding
  if (embedding) {
    const embeddingStr = `[${embedding.join(',')}]`;
    await prisma.$executeRawUnsafe(
      `UPDATE decisions SET embedding = $1::vector WHERE id = $2`,
      embeddingStr,
      decision.id,
    );
  }

  // Auto-link related decisions
  if (embedding) {
    await autoLinkRelated(decision.id, scope.orgId, embedding);
  }

  // Audit log
  logAudit({
    orgId: scope.orgId,
    userId: scope.userId,
    action: 'decision_captured',
    entityType: 'decision',
    entityId: decision.id,
    details: { title: data.title, domain: data.domain, source: data.source ?? 'manual' },
  }).catch(() => {});

  // WebSocket
  emitToOrg(scope.orgId, 'decision:created', {
    id: decision.id,
    title: decision.title,
    domain: decision.domain,
    scope: decision.scope,
    userId: scope.userId,
  });

  return formatDecision(decision);
}

/**
 * Update a decision, re-embed if text changed.
 */
export async function updateDecision(
  decisionId: string,
  orgId: string,
  data: UpdateDecisionRequest,
): Promise<Decision | null> {
  const existing = await prisma.decision.findFirst({
    where: { id: decisionId, orgId },
  });
  if (!existing) return null;

  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.reasoning !== undefined) updateData.reasoning = data.reasoning;
  if (data.alternatives !== undefined) updateData.alternatives = data.alternatives;
  if (data.domain !== undefined) updateData.domain = data.domain;
  if (data.tags !== undefined) updateData.tags = data.tags;
  if (data.scope !== undefined) updateData.scope = data.scope;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.confidence !== undefined) updateData.confidence = data.confidence;
  if (data.sensitivity !== undefined) updateData.sensitivity = data.sensitivity;
  if (data.importance !== undefined) updateData.importance = data.importance;

  const decision = await prisma.decision.update({
    where: { id: decisionId },
    data: updateData as never,
  });

  // Re-embed if text changed
  if (data.title || data.reasoning) {
    const embeddingText = `${decision.title}. ${decision.reasoning}`;
    const embedding = await generateEmbedding(embeddingText);
    if (embedding) {
      const embeddingStr = `[${embedding.join(',')}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE decisions SET embedding = $1::vector WHERE id = $2`,
        embeddingStr,
        decision.id,
      );
    }
  }

  return formatDecision(decision);
}

/**
 * Hybrid search: vector + FTS with Reciprocal Rank Fusion.
 */
export async function searchDecisions(
  scope: DecisionScope,
  req: DecisionSearchRequest,
): Promise<{ decisions: Decision[]; total: number }> {
  const limit = Math.min(req.limit ?? 20, 100);
  const embedding = await generateEmbedding(req.query);

  // Build access-control WHERE clause
  const conditions: string[] = [
    `d.org_id = $1`,
    `d.status NOT IN ('archived')`,
  ];
  const params: unknown[] = [scope.orgId];
  let paramIdx = 2;

  // Access control
  conditions.push(`(
    d.scope = 'org'
    OR (d.scope = 'team' AND d.team_id = $${paramIdx})
    OR (d.scope = 'personal' AND d.created_by_id = $${paramIdx + 1})
  )`);
  params.push(scope.teamId, scope.userId);
  paramIdx += 2;

  // Sensitivity filter
  conditions.push(`(
    d.sensitivity = 'normal'
    OR d.created_by_id = $${paramIdx}
    ${scope.role === 'admin' ? `OR TRUE` : ''}
  )`);
  params.push(scope.userId);
  paramIdx++;

  // Optional filters
  if (req.domain) {
    conditions.push(`d.domain = $${paramIdx}`);
    params.push(req.domain);
    paramIdx++;
  }
  if (req.status) {
    conditions.push(`d.status = $${paramIdx}::"DecisionStatus"`);
    params.push(req.status);
    paramIdx++;
  }
  if (req.since) {
    conditions.push(`d.created_at >= $${paramIdx}::timestamp`);
    params.push(req.since);
    paramIdx++;
  }

  const whereClause = conditions.join(' AND ');

  let query: string;
  if (embedding) {
    const embeddingStr = `[${embedding.join(',')}]`;
    params.push(embeddingStr);
    const embeddingIdx = paramIdx;
    paramIdx++;

    // Hybrid: combine vector similarity + FTS rank via RRF
    params.push(req.query);
    const queryIdx = paramIdx;
    paramIdx++;

    params.push(limit);
    const limitIdx = paramIdx;

    query = `
      WITH vector_results AS (
        SELECT d.id, 1 - (d.embedding <=> $${embeddingIdx}::vector) AS vscore,
               ROW_NUMBER() OVER (ORDER BY d.embedding <=> $${embeddingIdx}::vector) AS vrank
        FROM decisions d
        WHERE ${whereClause} AND d.embedding IS NOT NULL
        ORDER BY d.embedding <=> $${embeddingIdx}::vector
        LIMIT 50
      ),
      fts_results AS (
        SELECT d.id,
               ts_rank(to_tsvector('english', coalesce(d.title,'') || ' ' || coalesce(d.description,'') || ' ' || coalesce(d.reasoning,'')),
                       plainto_tsquery('english', $${queryIdx})) AS fts_rank,
               ROW_NUMBER() OVER (ORDER BY ts_rank(to_tsvector('english', coalesce(d.title,'') || ' ' || coalesce(d.description,'') || ' ' || coalesce(d.reasoning,'')),
                       plainto_tsquery('english', $${queryIdx})) DESC) AS frank
        FROM decisions d
        WHERE ${whereClause}
          AND to_tsvector('english', coalesce(d.title,'') || ' ' || coalesce(d.description,'') || ' ' || coalesce(d.reasoning,''))
              @@ plainto_tsquery('english', $${queryIdx})
        LIMIT 50
      ),
      combined AS (
        SELECT COALESCE(v.id, f.id) AS id,
               COALESCE(1.0 / (60 + v.vrank), 0) + COALESCE(1.0 / (60 + f.frank), 0) AS rrf_score
        FROM vector_results v
        FULL OUTER JOIN fts_results f ON v.id = f.id
      )
      SELECT d.* FROM combined c
      JOIN decisions d ON d.id = c.id
      ORDER BY c.rrf_score DESC
      LIMIT $${limitIdx}
    `;
  } else {
    // FTS-only fallback
    params.push(req.query);
    const queryIdx = paramIdx;
    paramIdx++;
    params.push(limit);
    const limitIdx = paramIdx;

    query = `
      SELECT d.* FROM decisions d
      WHERE ${whereClause}
        AND to_tsvector('english', coalesce(d.title,'') || ' ' || coalesce(d.description,'') || ' ' || coalesce(d.reasoning,''))
            @@ plainto_tsquery('english', $${queryIdx})
      ORDER BY ts_rank(to_tsvector('english', coalesce(d.title,'') || ' ' || coalesce(d.description,'') || ' ' || coalesce(d.reasoning,'')),
               plainto_tsquery('english', $${queryIdx})) DESC
      LIMIT $${limitIdx}
    `;
  }

  const results = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(query, ...params);

  return {
    decisions: results.map(formatDecision),
    total: results.length,
  };
}

/**
 * Get decision graph using recursive CTE.
 */
export async function getDecisionGraph(
  decisionId: string,
  orgId: string,
  depth: number = 2,
): Promise<DecisionGraphResponse> {
  const maxDepth = Math.min(depth, 5);

  const edges = await prisma.$queryRawUnsafe<
    Array<{ id: string; from_decision_id: string; to_decision_id: string; relationship: string; depth: number }>
  >(
    `WITH RECURSIVE graph AS (
      SELECT dl.id, dl.from_decision_id, dl.to_decision_id, dl.relationship, 1 AS depth
      FROM decision_links dl
      WHERE dl.from_decision_id = $1 OR dl.to_decision_id = $1
      UNION
      SELECT dl.id, dl.from_decision_id, dl.to_decision_id, dl.relationship, g.depth + 1
      FROM decision_links dl
      JOIN graph g ON dl.from_decision_id = g.to_decision_id OR dl.to_decision_id = g.from_decision_id
      WHERE g.depth < $2
        AND dl.id != g.id
    )
    SELECT DISTINCT id, from_decision_id, to_decision_id, relationship, depth FROM graph`,
    decisionId,
    maxDepth,
  );

  // Collect all node IDs
  const nodeIds = new Set<string>();
  nodeIds.add(decisionId);
  for (const edge of edges) {
    nodeIds.add(edge.from_decision_id);
    nodeIds.add(edge.to_decision_id);
  }

  const nodes = await prisma.decision.findMany({
    where: { id: { in: Array.from(nodeIds) }, orgId },
    select: {
      id: true,
      title: true,
      domain: true,
      status: true,
      confidence: true,
      _count: { select: { linksFrom: true, linksTo: true } },
    },
  });

  return {
    nodes: nodes.map((n: { id: string; title: string; domain: string | null; status: string; confidence: string; _count: { linksFrom: number; linksTo: number } }) => ({
      id: n.id,
      title: n.title,
      domain: n.domain,
      status: n.status as Decision['status'],
      confidence: n.confidence as Decision['confidence'],
      connectionCount: n._count.linksFrom + n._count.linksTo,
    })),
    edges: edges.map(e => ({
      id: e.id,
      source: e.from_decision_id,
      target: e.to_decision_id,
      relationship: e.relationship as Decision['status'] extends string ? string : never,
    })) as DecisionGraphResponse['edges'],
  };
}

/**
 * Find precedents via semantic search.
 */
export async function findPrecedents(
  scope: DecisionScope,
  query: string,
  opts?: { limit?: number; domain?: string },
): Promise<Decision[]> {
  const embedding = await generateEmbedding(query);
  if (!embedding) return [];

  const embeddingStr = `[${embedding.join(',')}]`;
  const limit = opts?.limit ?? 5;

  let domainFilter = '';
  const params: unknown[] = [embeddingStr, scope.orgId, limit];
  if (opts?.domain) {
    domainFilter = `AND d.domain = $4`;
    params.push(opts.domain);
  }

  const results = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT d.*, 1 - (d.embedding <=> $1::vector) AS similarity
     FROM decisions d
     WHERE d.org_id = $2
       AND d.status IN ('active')
       AND d.embedding IS NOT NULL
       AND (d.scope = 'org'
         OR (d.scope = 'team' AND d.team_id IS NOT NULL)
         OR (d.scope = 'personal' AND d.created_by_id IS NOT NULL))
       ${domainFilter}
     ORDER BY d.quality DESC, d.embedding <=> $1::vector
     LIMIT $3`,
    ...params,
  );

  return results.map(formatDecision);
}

/**
 * Record an outcome for a decision.
 */
export async function recordOutcome(
  decisionId: string,
  userId: string,
  orgId: string,
  data: RecordOutcomeRequest,
) {
  const decision = await prisma.decision.findFirst({
    where: { id: decisionId, orgId },
  });
  if (!decision) return null;

  const outcome = await prisma.decisionOutcome.create({
    data: {
      decisionId,
      observedById: userId,
      verdict: data.verdict as OutcomeVerdict,
      description: data.description,
      impactScore: data.impactScore,
      evidence: data.evidence ? (data.evidence as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });

  emitToOrg(orgId, 'decision:outcome_updated', {
    id: decisionId,
    title: decision.title,
    outcomeSnippet: data.description.slice(0, 100),
    updatedBy: userId,
  });

  return outcome;
}

/**
 * List decisions with cursor pagination and filters.
 */
export async function listDecisions(
  scope: DecisionScope,
  opts: {
    cursor?: string;
    limit?: number;
    domain?: string;
    status?: string;
    scope?: string;
    teamId?: string;
  },
) {
  const limit = Math.min(opts.limit ?? 20, 100);
  const where: Record<string, unknown> = {
    orgId: scope.orgId,
    status: { not: 'archived' },
    OR: [
      { scope: 'org' },
      { scope: 'team', teamId: scope.teamId ?? undefined },
      { scope: 'personal', createdById: scope.userId },
    ],
  };

  if (opts.domain) where.domain = opts.domain;
  if (opts.status) where.status = opts.status;
  if (opts.scope) where.scope = opts.scope;
  if (opts.teamId) where.teamId = opts.teamId;
  if (opts.cursor) where.createdAt = { lt: new Date(opts.cursor) };

  const decisions = await prisma.decision.findMany({
    where: where as never,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    include: {
      createdBy: { select: { name: true } },
      _count: { select: { outcomes: true, linksFrom: true, linksTo: true } },
    },
  });

  const hasMore = decisions.length > limit;
  const data = decisions.slice(0, limit);

  return {
    data: data.map((d: Record<string, unknown>) => ({
      ...formatDecision(d),
      createdByName: (d as Record<string, unknown> & { createdBy?: { name: string } }).createdBy?.name,
      outcomeCount: ((d as Record<string, unknown> & { _count?: { outcomes: number } })._count?.outcomes) ?? 0,
      linkCount: (((d as Record<string, unknown> & { _count?: { linksFrom: number; linksTo: number } })._count?.linksFrom) ?? 0) + (((d as Record<string, unknown> & { _count?: { linksFrom: number; linksTo: number } })._count?.linksTo) ?? 0),
    })),
    cursor: hasMore && data.length > 0 ? data[data.length - 1].createdAt.toISOString() : null,
    hasMore,
  };
}

/**
 * Get a single decision with full relations.
 */
export async function getDecision(decisionId: string, orgId: string) {
  const decision = await prisma.decision.findFirst({
    where: { id: decisionId, orgId },
    include: {
      createdBy: { select: { name: true } },
      contexts: true,
      outcomes: {
        include: { observedBy: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      },
      linksFrom: {
        include: { toDecision: { select: { id: true, title: true, status: true, domain: true } } },
      },
      linksTo: {
        include: { fromDecision: { select: { id: true, title: true, status: true, domain: true } } },
      },
    },
  });
  if (!decision) return null;

  return {
    ...formatDecision(decision),
    createdByName: (decision as unknown as { createdBy?: { name: string } }).createdBy?.name,
    contexts: decision.contexts,
    outcomes: decision.outcomes.map((o: Record<string, unknown> & { createdAt: Date; observedBy?: { name: string } }) => ({
      ...o,
      createdAt: o.createdAt.toISOString(),
      observedByName: o.observedBy?.name,
    })),
    links: [
      ...decision.linksFrom.map((l: Record<string, unknown> & { createdAt: Date; toDecision?: unknown }) => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
        linkedDecision: l.toDecision,
      })),
      ...decision.linksTo.map((l: Record<string, unknown> & { createdAt: Date; fromDecision?: unknown }) => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
        linkedDecision: l.fromDecision,
      })),
    ],
  };
}

/**
 * Add a link between two decisions.
 */
export async function addDecisionLink(
  fromId: string,
  toId: string,
  relationship: string,
  description?: string,
  createdById?: string,
) {
  return prisma.decisionLink.create({
    data: {
      fromDecisionId: fromId,
      toDecisionId: toId,
      relationship: relationship as never,
      description,
      createdById,
    },
  });
}

/**
 * Remove a decision link.
 */
export async function removeDecisionLink(linkId: string) {
  return prisma.decisionLink.delete({ where: { id: linkId } });
}

/**
 * List draft decisions needing review.
 */
export async function listPendingReview(orgId: string) {
  return prisma.decision.findMany({
    where: { orgId, status: 'draft' },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { createdBy: { select: { name: true } } },
  });
}

/**
 * Confirm a draft decision.
 */
export async function confirmDecision(decisionId: string, orgId: string, userId: string) {
  const decision = await prisma.decision.updateMany({
    where: { id: decisionId, orgId, status: 'draft' },
    data: { status: 'active' },
  });
  if (decision.count > 0) {
    emitToOrg(orgId, 'decision:validated', { id: decisionId, validatedBy: userId });
  }
  return decision.count > 0;
}

/**
 * Dismiss (archive) a false positive draft.
 */
export async function dismissDecision(decisionId: string, orgId: string) {
  const result = await prisma.decision.updateMany({
    where: { id: decisionId, orgId, status: 'draft' },
    data: { status: 'archived' },
  });
  return result.count > 0;
}

/**
 * List patterns for an org, optionally filtered by domain.
 */
export async function listPatterns(orgId: string, domain?: string) {
  return prisma.decisionPattern.findMany({
    where: { orgId, ...(domain ? { domain } : {}) },
    orderBy: { decisionCount: 'desc' },
  });
}

/**
 * List principles for an org, optionally filtered by domain.
 */
export async function listPrinciples(orgId: string, domain?: string) {
  return prisma.orgPrinciple.findMany({
    where: { orgId, ...(domain ? { domain } : {}) },
    orderBy: { confidence: 'desc' },
  });
}

// ── Helpers ──

function computeQuality(data: CreateDecisionRequest): number {
  let score = 0;
  if (data.title) score += 0.2;
  if (data.reasoning) score += 0.2;
  if (data.alternatives && data.alternatives.length > 0) score += 0.15;
  if (data.participants && data.participants.length > 0) score += 0.15;
  if (data.domain) score += 0.1;
  if (data.tags && data.tags.length > 0) score += 0.1;
  if (data.scope) score += 0.1;
  return Math.min(1, score);
}

async function autoLinkRelated(decisionId: string, orgId: string, embedding: number[]) {
  try {
    const embeddingStr = `[${embedding.join(',')}]`;
    const similar = await prisma.$queryRawUnsafe<Array<{ id: string; similarity: number }>>(
      `SELECT id, 1 - (embedding <=> $1::vector) AS similarity
       FROM decisions
       WHERE org_id = $2 AND id != $3 AND status = 'active' AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT 3`,
      embeddingStr,
      orgId,
      decisionId,
    );

    for (const s of similar) {
      if (s.similarity > 0.75) {
        await prisma.decisionLink.create({
          data: {
            fromDecisionId: decisionId,
            toDecisionId: s.id,
            relationship: 'related_to',
          },
        }).catch(() => {}); // Ignore unique constraint violations
      }
    }
  } catch (err) {
    logger.debug({ err }, 'Failed to auto-link related decisions');
  }
}

function formatDecision(d: Record<string, unknown>): Decision {
  return {
    id: d.id as string,
    orgId: (d.orgId ?? d.org_id) as string,
    teamId: (d.teamId ?? d.team_id ?? null) as string | null,
    createdById: (d.createdById ?? d.created_by_id) as string,
    sessionId: (d.sessionId ?? d.session_id ?? null) as string | null,
    title: d.title as string,
    description: (d.description ?? null) as string | null,
    reasoning: d.reasoning as string,
    alternatives: (d.alternatives ?? []) as Decision['alternatives'],
    domain: (d.domain ?? null) as string | null,
    tags: (d.tags ?? []) as string[],
    scope: (d.scope ?? 'org') as Decision['scope'],
    status: (d.status ?? 'active') as Decision['status'],
    confidence: (d.confidence ?? 'medium') as Decision['confidence'],
    source: (d.source ?? 'manual') as Decision['source'],
    sourceRef: (d.sourceRef ?? d.source_ref ?? null) as Record<string, unknown> | null,
    sensitivity: (d.sensitivity ?? 'normal') as Decision['sensitivity'],
    participants: (d.participants ?? []) as string[],
    contextSnapshot: (d.contextSnapshot ?? d.context_snapshot ?? null) as Record<string, unknown> | null,
    quality: (d.quality ?? 0) as number,
    importance: (d.importance ?? 0.5) as number,
    supersededById: (d.supersededById ?? d.superseded_by_id ?? null) as string | null,
    createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : (d.created_at instanceof Date ? (d.created_at as Date).toISOString() : String(d.createdAt ?? d.created_at)),
    updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : (d.updated_at instanceof Date ? (d.updated_at as Date).toISOString() : String(d.updatedAt ?? d.updated_at)),
  };
}
