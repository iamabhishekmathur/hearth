import { useState, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type { RoutineAnalytics, RoutineHealthAlert } from '@hearth/shared';

export function useRoutineAnalytics() {
  const [analytics, setAnalytics] = useState<RoutineAnalytics[]>([]);
  const [alerts, setAlerts] = useState<RoutineHealthAlert[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAnalytics = useCallback(async (opts?: { from?: string; to?: string }) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (opts?.from) params.set('from', opts.from);
      if (opts?.to) params.set('to', opts.to);
      const query = params.toString() ? `?${params.toString()}` : '';
      const res = await api.get<{ data: RoutineAnalytics[] }>(`/admin/routines/analytics${query}`);
      setAnalytics(res.data ?? []);
    } catch {
      setAnalytics([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await api.get<{ data: RoutineHealthAlert[] }>('/admin/routines/alerts');
      setAlerts(res.data ?? []);
    } catch {
      setAlerts([]);
    }
  }, []);

  const createAlert = useCallback(async (data: {
    routineId: string;
    alertType: string;
    threshold: Record<string, unknown>;
  }) => {
    const res = await api.post<{ data: RoutineHealthAlert }>('/admin/routines/alerts', data);
    return res.data;
  }, []);

  const deleteAlert = useCallback(async (id: string) => {
    await api.delete(`/admin/routines/alerts/${id}`);
  }, []);

  return { analytics, alerts, loading, fetchAnalytics, fetchAlerts, createAlert, deleteAlert };
}
