/**
 * Reciprocal Rank Fusion (RRF) — merges two ranked result lists.
 * RRF score = sum(1 / (k + rank_i)) across all lists where the doc appears.
 * k = 60 is the standard smoothing constant from the original paper.
 */

interface RankedItem {
  id: string;
  rank: number; // Higher is better (score), position is derived from sort order
}

export interface RRFResult {
  id: string;
  score: number;
}

export function mergeRRF(
  listA: RankedItem[],
  listB: RankedItem[],
  limit: number,
  k = 60,
): RRFResult[] {
  const scores = new Map<string, number>();

  // Assign RRF score based on position (0-indexed)
  for (let i = 0; i < listA.length; i++) {
    const id = listA[i].id;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
  }

  for (let i = 0; i < listB.length; i++) {
    const id = listB[i].id;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
  }

  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
