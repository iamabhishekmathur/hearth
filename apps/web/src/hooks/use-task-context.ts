import { useState, useCallback, useEffect } from 'react';
import { api } from '@/lib/api-client';
import type { TaskContextItem } from '@hearth/shared';
import { io, type Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL || '';

export function useTaskContext(taskId: string | null) {
  const [items, setItems] = useState<TaskContextItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchItems = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const res = await api.get<{ data: TaskContextItem[] }>(`/tasks/${taskId}/context-items`);
      setItems(res.data ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (taskId) fetchItems();
    else setItems([]);
  }, [taskId, fetchItems]);

  // Subscribe to real-time context item events
  useEffect(() => {
    if (!taskId) return;

    const socket: Socket = io(WS_URL, { path: '/ws', withCredentials: true });

    socket.on('connect', () => {
      socket.emit('join:task', taskId);
    });

    socket.on('task:event', (event: Record<string, unknown>) => {
      if (event.type === 'task:context_item_added' && event.item) {
        setItems((prev) => [...prev, event.item as TaskContextItem]);
      }
      if (event.type === 'task:context_item_updated' && event.item) {
        const updated = event.item as TaskContextItem;
        setItems((prev) =>
          prev.map((i) => (i.id === updated.id ? updated : i)),
        );
      }
      if (event.type === 'task:context_item_removed' && event.itemId) {
        setItems((prev) => prev.filter((i) => i.id !== event.itemId));
      }
    });

    return () => {
      socket.emit('leave:task', taskId);
      socket.disconnect();
    };
  }, [taskId]);

  const addNote = useCallback(
    async (text: string) => {
      if (!taskId) return;
      const res = await api.post<{ data: TaskContextItem }>(`/tasks/${taskId}/context-items`, {
        type: 'note',
        rawValue: text,
      });
      return res.data;
    },
    [taskId],
  );

  const addLink = useCallback(
    async (url: string) => {
      if (!taskId) return;
      const res = await api.post<{ data: TaskContextItem }>(`/tasks/${taskId}/context-items`, {
        type: 'link',
        rawValue: url,
        label: url,
      });
      return res.data;
    },
    [taskId],
  );

  const addTextBlock = useCallback(
    async (text: string, label?: string) => {
      if (!taskId) return;
      const res = await api.post<{ data: TaskContextItem }>(`/tasks/${taskId}/context-items`, {
        type: 'text_block',
        rawValue: text,
        label,
      });
      return res.data;
    },
    [taskId],
  );

  const addMcpReference = useCallback(
    async (integrationId: string, resourceType: string, resourceId: string, label?: string) => {
      if (!taskId) return;
      const res = await api.post<{ data: TaskContextItem }>(`/tasks/${taskId}/context-items`, {
        type: 'mcp_reference',
        rawValue: `${resourceType}:${resourceId}`,
        label,
        mcpIntegrationId: integrationId,
        mcpResourceType: resourceType,
        mcpResourceId: resourceId,
      });
      return res.data;
    },
    [taskId],
  );

  const uploadContextFile = useCallback(
    async (file: File) => {
      if (!taskId) return;

      const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';
      const formData = new FormData();
      formData.append('file', file);

      const headers: Record<string, string> = {};
      const csrfMatch = document.cookie.match(/(?:^|;\s*)hearth\.csrf=([^;]+)/);
      if (csrfMatch) {
        headers['x-csrf-token'] = decodeURIComponent(csrfMatch[1]);
      }

      const res = await fetch(`${BASE_URL}/tasks/${taskId}/context-items/upload`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: formData,
      });

      if (!res.ok) return null;
      const body = (await res.json()) as { data: TaskContextItem };
      return body.data;
    },
    [taskId],
  );

  const updateItem = useCallback(
    async (itemId: string, patch: { label?: string; sortOrder?: number }) => {
      if (!taskId) return;
      const res = await api.patch<{ data: TaskContextItem }>(
        `/tasks/${taskId}/context-items/${itemId}`,
        patch,
      );
      return res.data;
    },
    [taskId],
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      if (!taskId) return;
      await api.delete(`/tasks/${taskId}/context-items/${itemId}`);
    },
    [taskId],
  );

  const refreshItem = useCallback(
    async (itemId: string) => {
      if (!taskId) return;
      await api.post(`/tasks/${taskId}/context-items/${itemId}/refresh`);
    },
    [taskId],
  );

  const analyzeImage = useCallback(
    async (itemId: string) => {
      if (!taskId) return;
      await api.post(`/tasks/${taskId}/context-items/${itemId}/analyze`);
    },
    [taskId],
  );

  return {
    items,
    loading,
    fetchItems,
    addNote,
    addLink,
    addTextBlock,
    addMcpReference,
    uploadContextFile,
    updateItem,
    removeItem,
    refreshItem,
    analyzeImage,
  };
}
