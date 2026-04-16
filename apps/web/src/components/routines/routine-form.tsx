import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/lib/api-client';
import { MentionTextarea, type IntegrationInfo } from './mention-textarea';
import { IntegrationActions } from './integration-actions';
import { PromptRequirements } from './prompt-requirements';
import { TestRunPanel } from './test-run-panel';

interface RoutineFormProps {
  initial?: {
    name: string;
    description: string;
    prompt: string;
    schedule: string;
  };
  onSubmit: (data: {
    name: string;
    description?: string;
    prompt: string;
    schedule: string;
    delivery?: Record<string, unknown>;
  }) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

// ─── Schedule helpers ───────────────────────────────────────────────────────

type Frequency = 'hourly' | 'daily' | 'weekdays' | 'weekly';

interface ScheduleParts {
  frequency: Frequency;
  hour: number;
  minute: number;
  day: number; // 0=Sun … 6=Sat (only for weekly)
}

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays (Mon-Fri)' },
  { value: 'weekly', label: 'Once a week' },
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function buildCron(parts: ScheduleParts): string {
  if (parts.frequency === 'hourly') return `${parts.minute} * * * *`;
  const time = `${parts.minute} ${parts.hour}`;
  switch (parts.frequency) {
    case 'daily': return `${time} * * *`;
    case 'weekdays': return `${time} * * 1-5`;
    case 'weekly': return `${time} * * ${parts.day}`;
    default: return `${time} * * *`;
  }
}

function parseCron(cron: string): ScheduleParts {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { frequency: 'weekdays', hour: 9, minute: 0, day: 1 };

  const [minStr, hourStr, , , dowStr] = parts;
  const minute = minStr === '*' ? 0 : parseInt(minStr, 10) || 0;
  const hour = hourStr === '*' ? 9 : parseInt(hourStr, 10) || 9;

  if (hourStr === '*') return { frequency: 'hourly', hour: 9, minute, day: 1 };
  if (dowStr === '1-5') return { frequency: 'weekdays', hour, minute, day: 1 };
  if (dowStr === '*') return { frequency: 'daily', hour, minute, day: 1 };
  // Single day number
  const day = parseInt(dowStr, 10);
  if (!isNaN(day) && day >= 0 && day <= 6) return { frequency: 'weekly', hour, minute, day };
  return { frequency: 'daily', hour, minute, day: 1 };
}

function formatHour(h: number): string {
  if (h === 0) return '12:00 AM';
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return '12:00 PM';
  return `${h - 12}:00 PM`;
}

function describeSchedule(parts: ScheduleParts): string {
  const time = formatHour(parts.hour);
  switch (parts.frequency) {
    case 'hourly': return `Runs every hour${parts.minute > 0 ? ` at :${String(parts.minute).padStart(2, '0')}` : ''}`;
    case 'daily': return `Runs every day at ${time}`;
    case 'weekdays': return `Runs Monday through Friday at ${time}`;
    case 'weekly': return `Runs every ${DAYS[parts.day]} at ${time}`;
    default: return '';
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function RoutineForm({ initial, onSubmit, onCancel, submitLabel = 'Create' }: RoutineFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [schedule, setSchedule] = useState(initial?.schedule ?? '0 9 * * 1-5');
  const [submitting, setSubmitting] = useState(false);
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [showTest, setShowTest] = useState(false);

  const scheduleParts = useMemo(() => parseCron(schedule), [schedule]);
  const updateSchedule = useCallback((updater: (prev: ScheduleParts) => ScheduleParts) => {
    setSchedule((prev) => buildCron(updater(parseCron(prev))));
  }, []);

  // Fetch available integrations for @ mentions
  useEffect(() => {
    api
      .get<{ data: IntegrationInfo[] }>('/routines/integrations')
      .then((res) => {
        if (res.data) setIntegrations(res.data);
      })
      .catch(() => {});
  }, []);

  // Update fields when initial changes (template selection)
  useEffect(() => {
    if (initial) {
      setName(initial.name);
      setDescription(initial.description);
      setPrompt(initial.prompt);
      setSchedule(initial.schedule);
    }
  }, [initial]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !prompt.trim() || !schedule.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        prompt: prompt.trim(),
        schedule: schedule.trim(),
        delivery: { channels: ['in_app'] },
      });
    } finally {
      setSubmitting(false);
    }
  }, [name, description, prompt, schedule, onSubmit]);

  const isValid = name.trim() && prompt.trim() && schedule.trim();

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name + Description */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="routine-name" className="block text-sm font-medium text-gray-700">Name</label>
          <input
            id="routine-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
            placeholder="Weekly team summary"
            required
          />
        </div>
        <div>
          <label htmlFor="routine-desc" className="block text-sm font-medium text-gray-700">
            Description <span className="text-gray-400">(optional)</span>
          </label>
          <input
            id="routine-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
            placeholder="Summarize completed work each Friday"
          />
        </div>
      </div>

      {/* Prompt */}
      <div>
        <label htmlFor="routine-prompt" className="block text-sm font-medium text-gray-700">Prompt</label>
        <div className="mt-1">
          <MentionTextarea
            value={prompt}
            onChange={setPrompt}
            integrations={integrations}
            placeholder="Describe what this routine should do... Type @ to reference integrations like @Slack, @Notion"
            rows={5}
          />
        </div>

        {/* Requirement tips */}
        {prompt.trim() && (
          <div className="mt-2">
            <PromptRequirements prompt={prompt} integrations={integrations} />
          </div>
        )}
      </div>

      {/* Integrations & Actions — auto-populated from @mentions */}
      <IntegrationActions prompt={prompt} connectedIntegrations={integrations} />

      {/* Schedule */}
      <div>
        <label className="block text-sm font-medium text-gray-700">Schedule</label>

        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {/* Frequency */}
          <select
            value={scheduleParts.frequency}
            onChange={(e) =>
              updateSchedule((p) => ({ ...p, frequency: e.target.value as Frequency }))
            }
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
          >
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>

          {/* Day (weekly only) */}
          {scheduleParts.frequency === 'weekly' && (
            <>
              <span className="text-sm text-gray-500">on</span>
              <select
                value={scheduleParts.day}
                onChange={(e) =>
                  updateSchedule((p) => ({ ...p, day: parseInt(e.target.value, 10) }))
                }
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
              >
                {DAYS.map((d, i) => (
                  <option key={i} value={i}>{d}</option>
                ))}
              </select>
            </>
          )}

          {/* Time (not for hourly) */}
          {scheduleParts.frequency !== 'hourly' && (
            <>
              <span className="text-sm text-gray-500">at</span>
              <select
                value={scheduleParts.hour}
                onChange={(e) =>
                  updateSchedule((p) => ({ ...p, hour: parseInt(e.target.value, 10) }))
                }
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>{formatHour(h)}</option>
                ))}
              </select>
            </>
          )}
        </div>

        {/* Human-readable summary */}
        <p className="mt-2 text-xs text-gray-500">
          {describeSchedule(scheduleParts)}
        </p>
      </div>

      {/* Test run */}
      <div>
        <button
          type="button"
          onClick={() => setShowTest(!showTest)}
          className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          <svg
            className={`h-3.5 w-3.5 transition-transform ${showTest ? 'rotate-90' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
          </svg>
          Test before saving
        </button>
        {showTest && <TestRunPanel prompt={prompt} />}
      </div>

      {/* Submit */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !isValid}
          className="rounded-lg bg-hearth-600 px-4 py-2 text-sm font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
        >
          {submitting ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  );
}
