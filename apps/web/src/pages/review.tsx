import { useProposals } from '@/hooks/use-knowledge';
import { ProposalCard } from '@/components/knowledge/proposal-card';

/**
 * Knowledge loop, Phase 2 — the owners' Review inbox. Lists the curator's
 * proposed changes to the memory and routines the viewer owns.
 */
export function ReviewPage() {
  const { proposals, state, approve, reject, remove } = useProposals();

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-hearth-border px-4 py-4 sm:px-6">
        <h1 className="font-display text-xl font-medium text-hearth-text">Review</h1>
        <p className="mt-0.5 text-sm text-hearth-text-muted">
          Changes the curator suggests to memory and routines you own. Nothing changes until you
          approve.
        </p>
      </div>

      <div className="mx-auto w-full max-w-[920px] flex-1 px-4 py-5 sm:px-6">
        {state === 'loading' && <p className="text-sm text-hearth-text-faint">Loading…</p>}
        {state === 'off' && (
          <p className="text-sm text-hearth-text-muted">
            Review is not turned on for your organization.
          </p>
        )}
        {state === 'error' && (
          <p role="alert" className="text-sm text-hearth-err">
            Could not load proposals. Try again in a moment.
          </p>
        )}
        {state === 'ready' && proposals.length === 0 && (
          <div className="animate-fade-in rounded-lg border border-dashed border-hearth-border-strong p-6 text-center">
            <p className="text-sm font-medium text-hearth-text">Nothing to review</p>
            <p className="mt-1 text-xs text-hearth-text-muted">
              The curator runs every night. New proposals show up here.
            </p>
          </div>
        )}
        {state === 'ready' && proposals.length > 0 && (
          <div className="space-y-4">
            {proposals.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                onApprove={approve}
                onReject={reject}
                onDone={remove}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
