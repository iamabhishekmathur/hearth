import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type { ChatSession, ApiResponse } from '@hearth/shared';

interface SharedSession extends ChatSession {
  user?: { id: string; name: string };
}

interface UseSessionsReturn {
  sessions: ChatSession[];
  sharedSessions: SharedSession[];
  loading: boolean;
  error: string | null;
  createSession: (title?: string) => Promise<ChatSession>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
}

export function useSessions(): UseSessionsReturn {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sharedSessions, setSharedSessions] = useState<SharedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSessions = useCallback(async () => {
    try {
      setError(null);
      const [ownRes, sharedRes] = await Promise.all([
        api.get<ApiResponse<ChatSession[]>>('/chat/sessions'),
        api.get<ApiResponse<SharedSession[]>>('/chat/sessions/shared').catch(() => ({ data: [] as SharedSession[] })),
      ]);
      if (ownRes.data) {
        setSessions(ownRes.data);
      }
      if (sharedRes.data) {
        setSharedSessions(sharedRes.data);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load sessions';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const createSession = useCallback(
    async (title?: string): Promise<ChatSession> => {
      const res = await api.post<ApiResponse<ChatSession>>('/chat/sessions', {
        title,
      });
      if (!res.data) throw new Error('Failed to create session');
      setSessions((prev) => [res.data!, ...prev]);
      return res.data;
    },
    [],
  );

  const renameSession = useCallback(async (id: string, title: string): Promise<void> => {
    const res = await api.patch<ApiResponse<ChatSession>>(`/chat/sessions/${id}`, { title });
    if (!res.data) throw new Error('Failed to rename session');
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
  }, []);

  const deleteSession = useCallback(async (id: string): Promise<void> => {
    await api.delete(`/chat/sessions/${id}`);
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  return {
    sessions,
    sharedSessions,
    loading,
    error,
    createSession,
    renameSession,
    deleteSession,
    refreshSessions,
  };
}
