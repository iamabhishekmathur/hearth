import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/lib/api-client';
import { MentionTextarea, type IntegrationInfo } from './mention-textarea';
import { IntegrationActions } from './integration-actions';
import { PromptRequirements } from './prompt-requirements';
import { TestRunPanel } from './test-run-panel';

// ─── Types ──────────────────────────────────────────────────────────────────

type TriggerType = 'schedule' | 'event_only' | 'both';
type ScopeType = 'personal' | 'team' | 'org';

interface StateConfig {
  trackDeltas: boolean;
  previousRunCount: number;
}

interface ParameterDef {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'date';
  required: boolean;
  default: string;
  options: string; // comma-separated for enum
}

interface CheckpointDef {
  name: string;
  description: string;
  timeoutMinutes: number;
}

interface RoutineFormProps {
  initial?: {
    name: string;
    description: string;
    prompt: string;
    schedule: string;
    stateConfig?: StateConfig;
    scope?: ScopeType;
    teamId?: string;
    parameters?: ParameterDef[];
    checkpoints?: CheckpointDef[];
  };
  onSubmit: (data: {
    name: string;
    description?: string;
    prompt: string;
    schedule?: string;
    triggerType: TriggerType;
    delivery?: Record<string, unknown>;
    stateConfig?: StateConfig;
    scope: ScopeType;
    teamId?: string;
    parameters?: ParameterDef[];
    checkpoints?: CheckpointDef[];
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

const PARAM_TYPES: { value: ParameterDef['type']; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'enum', label: 'Enum' },
  { value: 'date', label: 'Date' },
];

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

// ─── Collapsible chevron SVG ────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
    </svg>
  );
}

// ─── Default factories ──────────────────────────────────────────────────────

function defaultParameter(): ParameterDef {
  return { name: '', label: '', type: 'string', required: false, default: '', options: '' };
}

