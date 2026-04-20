import type { MemoryLayer } from '@hearth/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface MemoryScope {
  orgId: string;
  teamId: string | null;
  userId: string;
  role: string;
}

/**
 * Builds a Prisma WHERE clause that enforces access scoping:
 * - User sees org-layer entries for their org
 * - User sees team-layer entries for their team
 * - User sees user/session-layer entries they own
 * - Expired entries are excluded
 */
function accessWhere(scope: MemoryScope, layer?: MemoryLayer): Prisma.MemoryEntryWhereInput {
  const conditions: Prisma.MemoryEntryWhereInput[] = [
    { layer: 'org', orgId: scope.orgId },
  ];

  if (scope.teamId) {
    conditions.push({ layer: 'team', orgId: scope.orgId, teamId: scope.teamId });
  }

  conditions.push({ layer: 'user', orgId: scope.orgId, userId: scope.userId });
  conditions.push({ layer: 'session', orgId: scope.orgId, userId: scope.userId });

  const where: Prisma.MemoryEntryWhereInput = {
    OR: conditions,
    AND: [
      {
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    ],
  };

  if (layer) {
    where.layer = layer;
  }

  return where;
}

/**
 * Checks if the user has permission to write to the given layer.
 * - org: admin only
 * - team: admin or team_lead
 * - user: self-service (any role)
 * - session: internal only (agent auto-creates, not user-managed)
 */
function canWrite(scope: MemoryScope, layer: MemoryLayer): boolean {
  switch (layer) {
    case 'org':
      return scope.role === 'admin';
    case 'team':
      return scope.role === 'admin' || scope.role === 'team_lead';
    case 'user':
    case 'session':
      return true;
    default:
      return false;
  }
}

export async function listMemory(
  scope: MemoryScope,
  options?: { layer?: MemoryLayer; page?: number; pageSize?: number },
) {
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 20;
  const where = accessWhere(scope, options?.layer);

  const [entries, total] = await Promise.all([
    prisma.memoryEntry.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.memoryEntry.count({ where }),
  ]);

  return { entries, total, page, pageSize };
}

export async function getMemory(id: string, scope: MemoryScope) {
  const entry = await prisma.memoryEntry.findUnique({ where: { id } });
  if (!entry) return null;

  // Verify access
  if (entry.orgId !== scope.orgId) return null;
  if (entry.layer === 'team' && entry.teamId !== scope.teamId) return null;
  if ((entry.layer === 'user' || entry.layer === 'session') && entry.userId !== scope.userId) {
    return null;
  }

  return entry;
}

export async function createMemory(
  scope: MemoryScope,
  data: {
    layer: MemoryLayer;
    content: string;
    source?: string;
    sourceRef?: Record<string, unknown>;
    expiresAt?: Date;
  },
) {
  if (!canWrite(scope, data.layer)) {
    throw new Error('Insufficient permissions for this memory layer');
  }

  return prisma.memoryEntry.create({
    data: {
      orgId: scope.orgId,
      teamId: data.layer === 'team' ? scope.teamId : null,
      userId: ['user', 'session'].includes(data.layer) ? scope.userId : null,
      layer: data.layer,
      content: data.content,
      source: data.source ?? null,
      sourceRef: data.sourceRef ? (data.sourceRef as Prisma.InputJsonValue) : Prisma.DbNull,
      expiresAt: data.expiresAt ?? null,
    },
  });
}

export async function updateMemory(
  id: string,
  scope: MemoryScope,
  data: {
    content?: string;
    source?: string;
    sourceRef?: Record<string, unknown>;
    expiresAt?: Date | null;
  },
) {
  const entry = await getMemory(id, scope);
  if (!entry) return null;

  if (!canWrite(scope, entry.layer as MemoryLayer)) {
    throw new Error('Insufficient permissions for this memory layer');
  }

  const updateData: Prisma.MemoryEntryUpdateInput = {};
  if (data.content !== undefined) updateData.content = data.content;
  if (data.source !== undefined) updateData.source = data.source;
  if (data.sourceRef !== undefined) {
    updateData.sourceRef = data.sourceRef as Prisma.InputJsonValue;
  }
  if (data.expiresAt !== undefined) updateData.expiresAt = data.expiresAt;

  return prisma.memoryEntry.update({ where: { id }, data: updateData });
}

export async function deleteMemory(id: string, scope: MemoryScope) {
  const entry = await getMemory(id, scope);
  if (!entry) return null;

  if (!canWrite(scope, entry.layer as MemoryLayer)) {
    throw new Error('Insufficient permissions for this memory layer');
  }

  await prisma.memoryEntry.delete({ where: { id } });
  return entry;
}

/**
 * Hybrid search combining vector similarity and full-text search.
 * Falls back to FTS-only if embedding service is unavailable.
 *
 * All user-controlled values are passed as parameterized query arguments
 * to prevent SQL injection.
 */
export async function searchMemory(
  scope: MemoryScope,
  query: string,
  options?: { layer?: MemoryLayer; limit?: number; embedding?: number[] },
) {
  const limit = options?.limit ?? 10;
  const candidateLimit = 20;

  // Validate layer enum if provided (defense-in-depth against SQL injection)
  const validLayers: MemoryLayer[] = ['org', 'team', 'user', 'session'];
  if (options?.layer && !validLayers.includes(options.layer)) {
    return [];
  }

  // Build parameterized access-scoped query.
  // We use numbered $N placeholders and pass all values as parameters.
  const hasTeam = !!scope.teamId;
  const hasLayerFilter = !!options?.layer;

  // Base params: orgId=$1, userId=$2, query=$3, limit=$4, teamId=$5 (optional)
  const baseParams: unknown[] = [scope.orgId, scope.userId];

  // Access filter using parameterized values only
  const accessConditions = [
    `(layer = 'org' AND org_id = $1)`,
    `(layer = 'user' AND org_id = $1 AND user_id = $2)`,
    `(layer = 'session' AND org_id = $1 AND user_id = $2)`,
  ];

  let nextParam = 3;

  if (hasTeam) {
    baseParams.push(scope.teamId);
    accessConditions.splice(1, 0, `(layer = 'team' AND org_id = $1 AND team_id = $${nextParam})`);
    nextParam++;
  }

  const accessFilter = `(${accessConditions.join(' OR ')}) AND (expires_at IS NULL OR expires_at > NOW())`;

  // Layer filter
  let layerFilter = '';
  if (hasLayerFilter) {
    baseParams.push(options!.layer);
    layerFilter = `AND layer = $${nextParam}`;
    nextParam++;
  }

  // Query text param
  baseParams.push(query);
  const queryParam = nextParam;
  nextParam++;

  // Candidate limit param
  baseParams.push(candidateLimit);
  const limitParam = nextParam;
  nextParam++;

  // Full-text search
  const ftsResults = await prisma.$queryRawUnsafe<Array<{ id: string; rank: number }>>(
    `SELECT id, ts_rank(to_tsvector('english', content), plainto_tsquery('english', $${queryParam})) AS rank
     FROM memory_entries
     WHERE ${accessFilter} ${layerFilter}
       AND to_tsvector('english', content) @@ plainto_tsquery('english', $${queryParam})
     ORDER BY rank DESC
     LIMIT $${limitParam}`,
    ...baseParams,
  );

  // Vector search (if embedding provided)
  let vectorResults: Array<{ id: string; similarity: number }> = [];
  if (options?.embedding && options.embedding.length > 0) {
    const embeddingStr = `[${options.embedding.join(',')}]`;
    // Build new param list for vector query: same base + embedding string + limit
    const vectorParams: unknown[] = [...baseParams.slice(0, baseParams.length - 2)]; // exclude query and limit
    vectorParams.push(embeddingStr); // embedding param
    const embParam = vectorParams.length;
    vectorParams.push(candidateLimit); // limit param
    const vecLimitParam = vectorParams.length;

    // Rebuild access filter with correct param numbering for this query
    const vecAccessConditions = [
      `(layer = 'org' AND org_id = $1)`,
      `(layer = 'user' AND org_id = $1 AND user_id = $2)`,
      `(layer = 'session' AND org_id = $1 AND user_id = $2)`,
    ];
    let vecNext = 3;
    if (hasTeam) {
      vecAccessConditions.splice(1, 0, `(layer = 'team' AND org_id = $1 AND team_id = $${vecNext})`);
      vecNext++;
    }
    let vecLayerFilter = '';
    if (hasLayerFilter) {
      vecLayerFilter = `AND layer = $${vecNext}`;
      vecNext++;
    }
    const vecAccessFilter = `(${vecAccessConditions.join(' OR ')}) AND (expires_at IS NULL OR expires_at > NOW())`;

    vectorResults = await prisma.$queryRawUnsafe<Array<{ id: string; similarity: number }>>(
      `SELECT id, 1 - (embedding <=> $${embParam}::vector) AS similarity
       FROM memory_entries
       WHERE ${vecAccessFilter} ${vecLayerFilter}
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $${embParam}::vector
       LIMIT $${vecLimitParam}`,
      ...vectorParams,
    );
  }

  // RRF merge
  const { mergeRRF } = await import('../lib/rrf.js');
  const merged = mergeRRF(
    ftsResults.map((r) => ({ id: r.id, rank: r.rank })),
    vectorResults.map((r) => ({ id: r.id, rank: r.similarity })),
    limit,
  );

  if (merged.length === 0) return [];

  // Fetch full entries
  const ids = merged.map((r) => r.id);
  const entries = await prisma.memoryEntry.findMany({
    where: { id: { in: ids } },
  });

  // Maintain RRF order and attach scores
  const entryMap = new Map(entries.map((e) => [e.id, e]));
  return merged
    .map((r) => {
      const entry = entryMap.get(r.id);
      if (!entry) return null;
      return { ...entry, score: r.score };
    })
    .filter(Boolean);
}
