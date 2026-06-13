/**
 * Decision conflict detection.
 *
 * When a new decision is captured, it may quietly contradict one the org already
 * made on the same question ("we'll standardize on Postgres" landing a month
 * after "we're moving to DynamoDB"). Pure embedding similarity can't tell a
 * contradiction from agreement, so detection is two-stage, mirroring the
 * decision-detector: a cheap vector pre-filter narrows to same-topic candidates,
 * then an LLM judges which actually conflict. Confirmed conflicts get a
 * `contradicts` link, an org notification, and an audit entry so a human can
 * reconcile (supersede one, or keep both as scoped exceptions).
 *
 * Non-fatal by contract: any failure returns no conflicts and never blocks the
 * decision from being created.
 */
import { providerRegistry } from '../llm/provider-registry.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { emitToOrg } from '../ws/socket-manager.js';
import { logAudit } from './audit-service.js';

/**
 * Similarity floors for surfacing conflict candidates. Contradictions are often
 * LEXICALLY dissimilar ("standardize on gRPC" vs "standardize on REST" embed at
 * ~0.56), so a high floor misses them. Strategy:
 *   - Domain-tagged decisions: the DOMAIN is the primary filter, so use a LOW
 *     floor and let the LLM judge contradiction within that domain.
 *   - Untagged decisions: no domain to constrain the pool, so require higher
 *     topical similarity to avoid judging unrelated pairs.
 */
const CONFLICT_FLOOR_WITH_DOMAIN = 0.4;
const CONFLICT_FLOOR_NO_DOMAIN = 0.75;
const MAX_CANDIDATES = 5;
/** Registered (dated) Haiku id — the undated alias resolves to no provider. */
const CONFLICT_JUDGE_MODEL = 'claude-haiku-4-5-20251001';

export interface DetectedConflict {
  decisionId: string;
  title: string;
  similarity: number;
  rationale: string;
}

interface Candidate {
  id: string;
  title: string;
  reasoning: string;
  similarity: number;
}

export async function detectConflicts(params: {
  decisionId: string;
  orgId: string;
  title: string;
  reasoning: string;
  domain?: string | null;
  embedding: number[];
  userId?: string;
}): Promise<DetectedConflict[]> {
  try {
    const candidates = await findSameTopicCandidates(
      params.decisionId,
      params.orgId,
      params.domain ?? null,
      params.embedding,
    );
    if (candidates.length === 0) return [];

    const conflictingIds = await judgeConflicts(
      { title: params.title, reasoning: params.reasoning },
      candidates,
    );
    if (conflictingIds.size === 0) return [];

    const detected: DetectedConflict[] = [];
    for (const c of candidates) {
      const verdict = conflictingIds.get(c.id);
      if (!verdict) continue;

      // Record the contradiction as a typed link (both directions are implied
      // by the relationship; we store new → existing).
      await prisma.decisionLink
        .create({
          data: {
            fromDecisionId: params.decisionId,
            toDecisionId: c.id,
            relationship: 'contradicts',
            description: verdict,
          },
        })
        .catch(() => {}); // ignore unique-constraint races

      detected.push({ decisionId: c.id, title: c.title, similarity: c.similarity, rationale: verdict });
    }

    if (detected.length > 0) {
      emitToOrg(params.orgId, 'decision:conflict', {
        decisionId: params.decisionId,
        title: params.title,
        conflicts: detected.map((d) => ({ decisionId: d.decisionId, title: d.title })),
      });
      logAudit({
        orgId: params.orgId,
        userId: params.userId ?? 'system',
        action: 'decision_conflict_detected',
        entityType: 'decision',
        entityId: params.decisionId,
        details: { conflicts: detected.map((d) => d.decisionId) },
      }).catch(() => {});
      logger.info(
        { decisionId: params.decisionId, conflicts: detected.length },
        'Decision conflict(s) detected',
      );
    }

    return detected;
  } catch (err) {
    logger.debug({ err, decisionId: params.decisionId }, 'Conflict detection failed (non-fatal)');
    return [];
  }
}

/** Same-org, active, same-topic (vector) decisions, excluding the new one. */
async function findSameTopicCandidates(
  decisionId: string,
  orgId: string,
  domain: string | null,
  embedding: number[],
): Promise<Candidate[]> {
  const embeddingStr = `[${embedding.join(',')}]`;
  // When a domain is given, restrict the SQL pool to that domain so a low
  // similarity floor stays cheap and on-topic; otherwise scan org-wide.
  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; title: string; reasoning: string; similarity: number; domain: string | null }>
  >(
    `SELECT id, title, reasoning, domain, 1 - (embedding <=> $1::vector) AS similarity
     FROM decisions
     WHERE org_id = $2 AND id != $3 AND status = 'active' AND embedding IS NOT NULL
       ${domain ? 'AND domain = $4' : ''}
     ORDER BY embedding <=> $1::vector
     LIMIT ${MAX_CANDIDATES}`,
    ...(domain ? [embeddingStr, orgId, decisionId, domain] : [embeddingStr, orgId, decisionId]),
  );

  const floor = domain ? CONFLICT_FLOOR_WITH_DOMAIN : CONFLICT_FLOOR_NO_DOMAIN;
  return rows
    .filter((r) => r.similarity >= floor)
    .map((r) => ({ id: r.id, title: r.title, reasoning: r.reasoning, similarity: r.similarity }));
}

/**
 * Ask the LLM which candidates actually contradict the new decision. Returns a
 * map of conflicting decisionId → short rationale. On any parse/provider error,
 * returns an empty map (fail safe — no false conflicts).
 */
async function judgeConflicts(
  fresh: { title: string; reasoning: string },
  candidates: Candidate[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  const list = candidates
    .map((c, i) => `${i + 1}. id=${c.id}\n   title: ${c.title}\n   reasoning: ${c.reasoning.slice(0, 400)}`)
    .join('\n');

  const prompt = `A team just recorded a NEW decision. Determine which, if any, of the EXISTING decisions it directly CONTRADICTS — i.e. they answer the same question with incompatible choices, such that both cannot hold at once. Decisions that are merely related, sequential, or complementary are NOT contradictions.

NEW decision:
title: ${fresh.title}
reasoning: ${fresh.reasoning.slice(0, 800)}

EXISTING decisions:
${list}

Respond with ONLY a JSON array (possibly empty). Each item: {"id": "<existing id>", "rationale": "<one sentence why they conflict>"}. Include an item ONLY for a genuine contradiction.`;

  let raw = '';
  const stream = providerRegistry.chatWithFallback({
    // Use the registered (dated) Haiku id — the undated alias resolves to no
    // provider, so the stream would emit an error and the judge silently no-op.
    model: CONFLICT_JUDGE_MODEL,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 400,
  });
  for await (const event of stream) {
    if (event.type === 'text_delta') raw += event.content;
    // Surface provider/stream errors instead of swallowing them into an empty
    // (→ "no conflicts") result; the caller's catch logs it as a real failure.
    if (event.type === 'error') throw new Error(`Conflict judge LLM error: ${event.message}`);
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = (fenced ? fenced[1] : raw).trim();
  const parsed = JSON.parse(jsonStr) as Array<{ id?: string; rationale?: string }>;
  if (!Array.isArray(parsed)) return result;

  const validIds = new Set(candidates.map((c) => c.id));
  for (const item of parsed) {
    if (item?.id && validIds.has(item.id)) {
      result.set(item.id, typeof item.rationale === 'string' ? item.rationale : 'Conflicting decision');
    }
  }
  return result;
}
