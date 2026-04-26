import type { Routine } from '@hearth/shared';

interface RoutineListProps {
  routines: Routine[];
  selectedId: string | null;
  onSelect: (routine: Routine) => void;
  onToggle: (id: string) => void;
  onRunNow: (id: string) => void;
}

function StatusBadge({ status }: { status: string | null }) {
  const styles: Record<string, string> = {
    success: 'bg-green-50 text-green-700 ring-green-600/20',
    failed: 'bg-red-50 text-red-700 ring-red-600/20',
    running: 'bg-yellow-50 text-yellow-700 ring-yellow-600/20',
  };
  if (!status) return null;
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[status] ?? 'bg-hearth-bg text-hearth-text-muted ring-gray-500/10'}`}>
      {status}
    </span>
  );
}

function ScopeBadge({ scope }: { scope?: string }) {
  if (!scope || scope === 'personal') return null;
  const label = scope === 'team' ? 'Team' : 'Org';
  const styles =
    scope === 'team'
      ? 'bg-blue-50 text-blue-700 ring-blue-600/20'
      : 'bg-purple-50 text-purple-700 ring-purple-600/20';
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${styles}`}>
      {label}
    </span>
  );
}

function LightningBoltIcon() {
  return (
    <svg className="h-3.5 w-3.5 text-amber-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M11.983 1.907a.75.75 0 0 0-1.292-.657l-8.5 9.5A.75.75 0 0 0 2.75 12h6.572l-1.305 6.093a.75.75 0 0 0 1.292.657l8.5-9.5A.75.75 0 0 0 17.25 8h-6.572l1.305-6.093Z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="h-3.5 w-3.5 text-hearth-text-faint" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clipRule="evenodd" />
    </svg>
  );
}

function TriggerIcons({ routine }: { routine: Routine }) {
  const hasTriggers = routine.triggers && routine.triggers.length > 0;
  const hasSchedule = routine.schedule != null;
  if (!hasTriggers && !hasSchedule) return null;
  return (
    <span className="inline-flex items-center gap-0.5">
      {hasSchedule && <ClockIcon />}
      {hasTriggers && <LightningBoltIcon />}
    </span>
  );
}

function formatSchedule(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, , , dow] = parts;
  if (hour === '*') return `Every hour${min !== '0' ? ` at :${min.padStart(2, '0')}` : ''}`;
  const h = parseInt(hour, 10);
  const time = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
  if (dow === '*') return `Daily at ${time}`;
  if (dow === '1-5') return `Weekdays at ${time}`;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // Range like 0-4
  const rangeMatch = dow.match(/^(\d)-(\d)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (start >= 0 && end <= 6) return `${days[start]}–${days[end]} at ${time}`;
  }
  // Single day
  const d = parseInt(dow, 10);
  if (!isNaN(d) && d >= 0 && d <= 6) return `Every ${days[d]} at ${time}`;
  return cron;
}

export function RoutineList({ routines, selectedId, onSelect, onToggle, onRunNow }: RoutineListProps) {
  return (
    <div role="list" aria-label="Routines" className="space-y-1">
      {routines.map((routine) => {
        const isSelected = routine.id === selectedId;
        const routineWithUser = routine as Routine & { user?: { name?: string } };
        const isShared = routine.scope && routine.scope !== 'personal';
        return (
          <div
            key={routine.id}
            role="listitem"
            className={`group flex items-center justify-between rounded-lg border px-4 py-3 transition-colors ${
              isSelected
                ? 'border-hearth-200 bg-hearth-50'
                : 'border-transparent hover:border-hearth-border hover:bg-hearth-bg'
            }`}
          >
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => onSelect(routine)}
            >
              <div className="flex items-center gap-2">
                <span className={`flex h-2 w-2 shrink-0 rounded-full ${routine.enabled ? 'bg-green-500' : 'bg-hearth-border-strong'}`} />
                <h3 className="truncate text-sm font-medium text-hearth-text">{routine.name}</h3>
                <StatusBadge status={routine.lastRunStatus} />
                <ScopeBadge scope={routine.scope} />
              </div>
              {routine.description && (
                <p className="mt-0.5 truncate pl-4 text-xs text-hearth-text-muted">{routine.description}</p>
              )}
              <div className="mt-1 flex items-center gap-3 pl-4 text-xs text-hearth-text-faint">
                <span className="inline-flex items-center gap-1">
                  <TriggerIcons routine={routine} />
                  {routine.schedule != null ? formatSchedule(routine.schedule) : 'Event-driven'}
                </span>
                {isShared && routineWithUser.user?.name && (
                  <>
                    <span aria-hidden="true">&middot;</span>
                    <span>by {routineWithUser.user.name}</span>
                  </>
                )}
                {routine.lastRunAt && (
                  <>
                    <span aria-hidden="true">&middot;</span>
                    <span>Last run {new Date(routine.lastRunAt).toLocaleDateString()}</span>
                  </>
                )}
              </div>
            </button>
            <div className="ml-3 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100"
              style={isSelected ? { opacity: 1 } : undefined}
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRunNow(routine.id); }}
                className="rounded-md px-2.5 py-1 text-xs font-medium text-hearth-600 transition-colors hover:bg-hearth-100"
                aria-label={`Run ${routine.name} now`}
              >
                Run
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggle(routine.id); }}
                role="switch"
                aria-checked={routine.enabled}
                aria-label={`${routine.enabled ? 'Disable' : 'Enable'} ${routine.name}`}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  routine.enabled ? 'bg-hearth-600' : 'bg-hearth-border-strong'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-hearth-card shadow transition-transform ${
                    routine.enabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
