import type { ActivityEvent } from '@hearth/shared';

interface ActivityEventCardProps {
  event: ActivityEvent;
}

const ACTION_LABELS: Record<string, string> = {
  task_completed: 'completed a task',
  skill_published: 'published a skill',
  skill_install: 'installed a skill',
  routine_run: 'ran a routine',
  session_created: 'started a session',
};

const ACTION_COLORS: Record<string, string> = {
  task_completed: 'bg-green-100 text-green-700',
  skill_published: 'bg-purple-100 text-purple-700',
  skill_install: 'bg-blue-100 text-blue-700',
  routine_run: 'bg-yellow-100 text-yellow-700',
  session_created: 'bg-gray-100 text-gray-600',
};

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ActivityEventCard({ event }: ActivityEventCardProps) {
  const label = ACTION_LABELS[event.action] ?? event.action.replace(/_/g, ' ');
  const colorClass = ACTION_COLORS[event.action] ?? 'bg-gray-100 text-gray-600';
  const details = event.details ?? {};
  const entityName = (details.title ?? details.name ?? event.entityId ?? '') as string;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-gray-100 bg-white p-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-700">
        {event.userName?.charAt(0).toUpperCase() ?? '?'}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900">
          <span className="font-medium">{event.userName ?? 'System'}</span>{' '}
          {label}
          {entityName && (
            <>
              {' '}
              <span className="font-medium text-gray-700">{entityName}</span>
            </>
          )}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${colorClass}`}>
            {event.action.replace(/_/g, ' ')}
          </span>
          <span className="text-xs text-gray-400">{timeAgo(event.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
