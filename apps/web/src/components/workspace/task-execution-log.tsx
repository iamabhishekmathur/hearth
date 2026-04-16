import { useState } from 'react';
import type { TaskExecutionStep } from '@hearth/shared';

const STATUS_ICONS: Record<string, { icon: string; color: string }> = {
  pending: { icon: '○', color: 'text-gray-400' },
  running: { icon: '●', color: 'text-blue-500' },
  completed: { icon: '✓', color: 'text-green-500' },
  failed: { icon: '✗', color: 'text-red-500' },
  paused: { icon: '⏸', color: 'text-yellow-500' },
};

const PHASE_STYLES: Record<string, string> = {
  planning: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  execution: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
};

interface TaskExecutionLogProps {
  steps: TaskExecutionStep[];
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
  const [expanded, setExpanded] = useState(step.status === 'running');
  const statusConfig = STATUS_ICONS[step.status] ?? STATUS_ICONS.pending;
  const hasDetails = step.input != null || step.output != null;

  return (
    <div role="listitem" className="rounded-lg border border-gray-100">
      <button
        type="button"
        onClick={() => hasDetails && setExpanded((v) => !v)}
        className={`flex w-full items-start gap-3 p-3 text-left ${
          hasDetails ? 'hover:bg-gray-50' : 'cursor-default'
        }`}
        aria-expanded={hasDetails ? expanded : undefined}
      >
        <span
          className={`mt-0.5 text-sm ${statusConfig.color} ${
            step.status === 'running' ? 'animate-pulse' : ''
          }`}
          aria-label={step.status}
        >
          {statusConfig.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-900">
            <span className="mr-1 text-xs text-gray-400">#{step.stepNumber}</span>
            {step.description}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {step.phase && (
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                  PHASE_STYLES[step.phase] ?? 'bg-gray-100 text-gray-600'
                }`}
              >
                {step.phase}
              </span>
            )}
            {step.toolUsed && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                {step.toolUsed}
              </span>
            )}
            {step.durationMs != null && (
              <span className="text-xs text-gray-400">{step.durationMs}ms</span>
            )}
            <span className="text-xs text-gray-400">{step.status}</span>
          </div>
        </div>
        {hasDetails && (
          <svg
            className={`mt-0.5 h-4 w-4 text-gray-400 transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
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
        <div className="space-y-2 border-t border-gray-100 bg-gray-50/50 p-3">
          {step.input != null && (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">Input</p>
              <pre className="max-h-40 overflow-auto rounded border border-gray-200 bg-white p-2 text-xs text-gray-700">
                {formatJson(step.input)}
              </pre>
            </div>
          )}
          {step.output != null && (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">Output</p>
              <pre className="max-h-60 overflow-auto rounded border border-gray-200 bg-white p-2 text-xs text-gray-700">
                {formatJson(step.output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskExecutionLog({ steps }: TaskExecutionLogProps) {
  if (steps.length === 0) {
    return (
      <p className="text-center text-xs text-gray-400 py-4">
        No execution steps yet
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {steps.map((step) => (
        <StepRow key={step.id} step={step} />
      ))}
    </div>
  );
}
