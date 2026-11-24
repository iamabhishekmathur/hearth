import { useEffect, useState } from 'react';
import type {
  KnowledgeAdminSummary,
  KnowledgeMyImpact,
  KnowledgeUnownedArea,
  NotificationPreferencesResponse,
} from '@hearth/shared';
import { api } from '@/lib/api-client';
import { HCard, HEyebrow } from '@/components/ui/primitives';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function impactText(count: number): string | null {
  if (count < 1) return null;
  return `Your input improved ${count} ${plural(count, 'thing', 'things')} this week.`;
}

export function areaText(a: KnowledgeUnownedArea): string {
  const what = [
    a.memory ? `${a.memory} memory ${plural(a.memory, 'entry', 'entries')}` : '',
    a.routines ? `${a.routines} ${plural(a.routines, 'routine', 'routines')}` : '',
  ]
    .filter(Boolean)
    .join(' and ');
  switch (a.reason) {
    case 'team_no_lead':
      return `${a.teamName ?? 'A team'} has no team lead — ${what} fall back to admins.`;
    case 'no_admin':
      return `No admin owns org items — ${what}.`;
    case 'owner_left':
      return `Named owner left the org — ${what}.`;
  }
}

/**
 * Knowledge loop, Phase 3 — the quiet lines on the Activity page:
 *   - members: "Your input improved N things this week." (only when N ≥ 1);
 *   - admins: the weekly summary (what changed, what waits, areas with no owner).
 * Renders nothing when the knowledge loop is off or the switches are off.
 */
export function ActivityKnowledge({ isAdmin }: { isAdmin: boolean }) {
  const [impact, setImpact] = useState<KnowledgeMyImpact | null>(null);
  const [summary, setSummary] = useState<KnowledgeAdminSummary | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let prefs: NotificationPreferencesResponse | null = null;
      try {
        prefs =
          (await api.get<{ data: NotificationPreferencesResponse }>('/notifications/preferences'))
            .data ?? null;
      } catch {
        return;
      }
      if (!alive || !prefs?.knowledgeLoop) return;
      if (prefs.prefs.knowledgeImpact) {
        api
          .get<{ data: KnowledgeMyImpact }>('/knowledge/my-impact?days=7')
          .then((r) => alive && setImpact(r.data ?? null))
          .catch(() => {});
      }
      if (isAdmin && prefs.prefs.adminWeeklySummary) {
        api
          .get<{ data: KnowledgeAdminSummary }>('/knowledge/admin-summary?days=7')
          .then((r) => alive && setSummary(r.data ?? null))
          .catch(() => {});
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  const line = impact ? impactText(impact.count) : null;
  if (!line && !summary) return null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-2 px-4 pt-4" data-testid="activity-knowledge">
      {line && (
        <p
          className="animate-fade-in rounded-md px-3 py-2 text-[13px] text-hearth-text-muted"
          style={{ background: 'var(--hearth-accent-soft)' }}
        >
          {line}
        </p>
      )}
      {summary && (
        <div className="animate-fade-in">
          <HCard padding="p-4">
            <HEyebrow>This week in knowledge</HEyebrow>
            <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-hearth-text-faint">Changed</dt>
                <dd className="text-hearth-text">
                  {summary.changed.approved + summary.changed.edited}
                  <span className="text-xs text-hearth-text-muted">
                    {' '}
                    ({summary.changed.approved} approved, {summary.changed.edited} edited)
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-hearth-text-faint">Waiting</dt>
                <dd className="text-hearth-text">
                  {summary.waiting.pending}
                  {summary.waiting.oldestDays !== null && summary.waiting.pending > 0 && (
                    <span className="text-xs text-hearth-text-muted">
                      {' '}
                      (oldest {summary.waiting.oldestDays}{' '}
                      {plural(summary.waiting.oldestDays, 'day', 'days')})
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-hearth-text-faint">No owner</dt>
                <dd className="text-hearth-text">{summary.unowned.length}</dd>
              </div>
            </dl>
            {summary.unowned.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-hearth-text-muted">
                {summary.unowned.map((a) => (
                  <li key={`${a.reason}:${a.teamId ?? ''}`}>{areaText(a)}</li>
                ))}
              </ul>
            )}
            {summary.waiting.pending > 0 && (
              <a href="#/review" className="mt-3 inline-block text-xs text-hearth-accent">
                Open Review
              </a>
            )}
          </HCard>
        </div>
      )}
    </div>
  );
}
