import { useState } from 'react';
import type { ActivityEvent } from '@hearth/shared';
import { ActivityEventCard } from './activity-event-card';

const ACTION_LABELS: Record<string, string> = {
  task_completed: 'tasks completed',
  skill_published: 'skills published',
  skill_install: 'skills installed',
  routine_run: 'routines run',
  session_created: 'sessions started',
};

const ACTION_COLORS: Record<string, string> = {
  task_completed: 'bg-green-100 text-green-700',
  skill_published: 'bg-purple-100 text-purple-700',
  skill_install: 'bg-blue-100 text-blue-700',
  routine_run: 'bg-yellow-100 text-yellow-700',
  session_created: 'bg-hearth-chip text-hearth-text-muted',
};

interface ActivityEventGroupProps {
  action: string;
  events: ActivityEvent[];
}

export function ActivityEventGroup({ action, events }: ActivityEventGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const label = ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
  const colorClass = ACTION_COLORS[action] ?? 'bg-hearth-chip text-hearth-text-muted';

  // Collect unique user names for stacked avatars
  const uniqueUsers = Array.from(new Set(events.map((e) => e.userName).filter(Boolean))) as string[];
  const displayUsers = uniqueUsers.slice(0, 3);
  const extraCount = uniqueUsers.length - displayUsers.length;

  if (expanded) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex items-center gap-1 text-xs text-hearth-text-muted hover:text-hearth-text"
        >
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
          </svg>
          Collapse {events.length} {label}
        </button>
        {events.map((event) => (
          <ActivityEventCard key={event.id} event={event} />
        ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      className="flex w-full items-center gap-3 rounded-lg border border-hearth-border bg-hearth-card p-3 text-left hover:bg-hearth-bg"
    >
      {/* Stacked avatars */}
      <div className="flex -space-x-2">
        {displayUsers.map((name) => (
          <div
            key={name}
            className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-hearth-chip text-xs font-medium text-hearth-text"
          >
            {name.charAt(0).toUpperCase()}
          </div>
        ))}
        {extraCount > 0 && (
          <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-hearth-chip text-xs font-medium text-hearth-text-muted">
            +{extraCount}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm text-hearth-text">
          <span className="font-medium">{events.length}</span> {label}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${colorClass}`}>
            {action.replace(/_/g, ' ')}
          </span>
          <span className="text-xs text-hearth-text-faint">Click to expand</span>
        </div>
      </div>

      <svg className="h-4 w-4 shrink-0 text-hearth-text-faint" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
      </svg>
    </button>
  );
}
