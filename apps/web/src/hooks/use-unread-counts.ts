import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api-client';
import type { ApiResponse } from '@hearth/shared';

export type UnreadCounts = Record<string, { unreadCount: number; lastReadMessageId: string | null }>;

/**
 * Polls and locally tracks the per-session unread badge counts for the
 * current user. Refreshes lazily — caller can also clear a single session
 * via `clearForSession`.
 */
export function useUnreadCounts(): {
  counts: UnreadCounts;
  refresh: () => Promise<void>;
  clearForSession: (sessionId: string) => void;
} {
  const [counts, setCounts] = useState<UnreadCounts>({});
  const inflightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    try {
      const res = await api.get<ApiResponse<UnreadCounts>>('/chat/sessions/unread-counts');
      if (res.data) setCounts(res.data);
    } catch {
      // best-effort
    } finally {
      inflightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clearForSession = useCallback((sessionId: string) => {
    setCounts((prev) => {
      if (!prev[sessionId] || prev[sessionId].unreadCount === 0) return prev;
      return { ...prev, [sessionId]: { ...prev[sessionId], unreadCount: 0 } };
    });
  }, []);

  return { counts, refresh, clearForSession };
}
