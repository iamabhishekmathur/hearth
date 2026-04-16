import { useState, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type { Routine, RoutineRun, CreateRoutineRequest, UpdateRoutineRequest } from '@hearth/shared';

export function useRoutines() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRoutines = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: Routine[] }>('/routines');
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

  const runNow = useCallback(async (id: string) => {
    await api.post(`/routines/${id}/run-now`);
  }, []);

  const fetchRuns = useCallback(async (routineId: string, page = 1) => {
    const res = await api.get<{ data: RoutineRun[]; total: number }>(`/routines/${routineId}/runs?page=${page}`);
    return res;
  }, []);

  return { routines, loading, fetchRoutines, createRoutine, updateRoutine, deleteRoutine, toggleRoutine, runNow, fetchRuns };
}
