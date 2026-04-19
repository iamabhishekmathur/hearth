import { useState, useCallback, useEffect } from 'react';
import { api } from '@/lib/api-client';
import type { ApprovalRequest } from '@hearth/shared';

export function useApprovals() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: ApprovalRequest[] }>('/approvals');
      setApprovals(res.data ?? []);
    } catch {
      setApprovals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const resolveApproval = useCallback(async (id: string, decision: 'approved' | 'rejected' | 'edited', opts?: {
    comment?: string;
    editedOutput?: string;
  }) => {
    const res = await api.post<{ data: ApprovalRequest }>(`/approvals/${id}/resolve`, {
      decision,
      ...opts,
    });
    return res.data;
  }, []);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  return { approvals, loading, fetchApprovals, resolveApproval };
}
