import { useState } from 'react';
import { useApprovals } from '@/hooks/use-approvals';

export function ApprovalInbox() {
  const { approvals, loading, fetchApprovals, resolveApproval } = useApprovals();
  const [resolving, setResolving] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  const handleResolve = async (id: string, decision: 'approved' | 'rejected') => {
    setResolving(id);
    try {
      await resolveApproval(id, decision, { comment: comment.trim() || undefined });
      setComment('');
      fetchApprovals();
    } finally {
      setResolving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-hearth-border border-t-hearth-600" />
      </div>
    );
  }

  if (approvals.length === 0) {
    return (
      <div className="py-8 text-center">
        <svg className="mx-auto h-10 w-10 text-hearth-text-faint" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
        </svg>
        <p className="mt-2 text-sm text-hearth-text-muted">No pending approvals</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {approvals.map((approval) => {
        const run = approval as unknown as {
          run?: { routine?: { name: string; userId: string } };
          checkpoint?: { name: string; description?: string };
        };
        const routineName = run.run?.routine?.name ?? 'Unknown routine';
        const checkpointName = run.checkpoint?.name ?? 'Checkpoint';

        return (
          <div key={approval.id} className="px-4 py-4">
            <div className="mb-2 flex items-start justify-between">
              <div>
                <h4 className="text-sm font-semibold text-hearth-text">{routineName}</h4>
                <p className="text-xs text-hearth-text-muted">Checkpoint: {checkpointName}</p>
                {run.checkpoint?.description && (
                  <p className="mt-0.5 text-xs text-hearth-text-faint">{run.checkpoint.description}</p>
                )}
              </div>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                Pending
              </span>
            </div>

            {/* Agent output preview */}
            {approval.agentOutput && (
              <div className="mb-3 rounded-lg border border-hearth-border bg-hearth-bg p-2.5">
                <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-hearth-text">
                  {approval.agentOutput.slice(0, 500)}
                  {approval.agentOutput.length > 500 && '...'}
                </pre>
              </div>
            )}

            {/* Comment */}
            <input
              type="text"
              placeholder="Optional comment..."
              value={resolving === approval.id ? comment : ''}
              onChange={(e) => setComment(e.target.value)}
              onFocus={() => setResolving(approval.id)}
              className="mb-2 w-full rounded border border-hearth-border px-2.5 py-1.5 text-xs focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
            />

            {/* Actions */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleResolve(approval.id, 'approved')}
                disabled={resolving === approval.id}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => handleResolve(approval.id, 'rejected')}
                disabled={resolving === approval.id}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
