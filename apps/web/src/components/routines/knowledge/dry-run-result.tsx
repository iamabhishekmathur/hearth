import type { RoutineDryRun } from '@hearth/shared';
import { HBadge } from '@/components/ui/primitives';

/** The new output next to the last run's output. Stacks on narrow screens. */
export function DryRunResult({ run }: { run: RoutineDryRun }) {
  if (run.status === 'running') {
    return (
      <p className="text-sm text-hearth-text-muted" role="status" aria-live="polite">
        Running… This can take a minute.
      </p>
    );
  }
  if (run.status === 'failed') {
    return (
      <p role="alert" className="text-sm text-red-600">
        The dry run failed: {run.error ?? 'unknown error'}
      </p>
    );
  }
  return (
    <div className="animate-fade-in space-y-2" role="status" aria-live="polite">
      <div className="grid gap-3 sm:grid-cols-2">
        <section aria-label="Last run output" className="min-w-0">
          <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-hearth-text-faint">
            Last run
            {run.sourceRun && run.sourceRun.status !== 'success' && (
              <span className="ml-1 normal-case">({run.sourceRun.status})</span>
            )}
          </h5>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-hearth-border bg-hearth-bg p-2 text-xs text-hearth-text-muted">
            {run.lastOutput ?? run.sourceRun?.error ?? 'No output.'}
          </pre>
        </section>
        <section aria-label="Dry run output" className="min-w-0">
          <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-hearth-text-faint">
            Dry run{run.candidatePrompt ? ' (your draft)' : ''}
          </h5>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-hearth-border bg-hearth-card p-2 text-xs text-hearth-text">
            {run.output || 'No output.'}
          </pre>
        </section>
      </div>
      {run.blockedTools.length > 0 && (
        <p className="text-xs text-hearth-text-faint">
          Nothing was sent. Held back: {run.blockedTools.join(', ')}.
        </p>
      )}
      {run.testResults && (
        <ul className="space-y-1" aria-label="Test results">
          {run.testResults.map((r) => (
            <li key={r.testCaseId} className="flex flex-wrap items-center gap-2 text-xs">
              <HBadge tone={r.passed ? 'ok' : 'err'}>{r.passed ? 'Pass' : 'Fail'}</HBadge>
              <span className="text-hearth-text">{r.description}</span>
              {!r.passed && (
                <span className="text-hearth-text-muted">
                  Missing: {r.missing.map((m) => `"${m}"`).join(', ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
