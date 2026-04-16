import { useState, useEffect, useCallback } from 'react';
import type { Routine, RoutineRun } from '@hearth/shared';
import { RoutineForm } from './routine-form';

interface RoutineDetailProps {
  routine: Routine;
  onUpdate: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
  onRunNow: (id: string) => Promise<void>;
  fetchRuns: (routineId: string, page?: number) => Promise<{ data: RoutineRun[]; total: number }>;
  onClose: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function RunStatusDot({ status }: { status: string }) {
  const color = status === 'success' ? 'bg-green-500' : status === 'failed' ? 'bg-red-500' : 'bg-yellow-500';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    success: 'bg-green-50 text-green-700 ring-green-600/20',
    failed: 'bg-red-50 text-red-700 ring-red-600/20',
    running: 'bg-yellow-50 text-yellow-700 ring-yellow-600/20',
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${styles[status] ?? 'bg-gray-50 text-gray-600 ring-gray-500/10'}`}>
      {status}
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatSchedule(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, , , dow] = parts;
  if (hour === '*') return `Every hour${min !== '0' ? ` at :${min.padStart(2, '0')}` : ''}`;
  const h = parseInt(hour, 10);
  const time = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
  if (dow === '1-5') return `Weekdays at ${time}`;
  if (dow === '*') return `Daily at ${time}`;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const d = parseInt(dow, 10);
  if (d >= 0 && d <= 6) return `${days[d]}s at ${time}`;
  return cron;
}

// ─── Run Detail Expanded View ───────────────────────────────────────────────

function RunDetail({ run, onClose }: { run: RoutineRun; onClose: () => void }) {
  const outputText =
    run.output && typeof run.output === 'object' && 'result' in run.output
      ? String((run.output as Record<string, unknown>).result)
      : run.output
        ? JSON.stringify(run.output, null, 2)
        : null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
          </svg>
          Back to history
        </button>
        <StatusBadge status={run.status} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* Metadata */}
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3">
          <div>
            <span className="text-xs font-medium text-gray-400">Started</span>
            <p className="text-sm text-gray-900">{new Date(run.startedAt).toLocaleString()}</p>
          </div>
          {run.completedAt && (
            <div>
              <span className="text-xs font-medium text-gray-400">Completed</span>
              <p className="text-sm text-gray-900">{new Date(run.completedAt).toLocaleString()}</p>
            </div>
          )}
          {run.durationMs != null && (
            <div>
              <span className="text-xs font-medium text-gray-400">Duration</span>
              <p className="text-sm text-gray-900">{formatDuration(run.durationMs)}</p>
            </div>
          )}
          {run.tokenCount != null && (
            <div>
              <span className="text-xs font-medium text-gray-400">Tokens</span>
              <p className="text-sm text-gray-900">{run.tokenCount.toLocaleString()}</p>
            </div>
          )}
        </div>

        {/* Error */}
        {run.error && (
          <div className="mb-4">
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-red-500">Error</h4>
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <pre className="whitespace-pre-wrap text-sm text-red-700">{run.error}</pre>
            </div>
          </div>
        )}

        {/* Output */}
        {outputText && (
          <div>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Output</h4>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="prose prose-sm max-w-none text-gray-800">
                <pre className="whitespace-pre-wrap text-sm leading-relaxed">{outputText}</pre>
              </div>
            </div>
          </div>
        )}

        {/* Empty output */}
        {!outputText && !run.error && run.status === 'success' && (
          <p className="text-sm text-gray-400">Run completed with no output.</p>
        )}
      </div>
    </div>
  );
}

// ─── Run History List ───────────────────────────────────────────────────────

function RunHistoryList({
  routineId,
  fetchRuns,
  onRunNow,
}: {
  routineId: string;
  fetchRuns: (routineId: string, page?: number) => Promise<{ data: RoutineRun[]; total: number }>;
  onRunNow: (id: string) => Promise<void>;
}) {
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<RoutineRun | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const pageSize = 20;

  const loadRuns = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetchRuns(routineId, p);
      setRuns(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, [routineId, fetchRuns]);

  useEffect(() => {
    loadRuns(page);
  }, [loadRuns, page]);

  // Reset page when routine changes
  useEffect(() => {
    setPage(1);
    setSelectedRun(null);
    setStatusFilter('all');
  }, [routineId]);

  // Show individual run detail
  if (selectedRun) {
    return <RunDetail run={selectedRun} onClose={() => setSelectedRun(null)} />;
  }

  const filteredRuns = statusFilter === 'all' ? runs : runs.filter((r) => r.status === statusFilter);
  const totalPages = Math.ceil(total / pageSize);

  const statusCounts = runs.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-2.5">
        <div className="flex items-center gap-1.5">
          {/* Filter pills */}
          {['all', 'success', 'failed', 'running'].map((s) => {
            const count = s === 'all' ? runs.length : (statusCounts[s] ?? 0);
            if (s !== 'all' && count === 0) return null;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)} {count > 0 && `(${count})`}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => loadRuns(page)}
          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Refresh"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H4.598a.75.75 0 0 0-.75.75v3.634a.75.75 0 0 0 1.5 0v-2.033l.312.312a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.391Zm-10.624-2.85a5.5 5.5 0 0 1 9.201-2.465l.312.311H11.77a.75.75 0 0 0 0 1.5h3.634a.75.75 0 0 0 .75-.75V3.536a.75.75 0 0 0-1.5 0v2.033l-.312-.312A7 7 0 0 0 2.63 8.395a.75.75 0 0 0 1.449.391l.009-.021Z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Run list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-hearth-600" />
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="py-12 text-center">
            <svg className="mx-auto h-10 w-10 text-gray-300" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clipRule="evenodd" />
            </svg>
            {statusFilter !== 'all' ? (
              <>
                <p className="mt-2 text-sm text-gray-500">No {statusFilter} runs</p>
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className="mt-1 text-xs text-hearth-600 hover:underline"
                >
                  Show all runs
                </button>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-gray-500">No runs yet</p>
                <p className="mt-0.5 text-xs text-gray-400">Runs will appear here after the routine executes.</p>
                <button
                  type="button"
                  onClick={() => onRunNow(routineId)}
                  className="mt-3 rounded-lg bg-hearth-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-hearth-700"
                >
                  Run Now
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredRuns.map((run) => {
              const outputPreview =
                run.output && typeof run.output === 'object' && 'result' in run.output
                  ? String((run.output as Record<string, unknown>).result).slice(0, 120)
                  : null;

              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedRun(run)}
                  className="group flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-gray-50"
                >
                  {/* Status indicator */}
                  <div className="mt-1.5 flex-shrink-0">
                    <RunStatusDot status={run.status} />
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium capitalize text-gray-900">{run.status}</span>
                        {run.durationMs != null && (
                          <span className="text-xs text-gray-400">{formatDuration(run.durationMs)}</span>
                        )}
                      </div>
                      <span className="flex-shrink-0 text-xs text-gray-400">
                        {formatRelativeTime(run.startedAt)}
                      </span>
                    </div>

                    {/* Error preview */}
                    {run.error && (
                      <p className="mt-0.5 truncate text-xs text-red-600">{run.error}</p>
                    )}

                    {/* Output preview */}
                    {outputPreview && !run.error && (
                      <p className="mt-0.5 truncate text-xs text-gray-500">{outputPreview}</p>
                    )}
                  </div>

                  {/* Chevron */}
                  <svg className="mt-1.5 h-4 w-4 flex-shrink-0 text-gray-300 group-hover:text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                  </svg>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-2.5">
          <p className="text-xs text-gray-500">
            {total} run{total !== 1 ? 's' : ''} total
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="px-2 text-xs text-gray-500">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function RoutineDetail({ routine, onUpdate, onDelete, onRunNow, fetchRuns, onClose }: RoutineDetailProps) {
  const [editing, setEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview');
  const [deleting, setDeleting] = useState(false);

  // Reset tab when routine changes
  useEffect(() => {
    setActiveTab('overview');
    setEditing(false);
  }, [routine.id]);

  if (editing) {
    return (
      <div className="p-5">
        <h3 className="mb-4 text-base font-semibold text-gray-900">Edit Routine</h3>
        <RoutineForm
          initial={{
            name: routine.name,
            description: routine.description ?? '',
            prompt: routine.prompt,
            schedule: routine.schedule,
          }}
          onSubmit={async (data) => {
            await onUpdate(routine.id, data);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          submitLabel="Save"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`flex h-2.5 w-2.5 rounded-full ${routine.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
            <h3 className="truncate text-base font-semibold text-gray-900">{routine.name}</h3>
          </div>
          {routine.description && (
            <p className="mt-0.5 truncate text-sm text-gray-500">{routine.description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-3 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close detail panel"
        >
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 px-5">
        {(['overview', 'history'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'border-hearth-600 text-hearth-600'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            {tab === 'history' ? 'Run History' : tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="space-y-5">
            {/* Prompt */}
            <div>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Prompt</h4>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="whitespace-pre-wrap text-sm text-gray-800">{routine.prompt}</p>
              </div>
            </div>

            {/* Metadata grid */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Schedule</h4>
                <p className="text-sm text-gray-900">{formatSchedule(routine.schedule)}</p>
                <p className="mt-0.5 font-mono text-xs text-gray-400">{routine.schedule}</p>
              </div>
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Status</h4>
                <span className={`inline-flex items-center gap-1.5 text-sm ${routine.enabled ? 'text-green-700' : 'text-gray-500'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${routine.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                  {routine.enabled ? 'Active' : 'Paused'}
                </span>
              </div>
              {routine.lastRunAt && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Last Run</h4>
                  <p className="text-sm text-gray-900">{new Date(routine.lastRunAt).toLocaleString()}</p>
                  <p className="text-xs text-gray-400">{formatRelativeTime(routine.lastRunAt)}</p>
                </div>
              )}
              {routine.lastRunStatus && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Last Result</h4>
                  <StatusBadge status={routine.lastRunStatus} />
                </div>
              )}
            </div>

            {/* Quick run history peek — last 3 */}
            {routine.runs && routine.runs.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Recent Runs</h4>
                  <button
                    type="button"
                    onClick={() => setActiveTab('history')}
                    className="text-xs text-hearth-600 hover:underline"
                  >
                    View all
                  </button>
                </div>
                <div className="space-y-1.5">
                  {routine.runs.slice(0, 3).map((run) => (
                    <div key={run.id} className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <RunStatusDot status={run.status} />
                        <span className="text-xs font-medium capitalize text-gray-700">{run.status}</span>
                        {run.durationMs != null && (
                          <span className="text-xs text-gray-400">{formatDuration(run.durationMs)}</span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">{formatRelativeTime(run.startedAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 border-t border-gray-100 pt-4">
              <button
                type="button"
                onClick={() => onRunNow(routine.id)}
                className="rounded-lg bg-hearth-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-hearth-700"
              >
                Run Now
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={async () => { setDeleting(true); await onDelete(routine.id); }}
                disabled={deleting}
                className="rounded-lg border border-red-200 px-3.5 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <RunHistoryList routineId={routine.id} fetchRuns={fetchRuns} onRunNow={onRunNow} />
      )}
    </div>
  );
}
