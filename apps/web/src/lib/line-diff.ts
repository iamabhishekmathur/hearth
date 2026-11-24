/**
 * A small line-level diff for prompt history: which lines a version added,
 * removed or kept compared with the version before it. Longest common
 * subsequence over lines; very long texts fall back to "all removed, all
 * added" so the page never stalls.
 */
export type DiffLine = { type: 'same' | 'add' | 'del'; text: string };

const MAX_CELLS = 250_000;

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (before === after) return b.map((text) => ({ type: 'same', text }));
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text) => ({ type: 'del' as const, text })),
      ...b.map((text) => ({ type: 'add' as const, text })),
    ];
  }
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'del', text: a[i++] });
    } else {
      out.push({ type: 'add', text: b[j++] });
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] });
  while (j < m) out.push({ type: 'add', text: b[j++] });
  return out;
}

/** "2 lines added, 1 removed" — or "No change to the text". */
export function diffSummary(lines: DiffLine[]): string {
  const added = lines.filter((l) => l.type === 'add').length;
  const removed = lines.filter((l) => l.type === 'del').length;
  if (!added && !removed) return 'No change to the text';
  const parts: string[] = [];
  if (added) parts.push(`${added} ${added === 1 ? 'line' : 'lines'} added`);
  if (removed) parts.push(`${removed} removed`);
  return parts.join(', ');
}
