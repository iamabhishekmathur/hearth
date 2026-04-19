import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type {
  Decision,
  DecisionPattern,
  OrgPrinciple,
  CreateDecisionRequest,
  DecisionSearchRequest,
} from '@hearth/shared';

export function useDecisions(opts?: {
  domain?: string;
  status?: string;
  limit?: number;
}) {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const fetchDecisions = useCallback(async (nextCursor?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (opts?.domain) params.set('domain', opts.domain);
      if (opts?.status) params.set('status', opts.status);
      if (opts?.limit) params.set('limit', String(opts.limit));
      if (nextCursor) params.set('cursor', nextCursor);

      const res = await api.get<{
        data: Decision[];
        cursor: string | null;
        hasMore: boolean;
      }>(`/decisions?${params.toString()}`);
      if (nextCursor) {
        setDecisions(prev => [...prev, ...res.data]);
      } else {
        setDecisions(res.data);
      }
      setCursor(res.cursor);
      setHasMore(res.hasMore);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [opts?.domain, opts?.status, opts?.limit]);

  useEffect(() => {
    fetchDecisions();
  }, [fetchDecisions]);

  const loadMore = useCallback(() => {
    if (cursor && hasMore) fetchDecisions(cursor);
  }, [cursor, hasMore, fetchDecisions]);

  const createDecision = useCallback(async (data: CreateDecisionRequest) => {
    const res = await api.post<{ data: Decision }>('/decisions', data);
    setDecisions(prev => [res.data, ...prev]);
    return res.data;
  }, []);

  const searchDecisions = useCallback(async (req: DecisionSearchRequest) => {
    const res = await api.post<{ decisions: Decision[]; total: number }>('/decisions/search', req);
    return res;
  }, []);

  return { decisions, loading, hasMore, loadMore, createDecision, searchDecisions, refresh: () => fetchDecisions() };
}

export function useDecision(decisionId: string | null) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!decisionId) {
      setDecision(null);
      return;
    }
    setLoading(true);
    api.get<{ data: Decision }>(`/decisions/${decisionId}`)
      .then(res => setDecision(res.data))
      .catch(() => setDecision(null))
      .finally(() => setLoading(false));
  }, [decisionId]);

  return { decision, loading };
}

export function usePatterns(domain?: string) {
  const [patterns, setPatterns] = useState<DecisionPattern[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = domain ? `?domain=${domain}` : '';
    api.get<{ data: DecisionPattern[] }>(`/decisions/patterns${params}`)
      .then(res => setPatterns(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [domain]);

  return { patterns, loading };
}

export function usePrinciples(domain?: string) {
  const [principles, setPrinciples] = useState<OrgPrinciple[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = domain ? `?domain=${domain}` : '';
    api.get<{ data: OrgPrinciple[] }>(`/decisions/principles${params}`)
      .then(res => setPrinciples(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [domain]);

  return { principles, loading };
}

export function usePendingReview() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(() => {
    setLoading(true);
    api.get<{ data: Decision[] }>('/decisions/pending-review')
      .then(res => setDecisions(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const confirm = useCallback(async (id: string) => {
    await api.post(`/decisions/${id}/confirm`, {});
    setDecisions(prev => prev.filter(d => d.id !== id));
  }, []);

  const dismiss = useCallback(async (id: string) => {
    await api.post(`/decisions/${id}/dismiss`, {});
    setDecisions(prev => prev.filter(d => d.id !== id));
  }, []);

  return { decisions, loading, confirm, dismiss, refresh: fetch };
}
