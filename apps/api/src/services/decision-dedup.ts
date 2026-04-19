import { prisma } from '../lib/prisma.js';
import { generateEmbedding } from './embedding-service.js';

interface DedupResult {
  isDuplicate: boolean;
  existingId?: string;
  similarity: number;
}

/**
 * Check if a decision with similar title+reasoning already exists.
 */
export async function checkDuplicate(
  orgId: string,
  title: string,
  reasoning: string,
  opts?: { domain?: string; participants?: string[] },
): Promise<DedupResult> {
  const embedding = await generateEmbedding(`${title}. ${reasoning}`);
  if (!embedding) {
    return { isDuplicate: false, similarity: 0 };
  }

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
    orgId,
  );

  if (similar.length === 0) {
    return { isDuplicate: false, similarity: 0 };
  }

  const best = similar[0];
  let score = best.similarity;

  // Boost for same domain
  if (opts?.domain && best.domain === opts.domain) score += 0.05;
  // Boost for overlapping participants
  if (opts?.participants?.some(p => best.participants?.includes(p))) score += 0.05;

  if (score > 0.90) {
    return { isDuplicate: true, existingId: best.id, similarity: score };
  }

  return { isDuplicate: false, similarity: best.similarity };
}
