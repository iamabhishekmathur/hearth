import type { NotificationPreferences } from '@hearth/shared';
import { HCard, HEyebrow } from '@/components/ui/primitives';
import { useNotificationPreferences } from '@/hooks/use-notification-preferences';

interface Row {
  key: keyof NotificationPreferences;
  title: string;
  help: string;
  adminOnly?: boolean;
}

const ROWS: Row[] = [
  {
    key: 'knowledgeSummary',
    title: 'Daily review summary',
    help: 'One line in your daily digest when proposals wait for you, and one reminder after a week.',
  },
  {
    key: 'knowledgeEmail',
    title: 'Email the review summary',
    help: 'Also send that line by email. Off: in-app only.',
  },
  {
    key: 'knowledgeImpact',
    title: 'Show how my input helped',
    help: 'One line on Activity when your feedback led to an approved fix this week.',
  },
  {
    key: 'adminWeeklySummary',
    title: 'Weekly knowledge summary',
    help: 'What changed, what waits, and areas with no owner. On Activity and in Monday’s digest.',
    adminOnly: true,
  },
];

/**
 * Knowledge loop, Phase 3 — the switches for every knowledge notification.
 * Shown only when the org's knowledge loop is on.
 */
export function NotificationSettings({ isAdmin }: { isAdmin: boolean }) {
  const { data, saving, error, set } = useNotificationPreferences();
  if (!data || !data.knowledgeLoop) return null;

  return (
    <HCard padding="p-6">
      <HEyebrow>Notifications</HEyebrow>
      <h2 className="mt-1 text-base font-semibold text-hearth-text">Knowledge updates</h2>
      <p className="mt-1 text-sm text-hearth-text-muted">
        Hearth never pings you for each change. Choose what you see.
      </p>
      <div className="mt-4 space-y-2">
        {ROWS.filter((r) => !r.adminOnly || isAdmin).map((r) => {
          const on = data.prefs[r.key];
          return (
            <div
              key={r.key}
              className="flex items-center justify-between gap-4 rounded-lg border border-hearth-border bg-hearth-card-alt p-3"
            >
              <div>
                <p className="text-sm font-medium text-hearth-text">{r.title}</p>
                <p className="text-xs text-hearth-text-muted">{r.help}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={r.title}
                data-pref={r.key}
                disabled={saving === r.key}
                onClick={() => void set(r.key, !on)}
                className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50"
                style={{ background: on ? 'var(--hearth-accent)' : 'var(--hearth-border-strong)' }}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    on ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-hearth-err">
          Could not save. Try again.
        </p>
      )}
    </HCard>
  );
}
