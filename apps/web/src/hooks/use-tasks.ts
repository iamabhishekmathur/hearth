import { useState, useCallback, useEffect, useRef } from 'react';
import { api } from '@/lib/api-client';
import type {
  Task,
  TaskStatus,
  TaskSource,
  TaskComment,
  TaskReview,
  TaskExecutionStep,
  ReviewDecision,
} from '@hearth/shared';
import { io, type Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL || '';

interface PaginatedTasks {
  data: Task[];
  total: number;
  page: number;
  pageSize: number;
}

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchTasks = useCallback(async (status?: TaskStatus) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      params.set('parentOnly', 'true');
      const res = await api.get<PaginatedTasks>(`/tasks?${params}`);
      setTasks(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch {
      // API error (401, network) — show empty state
      setTasks([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  const createTask = useCallback(async (data: { title: string; description?: string; source: TaskSource }) => {
    const res = await api.post<{ data: Task }>('/tasks', data);
    return res.data;
  }, []);

  const updateTask = useCallback(async (id: string, data: { title?: string; description?: string; status?: TaskStatus; priority?: number }) => {
    const res = await api.patch<{ data: Task }>(`/tasks/${id}`, data);
    return res.data;
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    await api.delete(`/tasks/${id}`);
  }, []);

  const addContext = useCallback(async (id: string, note: string) => {
    // Merge a free-form note into task.context under a notes[] array so
    // multiple additions accumulate rather than overwriting.
    const timestamp = new Date().toISOString();
    await api.post(`/tasks/${id}/context`, {
      [`note_${timestamp}`]: note,
    });
  }, []);

  return {
    tasks,
    total,
    loading,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    addContext,
  };
}

export function useTaskDetail(taskId: string | null) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const fetchTask = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await api.get<{ data: Task }>(`/tasks/${id}`);
      setTask(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (taskId) fetchTask(taskId);
    else setTask(null);
  }, [taskId, fetchTask]);

  // Subscribe to real-time task events
  useEffect(() => {
    if (!taskId) return;

    const socket = io(WS_URL, { path: '/ws', withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join:task', taskId);
    });

    socket.on('task:event', (event: Record<string, unknown>) => {
      if (event.type === 'task:updated' && event.task) {
        setTask(event.task as Task);
      }
      if (event.type === 'task:comment') {
        setTask((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            comments: [...(prev.comments ?? []), event.comment as TaskComment],
          };
        });
      }
      if (event.type === 'task:step' && event.step) {
        const step = event.step as TaskExecutionStep;
        setTask((prev) => {
          if (!prev) return prev;
          const existing = prev.executionSteps ?? [];
          const idx = existing.findIndex((s) => s.id === step.id);
          const next = idx >= 0
            ? existing.map((s, i) => (i === idx ? step : s))
            : [...existing, step];
          return { ...prev, executionSteps: next };
        });
      }
      if (event.type === 'task:subtask' && event.subtask) {
        setTask((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            subTasks: [...(prev.subTasks ?? []), event.subtask as Task],
          };
        });
      }
      if (event.type === 'task:review' && event.review) {
        setTask((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            reviews: [...(prev.reviews ?? []), event.review as TaskReview],
          };
        });
      }
    });

    return () => {
      socket.emit('leave:task', taskId);
      socket.disconnect();
    };
  }, [taskId]);

  const updateTask = useCallback(async (data: { title?: string; description?: string; priority?: number }) => {
    if (!taskId) return;
    const res = await api.patch<{ data: Task }>(`/tasks/${taskId}`, data);
    setTask(res.data);
    return res.data;
  }, [taskId]);

  const addComment = useCallback(async (content: string) => {
    if (!taskId) return;
    await api.post(`/tasks/${taskId}/comments`, { content });
  }, [taskId]);

  const addSubtask = useCallback(async (title: string, description?: string) => {
    if (!taskId) return;
    const res = await api.post<{ data: Task }>(`/tasks/${taskId}/subtasks`, { title, description });
    return res.data;
  }, [taskId]);

  const updateContext = useCallback(async (patch: Record<string, unknown>) => {
    if (!taskId) return;
    const res = await api.post<{ data: Task }>(`/tasks/${taskId}/context`, patch);
    setTask(res.data);
    return res.data;
  }, [taskId]);

  const submitReview = useCallback(
    async (decision: ReviewDecision, feedback?: string) => {
      if (!taskId) return;
      const res = await api.post<{ data: TaskReview }>(`/tasks/${taskId}/reviews`, {
        decision,
        feedback,
      });
      return res.data;
    },
    [taskId],
  );

  const replan = useCallback(
    async (feedback?: string) => {
      if (!taskId) return;
      await api.post(`/tasks/${taskId}/replan`, { feedback });
    },
    [taskId],
  );

  return { task, loading, fetchTask, updateTask, addComment, addSubtask, updateContext, submitReview, replan };
}
