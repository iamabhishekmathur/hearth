import { useState } from 'react';
import type { Task, TaskReview, ReviewDecision } from '@hearth/shared';

interface TaskReviewProps {
  task: Task;
  reviews: TaskReview[];
  onSubmit: (decision: ReviewDecision, feedback?: string) => Promise<unknown>;
  onCancel: () => Promise<unknown> | void;
}

export function TaskReviewPanel({ task, reviews, onSubmit, onCancel }: TaskReviewProps) {
  const [feedback, setFeedback] = useState('');
  const [mode, setMode] = useState<'idle' | 'changes' | 'cancel'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canReview = task.status === 'review';

  async function handleApprove() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit('approved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRequestChanges() {
    const trimmed = feedback.trim();
    if (!trimmed) {
      setError('Feedback is required to request changes. Tell the planner what to adjust.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit('changes_requested', trimmed);
      setFeedback('');
      setMode('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    setSubmitting(true);
    setError(null);
    try {
      await onCancel();
      setMode('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Agent output — what the reviewer is evaluating */}
      {task.agentOutput ? (
        <div>
          <h4 className="mb-1 text-xs font-medium text-gray-500">Agent output</h4>
          <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
            {typeof (task.agentOutput as { result?: string }).result === 'string'
              ? (task.agentOutput as { result: string }).result
              : JSON.stringify(task.agentOutput, null, 2)}
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-500">No agent output available yet.</p>
      )}

      {/* Review actions — only when task is in review */}
      {canReview && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <svg className="h-4 w-4 text-amber-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7 4a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-1-9a1 1 0 0 0-1 1v4a1 1 0 1 0 2 0V6a1 1 0 0 0-1-1Z" clipRule="evenodd" />
            </svg>
            <h4 className="text-sm font-medium text-amber-900">Your review</h4>
          </div>

          {mode === 'idle' && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={handleApprove}
                className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                Approve & complete
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setMode('changes')}
                className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50"
              >
                Request changes
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setMode('cancel')}
                className="ml-auto rounded-md px-3 py-1.5 text-xs text-gray-500 hover:text-red-600"
              >
                Cancel task
              </button>
            </div>
          )}

          {mode === 'changes' && (
            <div className="space-y-2">
              <label htmlFor="review-feedback" className="block text-xs font-medium text-gray-700">
                What should the planner adjust?
              </label>
              <textarea
                id="review-feedback"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={4}
                placeholder="Be specific — this feedback is fed to the planning agent."
                className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={submitting || !feedback.trim()}
                  onClick={handleRequestChanges}
                  className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {submitting ? 'Sending…' : 'Send back to planning'}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => { setMode('idle'); setFeedback(''); setError(null); }}
                  className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {mode === 'cancel' && (
            <div className="space-y-2">
              <p className="text-sm text-gray-700">
                Cancel this task? It will move to <strong>archived</strong> and stop here.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleCancel}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {submitting ? 'Cancelling…' : 'Yes, cancel'}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => { setMode('idle'); setError(null); }}
                  className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
                >
                  Keep reviewing
                </button>
              </div>
            </div>
          )}

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
      )}

      {/* Review history */}
      {reviews.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium text-gray-500">Review history</h4>
          <ul className="space-y-2">
            {reviews.map((r) => (
              <li key={r.id} className="rounded border border-gray-200 bg-white p-2 text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                      r.decision === 'approved'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {r.decision === 'approved' ? 'Approved' : 'Changes requested'}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                </div>
                {r.feedback && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{r.feedback}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
