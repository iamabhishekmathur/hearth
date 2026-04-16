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
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[status] ?? 'bg-gray-50 text-gray-600 ring-gray-500/10'}`}>
      {status}
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
        return (
          <div
            key={routine.id}
            role="listitem"
            className={`group flex items-center justify-between rounded-lg border px-4 py-3 transition-colors ${
              isSelected
                ? 'border-hearth-200 bg-hearth-50'
                : 'border-transparent hover:border-gray-200 hover:bg-gray-50'
            }`}
          >
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => onSelect(routine)}
            >
              <div className="flex items-center gap-2">
                <span className={`flex h-2 w-2 rounded-full ${routine.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                <h3 className="truncate text-sm font-medium text-gray-900">{routine.name}</h3>
                <StatusBadge status={routine.lastRunStatus} />
              </div>
              {routine.description && (
                <p className="mt-0.5 truncate pl-4 text-xs text-gray-500">{routine.description}</p>
              )}
              <div className="mt-1 flex items-center gap-3 pl-4 text-xs text-gray-400">
                <span>{formatSchedule(routine.schedule)}</span>
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
                  routine.enabled ? 'bg-hearth-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
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
