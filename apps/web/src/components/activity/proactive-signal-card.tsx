import type { ProactiveSignal } from '@hearth/shared';

const SIGNAL_ICONS: Record<string, string> = {
  stale_routine: '\u{23F0}',
  skill_recommendation: '\u{1F4A1}',
  trending_skill: '\u{1F4C8}',
  idle_task: '\u{26A0}\u{FE0F}',
};

const SIGNAL_COLORS: Record<string, string> = {
  stale_routine: 'border-yellow-200 bg-yellow-50',
  skill_recommendation: 'border-blue-200 bg-blue-50',
  trending_skill: 'border-purple-200 bg-purple-50',
  idle_task: 'border-orange-200 bg-orange-50',
};

interface ProactiveSignalCardProps {
  signal: ProactiveSignal;
  onDismiss: () => void;
}

export function ProactiveSignalCard({ signal, onDismiss }: ProactiveSignalCardProps) {
  const icon = SIGNAL_ICONS[signal.type] ?? '\u{1F514}';
  const colorClass = SIGNAL_COLORS[signal.type] ?? 'border-gray-200 bg-gray-50';

  return (
    <div className={`flex items-center gap-3 rounded-lg border p-3 ${colorClass}`}>
      <span className="text-lg" role="img" aria-label={signal.type}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900">{signal.title}</p>
        <p className="text-xs text-gray-600">{signal.description}</p>
      </div>
      <a
        href={signal.actionUrl}
        className="shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-hearth-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
      >
        {signal.actionLabel}
      </a>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 text-gray-400 hover:text-gray-600"
        aria-label="Dismiss"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
        </svg>
      </button>
    </div>
  );
}
