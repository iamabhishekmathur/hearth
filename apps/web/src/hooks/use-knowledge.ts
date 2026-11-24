import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeProposal, OrgFeatureFlags } from '@hearth/shared';
import { api } from '@/lib/api-client';

// One fetch of the org's feature flags per page load, shared by every caller.
let featuresPromise: Promise<OrgFeatureFlags> | null = null;

function loadFeatures(): Promise<OrgFeatureFlags> {
  featuresPromise ??= api
    .get<{ data: OrgFeatureFlags }>('/chat/features')
    .then((res) => res.data ?? {})
    .catch(() => {
      featuresPromise = null; // retry on the next mount
      return {};
    });
  return featuresPromise;
}

/** Test hook: forget the cached flags. */
export function resetFeatureCache(): void {
  featuresPromise = null;
}

/** Whether the knowledge loop (curator + Review inbox) is on for the org. */
export function useKnowledgeLoopEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    loadFeatures().then((f) => {
      if (alive) setOn(f.knowledgeLoop === true);
    });
    return () => {
      alive = false;
    };
  }, []);
  return on;
}

export type ReviewState = 'loading' | 'ready' | 'off' | 'error';

/** The caller's pending curator proposals. */
export function useProposals() {
  const [proposals, setProposals] = useState<KnowledgeProposal[]>([]);
  const [state, setState] = useState<ReviewState>('loading');

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ data: KnowledgeProposal[] }>('/knowledge/proposals');
      setProposals(res.data ?? []);
      setState('ready');
    } catch (err) {
      // 404 = the feature is off for this org.
      setState((err as { status?: number }).status === 404 ? 'off' : 'error');
      setProposals([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const approve = useCallback(
    (id: string, body: { after?: string; baseVersion?: number } = {}) =>
      api.post<{ data: KnowledgeProposal }>(`/knowledge/proposals/${id}/approve`, body),
    [],
  );

  const reject = useCallback(
    (id: string, reason?: string) =>
      api.post<{ data: KnowledgeProposal }>(
        `/knowledge/proposals/${id}/reject`,
        reason ? { reason } : {},
      ),
    [],
  );

  const remove = useCallback((id: string) => {
    setProposals((list) => list.filter((p) => p.id !== id));
  }, []);

  return { proposals, state, refresh, approve, reject, remove };
}
