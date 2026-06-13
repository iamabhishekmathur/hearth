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
 * Similarity floor for "same topic". Below the 0.90 dedup-merge threshold (those
 * are treated as the same decision) but high enough to exclude loosely-related
 * ones. Candidates in [floor, 0.90) are the conflict-suspect band.
 */
const CONFLICT_SIMILARITY_FLOOR = 0.8;
const MAX_CANDIDATES = 5;

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
  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; title: string; reasoning: string; similarity: number; domain: string | null }>
  >(
    `SELECT id, title, reasoning, domain, 1 - (embedding <=> $1::vector) AS similarity
     FROM decisions
     WHERE org_id = $2 AND id != $3 AND status = 'active' AND embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT ${MAX_CANDIDATES}`,
    embeddingStr,
    orgId,
    decisionId,
  );

  return rows
    .filter((r) => r.similarity >= CONFLICT_SIMILARITY_FLOOR)
    // If the new decision is domain-tagged, only compare within that domain —
    // cross-domain look-alikes ("migrate the DB" vs "migrate the office") aren't
    // conflicts. Untagged decisions compare broadly.
    .filter((r) => !domain || !r.domain || r.domain === domain)
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
    model: 'claude-haiku-4-5',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 400,
  });
  for await (const event of stream) {
    if (event.type === 'text_delta') raw += event.content;
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
