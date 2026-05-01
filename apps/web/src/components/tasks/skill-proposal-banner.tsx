import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

interface SkillProposal {
  id: string;
  name: string;
  description: string | null;
  status: string;
}

interface SkillProposalBannerProps {
  taskId: string;
}

export function SkillProposalBanner({ taskId }: SkillProposalBannerProps) {
  const [proposals, setProposals] = useState<SkillProposal[]>([]);
  const [dismissed, setDismissed] = useState(false);

  const fetchProposals = useCallback(async () => {
    try {
      const res = await api.get<{ data: SkillProposal[] }>(`/skills/proposals?taskId=${taskId}`);
      setProposals(res.data ?? []);
    } catch {
      // Silently ignore
    }
  }, [taskId]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  if (dismissed || proposals.length === 0) return null;

  const proposal = proposals[0];

  const handleSubmitForReview = async () => {
    try {
      await api.post(`/skills/${proposal.id}/submit-for-review`);
      fetchProposals();
    } catch {
      // Handle error
    }
  };

  const handleDismiss = async () => {
    try {
      await api.delete(`/skills/${proposal.id}/proposal`);
      setDismissed(true);
    } catch {
      // Handle error
    }
  };

  return (
    <div role="alert" aria-label="Skill proposal" className="mb-4 rounded-lg border border-hearth-200 bg-hearth-50 p-3 animate-fade-in">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-hearth-100">
          <svg className="h-4 w-4 text-hearth-600" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 1a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 1ZM5.05 3.05a.75.75 0 0 1 1.06 0l1.062 1.06A.75.75 0 1 1 6.11 5.173L5.05 4.11a.75.75 0 0 1 0-1.06ZM14.95 3.05a.75.75 0 0 1 0 1.06l-1.06 1.062a.75.75 0 0 1-1.062-1.061l1.061-1.06a.75.75 0 0 1 1.06 0Z" />
            <path fillRule="evenodd" d="M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-hearth-800">Skill Proposal: {proposal.name}</p>
          <p className="mt-0.5 text-xs text-hearth-600">{proposal.description}</p>
          {proposal.status === 'draft' && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={handleSubmitForReview}
                className="rounded bg-hearth-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-hearth-700"
              >
                Submit for Review
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                className="rounded border border-hearth-border-strong px-2.5 py-1 text-xs font-medium text-hearth-text-muted hover:bg-hearth-bg"
              >
                Dismiss
              </button>
            </div>
          )}
          {proposal.status === 'pending_review' && (
            <p className="mt-1 text-xs text-amber-600">Submitted for review</p>
          )}
        </div>
      </div>
    </div>
  );
}