function defaultCheckpoint(): CheckpointDef {
  return { name: '', description: '', timeoutMinutes: 30 };
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

  // Feature 2: Trigger type
  const [triggerType, setTriggerType] = useState<TriggerType>('schedule');

  // Feature 1: State & Continuity
  const [showState, setShowState] = useState(false);
  const [trackDeltas, setTrackDeltas] = useState(initial?.stateConfig?.trackDeltas ?? false);
  const [previousRunCount, setPreviousRunCount] = useState(initial?.stateConfig?.previousRunCount ?? 3);

  // Feature 3: Scope
  const [scope, setScope] = useState<ScopeType>(initial?.scope ?? 'personal');

  // Feature 4: Parameters
  const [showParams, setShowParams] = useState(false);
  const [parameters, setParameters] = useState<ParameterDef[]>(initial?.parameters ?? []);

  // Feature 5: Approval checkpoints
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [checkpoints, setCheckpoints] = useState<CheckpointDef[]>(initial?.checkpoints ?? []);

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
      if (initial.stateConfig) {
        setTrackDeltas(initial.stateConfig.trackDeltas);
        setPreviousRunCount(initial.stateConfig.previousRunCount);
      }
      if (initial.scope) setScope(initial.scope);
      if (initial.parameters) setParameters(initial.parameters);
      if (initial.checkpoints) setCheckpoints(initial.checkpoints);
    }
  }, [initial]);

  // ── Parameter helpers ───────────────────────────────────────────────────

  const addParameter = useCallback(() => {
    setParameters((prev) => [...prev, defaultParameter()]);
  }, []);

  const removeParameter = useCallback((index: number) => {
    setParameters((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateParameter = useCallback((index: number, field: keyof ParameterDef, value: string | boolean) => {
    setParameters((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    );
  }, []);

  // ── Checkpoint helpers ──────────────────────────────────────────────────

  const addCheckpoint = useCallback(() => {
    setCheckpoints((prev) => [...prev, defaultCheckpoint()]);
  }, []);

  const removeCheckpoint = useCallback((index: number) => {
    setCheckpoints((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateCheckpoint = useCallback((index: number, field: keyof CheckpointDef, value: string | number) => {
    setCheckpoints((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
    );
  }, []);

  // ── Submit ──────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const needsSchedule = triggerType !== 'event_only';
    if (!name.trim() || !prompt.trim()) return;
    if (needsSchedule && !schedule.trim()) return;
    setSubmitting(true);
    try {
      const stateConfig: StateConfig | undefined =
        trackDeltas || previousRunCount !== 3
          ? { trackDeltas, previousRunCount }
          : undefined;

      const cleanedParams = parameters.filter((p) => p.name.trim());
      const cleanedCheckpoints = checkpoints.filter((c) => c.name.trim());

      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        prompt: prompt.trim(),
        schedule: needsSchedule ? schedule.trim() : undefined,
        triggerType,
        delivery: { channels: ['in_app'] },
        stateConfig,
        scope,
        parameters: cleanedParams.length > 0 ? cleanedParams : undefined,
        checkpoints: cleanedCheckpoints.length > 0 ? cleanedCheckpoints : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }, [name, description, prompt, schedule, triggerType, trackDeltas, previousRunCount, scope, parameters, checkpoints, onSubmit]);

  const needsSchedule = triggerType !== 'event_only';
  const isValid = name.trim() && prompt.trim() && (!needsSchedule || schedule.trim());

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name + Description */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="routine-name" className="block text-sm font-medium text-hearth-text">Name</label>
          <input
            id="routine-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm shadow-hearth-1 focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
            placeholder="Weekly team summary"
            required
          />
        </div>
        <div>
          <label htmlFor="routine-desc" className="block text-sm font-medium text-hearth-text">
            Description <span className="text-hearth-text-faint">(optional)</span>
          </label>
          <input
            id="routine-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-hearth-border-strong px-3 py-2 text-sm shadow-hearth-1 focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
            placeholder="Summarize completed work each Friday"
          />
        </div>
      </div>

      {/* Prompt */}
      <div>
        <label htmlFor="routine-prompt" className="block text-sm font-medium text-hearth-text">Prompt</label>
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

      {/* ── Feature 2: Trigger Type ──────────────────────────────────────── */}
      <div>
        <label className="block text-sm font-medium text-hearth-text">Trigger Type</label>
        <div className="mt-1.5 flex items-center gap-4">
          {([
            { value: 'schedule', label: 'Schedule' },
            { value: 'event_only', label: 'Event-Only' },
            { value: 'both', label: 'Both' },
          ] as const).map((opt) => (
            <label key={opt.value} className="flex items-center gap-1.5 text-sm text-hearth-text cursor-pointer">
              <input
                type="radio"
                name="trigger-type"
                value={opt.value}
                checked={triggerType === opt.value}
                onChange={() => setTriggerType(opt.value)}
                className="h-4 w-4 border-hearth-border-strong text-hearth-600 focus:ring-hearth-accent"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* Schedule — hidden when trigger is event-only */}
      {needsSchedule && (
        <div>
          <label className="block text-sm font-medium text-hearth-text">Schedule</label>

          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {/* Frequency */}
            <select
              value={scheduleParts.frequency}
              onChange={(e) =>
                updateSchedule((p) => ({ ...p, frequency: e.target.value as Frequency }))
              }
              className="rounded-lg border border-hearth-border-strong px-3 py-2 text-sm shadow-hearth-1 focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
            >
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>

            {/* Day (weekly only) */}
            {scheduleParts.frequency === 'weekly' && (
              <>
                <span className="text-sm text-hearth-text-muted">on</span>
                <select
                  value={scheduleParts.day}
                  onChange={(e) =>
                    updateSchedule((p) => ({ ...p, day: parseInt(e.target.value, 10) }))
                  }
                  className="rounded-lg border border-hearth-border-strong px-3 py-2 text-sm shadow-hearth-1 focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
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
                <span className="text-sm text-hearth-text-muted">at</span>
                <select
                  value={scheduleParts.hour}
                  onChange={(e) =>
                    updateSchedule((p) => ({ ...p, hour: parseInt(e.target.value, 10) }))
                  }
                  className="rounded-lg border border-hearth-border-strong px-3 py-2 text-sm shadow-hearth-1 focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>{formatHour(h)}</option>
                  ))}
                </select>
              </>
            )}
          </div>

          {/* Human-readable summary */}
          <p className="mt-2 text-xs text-hearth-text-muted">
            {describeSchedule(scheduleParts)}
          </p>
        </div>
      )}

      {/* ── Feature 1: State & Continuity (collapsible) ──────────────────── */}
      <div>
        <button
          type="button"
          onClick={() => setShowState(!showState)}
          className="mb-2 flex items-center gap-1.5 text-sm font-medium text-hearth-text-muted hover:text-hearth-text"
        >
          <ChevronIcon open={showState} />
          State &amp; Continuity
        </button>
        {showState && (
          <div className="ml-5 space-y-3 rounded-lg border border-hearth-border bg-hearth-bg p-4">
            {/* Track deltas toggle */}
            <label className="flex items-center gap-2 text-sm text-hearth-text cursor-pointer">
              <input
                type="checkbox"
                checked={trackDeltas}
                onChange={(e) => setTrackDeltas(e.target.checked)}
                className="h-4 w-4 rounded border-hearth-border-strong text-hearth-600 focus:ring-hearth-accent"
              />
              Track deltas between runs
            </label>

            {/* Previous run count */}
            <div className="flex items-center gap-3">
              <label htmlFor="prev-run-count" className="text-sm text-hearth-text">
                Previous runs to include
              </label>
              <input
                id="prev-run-count"
                type="number"
                min={1}
                max={10}
                value={previousRunCount}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (v >= 1 && v <= 10) setPreviousRunCount(v);
                }}
                className="w-20 rounded-lg border border-hearth-border-strong px-3 py-1.5 text-sm shadow-hearth-1 focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
              />
            </div>
            <p className="text-xs text-hearth-text-muted">
              Context from past runs is injected so the routine can detect changes over time.
            </p>
          </div>
        )}
      </div>

      {/* ── Feature 4: Parameters (collapsible) ──────────────────────────── */}
      <div>
        <button
          type="button"
          onClick={() => setShowParams(!showParams)}
          className="mb-2 flex items-center gap-1.5 text-sm font-medium text-hearth-text-muted hover:text-hearth-text"
        >
          <ChevronIcon open={showParams} />
          Parameters
        </button>
        {showParams && (
          <div className="ml-5 space-y-3 rounded-lg border border-hearth-border bg-hearth-bg p-4">
            {parameters.length === 0 && (
              <p className="text-xs text-hearth-text-muted">No parameters defined yet. Add one to let callers pass runtime values.</p>
            )}

            {parameters.map((param, idx) => (
              <div key={idx} className="space-y-2 rounded-lg border border-hearth-border bg-hearth-card p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-hearth-text-muted">Parameter {idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeParameter(idx)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {/* Name */}
                  <input
                    type="text"
                    value={param.name}
                    onChange={(e) => updateParameter(idx, 'name', e.target.value)}
                    placeholder="name (e.g. repo_url)"
                    className="rounded-lg border border-hearth-border-strong px-3 py-1.5 text-sm shadow-hearth-1 focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
                  />
                  {/* Label */}
                  <input
                    type="text"
                    value={param.label}
                    onChange={(e) => updateParameter(idx, 'label', e.target.value)}
                    placeholder="Label (e.g. Repository URL)"
                    className="rounded-lg border border-hearth-border-strong px-3 py-1.5 text-sm shadow-hearth-1 focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
                  />
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  {/* Type */}
                  <select
                    value={param.type}
                    onChange={(e) => updateParameter(idx, 'type', e.target.value)}
                    className="rounded-lg border border-hearth-border-strong px-3 py-1.5 text-sm shadow-hearth-1 focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
                  >
                    {PARAM_TYPES.map((pt) => (
                      <option key={pt.value} value={pt.value}>{pt.label}</option>
                    ))}
                  </select>
                  {/* Default */}
                  <input
                    type="text"
                    value={param.default}
                    onChange={(e) => updateParameter(idx, 'default', e.target.value)}
                    placeholder="Default value"
                    className="rounded-lg border border-hearth-border-strong px-3 py-1.5 text-sm shadow-hearth-1 focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
                  />
                  {/* Required */}
                  <label className="flex items-center gap-2 text-sm text-hearth-text cursor-pointer">
                    <input
                      type="checkbox"
                      checked={param.required}
                      onChange={(e) => updateParameter(idx, 'required', e.target.checked)}
                      className="h-4 w-4 rounded border-hearth-border-strong text-hearth-600 focus:ring-hearth-accent"
                    />
                    Required
                  </label>
                </div>

                {/* Options — only for enum type */}
                {param.type === 'enum' && (
                  <input
                    type="text"
                    value={param.options}
                    onChange={(e) => updateParameter(idx, 'options', e.target.value)}
                    placeholder="Options (comma-separated, e.g. low, medium, high)"
                    className="w-full rounded-lg border border-hearth-border-strong px-3 py-1.5 text-sm shadow-hearth-1 focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
                  />
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={addParameter}
              className="rounded-lg border border-dashed border-hearth-border-strong px-3 py-1.5 text-sm text-hearth-text-muted hover:border-gray-400 hover:text-hearth-text"
            >
              + Add parameter
            </button>
          </div>
        )}
      </div>

      {/* ── Feature 5: Approval Gates (collapsible) ──────────────────────── */}
      <div>
        <button
          type="button"
          onClick={() => setShowCheckpoints(!showCheckpoints)}
          className="mb-2 flex items-center gap-1.5 text-sm font-medium text-hearth-text-muted hover:text-hearth-text"
        >
          <ChevronIcon open={showCheckpoints} />
          Approval Gates
        </button>
        {showCheckpoints && (
          <div className="ml-5 space-y-3 rounded-lg border border-hearth-border bg-hearth-bg p-4">
            {checkpoints.length === 0 && (
              <p className="text-xs text-hearth-text-muted">No approval gates defined. Add one to pause execution and require human approval.</p>
            )}

            {checkpoints.map((cp, idx) => (
              <div key={idx} className="space-y-2 rounded-lg border border-hearth-border bg-hearth-card p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-hearth-text-muted">Gate {idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeCheckpoint(idx)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {/* Name */}
                  <input
                    type="text"
                    value={cp.name}
                    onChange={(e) => updateCheckpoint(idx, 'name', e.target.value)}
                    placeholder="Gate name"
                    className="rounded-lg border border-hearth-border-strong px-3 py-1.5 text-sm shadow-hearth-1 focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
                  />
                  {/* Timeout */}
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={cp.timeoutMinutes}
                      onChange={(e) => updateCheckpoint(idx, 'timeoutMinutes', parseInt(e.target.value, 10) || 30)}
                      className="w-24 rounded-lg border border-hearth-border-strong px-3 py-1.5 text-sm shadow-hearth-1 focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
                    />
                    <span className="text-xs text-hearth-text-muted">min timeout</span>
                  </div>
                </div>

                {/* Description */}
                <input
                  type="text"
                  value={cp.description}
                  onChange={(e) => updateCheckpoint(idx, 'description', e.target.value)}
                  placeholder="Description (what needs approval)"
                  className="w-full rounded-lg border border-hearth-border-strong px-3 py-1.5 text-sm shadow-hearth-1 focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
                />
              </div>
            ))}

            <button
              type="button"
              onClick={addCheckpoint}
              className="rounded-lg border border-dashed border-hearth-border-strong px-3 py-1.5 text-sm text-hearth-text-muted hover:border-gray-400 hover:text-hearth-text"
            >
              + Add approval gate
            </button>
          </div>
        )}
      </div>

      {/* Test run */}
      <div>
        <button
          type="button"
          onClick={() => setShowTest(!showTest)}
          className="mb-2 flex items-center gap-1.5 text-sm font-medium text-hearth-text-muted hover:text-hearth-text"
        >
          <ChevronIcon open={showTest} />
          Test before saving
        </button>
        {showTest && <TestRunPanel prompt={prompt} />}
      </div>

      {/* ── Feature 3: Scope ─────────────────────────────────────────────── */}
      <div>
        <label className="block text-sm font-medium text-hearth-text">Scope</label>
        <div className="mt-1.5 flex items-center gap-4">
          {([
            { value: 'personal', label: 'Personal' },
            { value: 'team', label: 'Team' },
            { value: 'org', label: 'Organization' },
          ] as const).map((opt) => (
            <label key={opt.value} className="flex items-center gap-1.5 text-sm text-hearth-text cursor-pointer">
              <input
                type="radio"
                name="scope"
                value={opt.value}
                checked={scope === opt.value}
                onChange={() => setScope(opt.value)}
                className="h-4 w-4 border-hearth-border-strong text-hearth-600 focus:ring-hearth-accent"
              />
              {opt.label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-hearth-text-muted">
          {scope === 'personal' && 'Only you can see and trigger this routine.'}
          {scope === 'team' && 'All members of the selected team can see and trigger this routine.'}
          {scope === 'org' && 'Everyone in the organization can see and trigger this routine.'}
        </p>
      </div>

      {/* Submit */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm font-medium text-hearth-text hover:bg-hearth-chip"
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
