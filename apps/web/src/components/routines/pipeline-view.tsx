import type { PipelineRun } from '@hearth/shared';

interface PipelineViewProps {
  pipeline: PipelineRun;
  routineNames?: Record<string, string>;
}

const STATUS_STYLES: Record<string, string> = {
  running: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  completed: 'bg-green-100 text-green-800 border-green-200',
  failed: 'bg-red-100 text-red-800 border-red-200',
  partial: 'bg-orange-100 text-orange-800 border-orange-200',
};

export function PipelineView({ pipeline, routineNames }: PipelineViewProps) {
  return (
    <div className="rounded-lg border border-hearth-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-hearth-text">Pipeline Run</h4>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[pipeline.status] ?? 'bg-hearth-chip text-hearth-text border-hearth-border'}`}>
          {pipeline.status}
        </span>
      </div>

      {/* Visual pipeline steps */}
      <div className="flex items-center gap-1">
        {pipeline.runIds.map((runId, i) => (
          <div key={runId} className="flex items-center">
            {i > 0 && (
              <svg className="mx-1 h-4 w-4 text-hearth-text-faint" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            )}
            <div className="rounded bg-hearth-chip px-2 py-1 text-xs text-hearth-text-muted">
              {routineNames?.[runId] ?? runId.slice(0, 8)}
            </div>
          </div>
        ))}
      </div>

      {/* Timing */}
      <div className="mt-2 flex gap-4 text-xs text-hearth-text-faint">
        <span>Started: {new Date(pipeline.startedAt).toLocaleTimeString()}</span>
        {pipeline.completedAt && (
          <span>Completed: {new Date(pipeline.completedAt).toLocaleTimeString()}</span>
        )}
      </div>
    </div>
  );
}
