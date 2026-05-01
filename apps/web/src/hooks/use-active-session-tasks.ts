import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api-client';
import { onTaskCreatedFromChat } from '@/lib/socket-client';
import type { ApiResponse } from '@hearth/shared';

interface ActiveTasks {
  count: number;
  firstTaskId: string | null;
}

/**
 * Tracks how many tasks promoted from this chat session are currently in
 * planning or executing. Polls every 15s when count > 0; refreshes
 * eagerly on `task:created_from_chat` socket events for the session.
 */
export function useActiveSessionTasks(sessionId: string | null): ActiveTasks {
  const [state, setState] = useState<ActiveTasks>({ count: 0, firstTaskId: null });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async (sid: string) => {
    try {
      const res = await api.get<ApiResponse<ActiveTasks>>(`/chat/sessions/${sid}/active-tasks`);
      if (res.data) setState(res.data);
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setState({ count: 0, firstTaskId: null });

    if (!sessionId) return;

    void refresh(sessionId);

    const unsub = onTaskCreatedFromChat((e) => {
      if (e.sessionId === sessionId) void refresh(sessionId);
    });

    // Poll while we know there are running tasks. The first refresh call
    // above will populate state; subsequent renders below the effect
    // boundary will start polling once count > 0 (handled in a separate
    // effect to avoid resetting the timer on every state change).

    return () => {
      unsub();
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [sessionId, refresh]);

  // Polling loop — runs only while count > 0.
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (!sessionId || state.count === 0) return;
    intervalRef.current = setInterval(() => void refresh(sessionId), 15_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [sessionId, state.count, refresh]);

  return state;
}
