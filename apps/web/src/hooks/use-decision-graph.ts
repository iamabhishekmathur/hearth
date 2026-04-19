import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import type { DecisionGraphResponse } from '@hearth/shared';

export function useDecisionGraph(decisionId: string | null, depth: number = 2) {
  const [graph, setGraph] = useState<DecisionGraphResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!decisionId) {
      setGraph(null);
      return;
    }
    setLoading(true);
    api.get<{ data: DecisionGraphResponse }>(`/decisions/${decisionId}/graph?depth=${depth}`)
      .then(res => setGraph(res.data))
      .catch(() => setGraph(null))
      .finally(() => setLoading(false));
  }, [decisionId, depth]);

  return { graph, loading };
}
