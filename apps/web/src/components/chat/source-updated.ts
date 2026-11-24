/**
 * Knowledge loop, Phase 3 — the small "updated" marker on chat sources.
 * The server sets `recentlyUpdated` only for memory whose current version was
 * saved in the last 7 days (and only when the org's knowledge loop is on).
 */
export interface UpdatableSource {
  recentlyUpdated?: boolean;
  lastChangedAt?: string;
}

const DAY = 86_400_000;

/** "updated today" / "updated yesterday" / "updated 3 days ago", or null. */
export function updatedLabel(source: UpdatableSource, now: Date = new Date()): string | null {
  if (!source.recentlyUpdated || !source.lastChangedAt) return null;
  const at = new Date(source.lastChangedAt);
  if (Number.isNaN(at.getTime())) return null;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.max(0, Math.round((startOf(now) - startOf(at)) / DAY));
  if (days === 0) return 'updated today';
  if (days === 1) return 'updated yesterday';
  return `updated ${days} days ago`;
}
