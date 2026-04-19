import { useState, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type {
  Routine, RoutineRun, CreateRoutineRequest, UpdateRoutineRequest,
  RoutineScope, RoutineChain, WebhookEndpoint,
} from '@hearth/shared';

export function useRoutines() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRoutines = useCallback(async (scope?: RoutineScope) => {
    setLoading(true);
    try {
      const query = scope ? `?scope=${scope}` : '';
      const res = await api.get<{ data: Routine[] }>(`/routines${query}`);
      setRoutines(res.data ?? []);
    } catch {
      setRoutines([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const createRoutine = useCallback(async (data: CreateRoutineRequest) => {
    const res = await api.post<{ data: Routine }>('/routines', data);
    return res.data;
  }, []);

  const updateRoutine = useCallback(async (id: string, data: UpdateRoutineRequest) => {
    const res = await api.patch<{ data: Routine }>(`/routines/${id}`, data);
    return res.data;
  }, []);

  const deleteRoutine = useCallback(async (id: string) => {
    await api.delete(`/routines/${id}`);
  }, []);

  const toggleRoutine = useCallback(async (id: string) => {
    const res = await api.post<{ data: Routine }>(`/routines/${id}/toggle`);
    return res.data;
  }, []);

  const runNow = useCallback(async (id: string, parameterValues?: Record<string, unknown>) => {
    await api.post(`/routines/${id}/run-now`, parameterValues ? { parameterValues } : {});
  }, []);

  const fetchRuns = useCallback(async (routineId: string, page = 1) => {
    const res = await api.get<{ data: RoutineRun[]; total: number }>(`/routines/${routineId}/runs?page=${page}`);
    return res;
  }, []);

  // Feature 1: State management
  const fetchState = useCallback(async (routineId: string) => {
    const res = await api.get<{ data: Record<string, unknown> }>(`/routines/${routineId}/state`);
    return res.data;
  }, []);

  const resetState = useCallback(async (routineId: string) => {
    await api.delete(`/routines/${routineId}/state`);
  }, []);

  // Feature 2: Webhook endpoints
  const fetchWebhookEndpoints = useCallback(async () => {
    const res = await api.get<{ data: WebhookEndpoint[] }>('/routines/webhook-endpoints');
    return res.data ?? [];
  }, []);

  const createWebhookEndpoint = useCallback(async (data: { provider: string; integrationId?: string }) => {
    const res = await api.post<{ data: WebhookEndpoint & { plainSecret: string } }>('/routines/webhook-endpoints', data);
    return res.data;
  }, []);

  // Feature 7: Chains
  const fetchChains = useCallback(async (routineId: string) => {
    const res = await api.get<{ data: { chainsFrom: RoutineChain[]; chainsTo: RoutineChain[] } }>(`/routines/${routineId}/chains`);
    return res.data;
  }, []);

  const createChain = useCallback(async (routineId: string, data: {
    targetRoutineId: string;
    condition?: string;
    parameterMapping?: Record<string, string>;
  }) => {
    const res = await api.post<{ data: RoutineChain }>(`/routines/${routineId}/chains`, data);
    return res.data;
  }, []);

  const deleteChain = useCallback(async (routineId: string, chainId: string) => {
    await api.delete(`/routines/${routineId}/chains/${chainId}`);
  }, []);

  return {
    routines, loading, fetchRoutines,
    createRoutine, updateRoutine, deleteRoutine,
    toggleRoutine, runNow, fetchRuns,
    fetchState, resetState,
    fetchWebhookEndpoints, createWebhookEndpoint,
    fetchChains, createChain, deleteChain,
  };
}
