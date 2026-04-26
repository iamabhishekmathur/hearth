import { useState, useCallback } from 'react';
import type { Task, TaskStatus, TaskExecutionStep } from '@hearth/shared';

const STATUS_COLORS: Record<string, string> = {
  auto_detected: 'bg-amber-100 text-amber-700',
  backlog: 'bg-hearth-chip text-hearth-text',
  planning: 'bg-blue-100 text-blue-700',
  executing: 'bg-purple-100 text-purple-700',
  review: 'bg-orange-100 text-orange-700',
  done: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

const STEP_ICONS: Record<string, { icon: string; color: string }> = {
  pending: { icon: '\u25CB', color: 'text-hearth-text-faint' },
  running: { icon: '\u25CF', color: 'text-blue-500' },
  completed: { icon: '\u2713', color: 'text-green-500' },
  failed: { icon: '\u2717', color: 'text-red-500' },
  paused: { icon: '\u23F8', color: 'text-yellow-500' },
};

interface SubtaskWithSteps extends Task {
  executionSteps?: TaskExecutionStep[];
}

interface TaskSubtasksProps {
  subtasks: SubtaskWithSteps[];
  taskStatus: TaskStatus;
  /** Parent task's execution steps — shown as a summary at the top */
  parentSteps?: TaskExecutionStep[];
  onReplan: (feedback?: string) => Promise<unknown>;
}

function formatJson(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function StepRow({ step }: { step: TaskExecutionStep }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STEP_ICONS[step.status] ?? STEP_ICONS.pending;
  const hasDetails = step.input != null || step.output != null;

  return (
    <div className="border-l-2 border-hearth-border pl-3">
      <button
        type="button"
        onClick={() => hasDetails && setExpanded((v) => !v)}
        className={`flex w-full items-start gap-2 py-1 text-left ${hasDetails ? 'hover:bg-hearth-bg' : 'cursor-default'}`}
      >
        <span className={`mt-0.5 text-xs ${cfg.color} ${step.status === 'running' ? 'animate-pulse' : ''}`}>
          {cfg.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-hearth-text">{step.description}</p>
          <div className="flex items-center gap-2">
            {step.toolUsed && (
              <span className="text-[10px] text-hearth-text-faint">{step.toolUsed}</span>
            )}
            {step.durationMs != null && (
              <span className="text-[10px] text-hearth-text-faint">{step.durationMs}ms</span>
            )}
          </div>
        </div>
        {hasDetails && (
          <svg
            className={`mt-0.5 h-3 w-3 shrink-0 text-hearth-text-faint transition-transform ${expanded ? 'rotate-90' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M7.21 14.77a.75.75 0 0 1 0-1.06L10.44 10 7.21 6.29a.75.75 0 1 1 1.08-1.04l3.75 4a.75.75 0 0 1 0 1.04l-3.75 4a.75.75 0 0 1-1.08 0Z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>

      {expanded && hasDetails && (
        <div className="mb-1 ml-4 space-y-1.5 rounded bg-hearth-bg p-2">
          {step.input != null && (
            <div>
              <p className="text-[10px] font-medium text-hearth-text-faint">Input</p>
              <pre className="max-h-28 overflow-auto text-[10px] text-hearth-text-muted">
                {formatJson(step.input)}
              </pre>
            </div>
          )}
          {step.output != null && (
            <div>
              <p className="text-[10px] font-medium text-hearth-text-faint">Output</p>
              <pre className="max-h-40 overflow-auto text-[10px] text-hearth-text-muted">
                {formatJson(step.output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SubtaskRow({ subtask, index }: { subtask: SubtaskWithSteps; index: number }) {
  const [expanded, setExpanded] = useState(
    subtask.status === 'executing' || subtask.status === 'failed',
  );
  const steps = subtask.executionSteps ?? [];
  const hasContent = steps.length > 0 || subtask.agentOutput != null;
  const completedSteps = steps.filter((s) => s.status === 'completed').length;

  return (
    <div className="rounded-lg border border-hearth-border">
      <button
        type="button"
        onClick={() => hasContent && setExpanded((v) => !v)}
        className={`flex w-full items-start gap-2 p-3 text-left ${hasContent ? 'hover:bg-hearth-bg' : 'cursor-default'}`}
        aria-expanded={hasContent ? expanded : undefined}
      >
        <span className="mt-0.5 text-xs font-medium text-hearth-text-faint">{index + 1}.</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-hearth-text">{subtask.title}</span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLORS[subtask.status] ?? 'bg-hearth-chip text-hearth-text-muted'}`}
            >
              {subtask.status.replace('_', ' ')}
            </span>
          </div>
          {subtask.description && (
            <p className="mt-0.5 text-xs text-hearth-text-muted">{subtask.description}</p>
          )}
          {steps.length > 0 && !expanded && (
            <p className="mt-0.5 text-[10px] text-hearth-text-faint">
              {completedSteps}/{steps.length} steps
            </p>
          )}
        </div>
        {hasContent && (
          <svg
            className={`mt-0.5 h-4 w-4 shrink-0 text-hearth-text-faint transition-transform ${expanded ? 'rotate-90' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M7.21 14.77a.75.75 0 0 1 0-1.06L10.44 10 7.21 6.29a.75.75 0 1 1 1.08-1.04l3.75 4a.75.75 0 0 1 0 1.04l-3.75 4a.75.75 0 0 1-1.08 0Z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>

      {expanded && hasContent && (
        <div className="border-t border-hearth-border bg-hearth-bg/30 px-3 pb-3 pt-2">
          {/* Agent output */}
          {subtask.agentOutput && (
            <div className="mb-2">
              <p className="mb-1 text-[10px] font-medium text-hearth-text-faint">Output</p>
              <div className="max-h-40 overflow-auto rounded border border-hearth-border bg-hearth-card p-2 text-xs text-hearth-text whitespace-pre-wrap">
                {typeof (subtask.agentOutput as { result?: string }).result === 'string'
                  ? (subtask.agentOutput as { result: string }).result
                  : formatJson(subtask.agentOutput)}
              </div>
            </div>
          )}

          {/* Execution steps */}
          {steps.length > 0 && (
            <div className="space-y-0.5">
              <p className="mb-1 text-[10px] font-medium text-hearth-text-faint">
                Execution steps ({completedSteps}/{steps.length})
              </p>
              {steps.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskSubtasks({ subtasks, taskStatus, parentSteps, onReplan }: TaskSubtasksProps) {
  const [showReplan, setShowReplan] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPlanning = taskStatus === 'planning';
  const canReplan = taskStatus === 'planning' || taskStatus === 'executing';

  // Separate parent steps by phase
  const planningSteps = (parentSteps ?? []).filter((s) => s.phase === 'planning');
  const hasRunningPlanning = planningSteps.some((s) => s.status === 'running');

  const handleReplan = useCallback(async () => {
    const trimmed = feedback.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await onReplan(trimmed);
      setFeedback('');
      setShowReplan(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to replan');
    } finally {
      setSubmitting(false);
    }
  }, [feedback, onReplan]);

  return (
    <div>
      {/* Planning in-progress indicator */}
      {(isPlanning || hasRunningPlanning) && subtasks.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
          <p className="text-sm text-blue-700">Planning in progress — generating subtasks...</p>
        </div>
      )}

      {/* Subtask list with expandable execution */}
      {subtasks.length === 0 && !isPlanning && !hasRunningPlanning ? (
        <p className="py-4 text-center text-xs text-hearth-text-faint">No subtasks</p>
      ) : (
        <div className="space-y-2">
          {subtasks.map((sub, i) => (
            <SubtaskRow key={sub.id} subtask={sub} index={i} />
          ))}
        </div>
      )}

      {/* Replan action */}
      {canReplan && subtasks.length > 0 && !showReplan && (
        <button
          type="button"
          onClick={() => setShowReplan(true)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-hearth-border-strong py-2 text-xs text-hearth-text-muted hover:border-hearth-400 hover:text-hearth-600"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H4.598a.75.75 0 0 0-.75.75v3.634a.75.75 0 0 0 1.5 0v-2.033l.31.31A7 7 0 0 0 17.25 10a.75.75 0 0 0-1.5 0c0 .51-.06 1.006-.175 1.48l-.263-.056ZM4.688 8.576a5.5 5.5 0 0 1 9.201-2.466l.312.311h-2.433a.75.75 0 0 0 0 1.5h3.634a.75.75 0 0 0 .75-.75V3.537a.75.75 0 0 0-1.5 0V5.57l-.31-.31A7 7 0 0 0 2.75 10a.75.75 0 0 0 1.5 0c0-.51.06-1.006.175-1.48l.263.056Z"
              clipRule="evenodd"
            />
          </svg>
          Replan
        </button>
      )}

      {/* Replan form */}
      {showReplan && (
        <div className="mt-3 space-y-2 rounded-lg border border-blue-100 bg-blue-50/30 p-3">
          <label htmlFor="replan-feedback" className="block text-xs font-medium text-hearth-text">
            What should change?
          </label>
          <textarea
            id="replan-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            placeholder="e.g. break it into smaller steps, focus on the API first, skip the migration..."
            className="w-full rounded-md border border-hearth-border-strong bg-hearth-card px-2 py-1.5 text-sm focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={submitting || !feedback.trim()}
              onClick={handleReplan}
              className="rounded-md bg-hearth-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
            >
              {submitting ? 'Replanning...' : 'Replan'}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setShowReplan(false);
                setFeedback('');
                setError(null);
              }}
              className="rounded-md px-3 py-1.5 text-xs text-hearth-text-muted hover:bg-hearth-chip"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
