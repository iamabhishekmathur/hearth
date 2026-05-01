import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api-client';
import { connectSocket, onNotification } from '@/lib/socket-client';
import type { ApiResponse, NotificationItem } from '@hearth/shared';

interface ListResponse {
  items: NotificationItem[];
  unreadCount: number;
}

export function useNotifications(): {
  items: NotificationItem[];
  unreadCount: number;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
} {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const res = await api.get<ApiResponse<ListResponse>>('/notifications?limit=30');
      if (res.data) {
        setItems(res.data.items);
        setUnreadCount(res.data.unreadCount);
      }
    } catch {
      // ignore
    } finally {
      inflight.current = false;
    }
  }, []);

  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await api.post(`/notifications/${id}/read`);
    } catch {
      void refresh();
    }
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await api.post('/notifications/read-all');
    } catch {
      void refresh();
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
    connectSocket();
    const unsub = onNotification((n) => {
      setItems((prev) => [n, ...prev].slice(0, 50));
      if (!n.readAt) setUnreadCount((c) => c + 1);
    });
    return () => { unsub(); };
  }, [refresh]);

  return { items, unreadCount, refresh, markRead, markAllRead };
}
