import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

/** Mirrors `ChatGPTPlanStatus` from apps/api/src/services/chatgpt-plan-service.ts. */
export interface ChatGPTPlanStatus {
  enabled: boolean;
  mode: 'hosted' | 'open_source';
  connected: boolean;
  status?: 'active' | 'needs_reauth' | 'plan_unavailable' | string;
  accountEmail?: string | null;
  useForChat?: boolean;
  defaultModel?: string | null;
  welcomeAcknowledged?: boolean;
  lastUsageLimitAt?: string | null;
  manageUsageUrl: string;
  helpUrl: string;
}

export interface ChatGPTPlanModel {
  id: string;
  displayName: string;
}

// One status shared by every consumer (settings tab, composer indicator,
// usage-limit notice) so a toggle in one place updates the others.
let cached: ChatGPTPlanStatus | null = null;
let inflight: Promise<ChatGPTPlanStatus | null> | null = null;
const listeners = new Set<(s: ChatGPTPlanStatus | null) => void>();

function publish(s: ChatGPTPlanStatus | null) {
  cached = s;
  for (const l of listeners) l(s);
}

async function fetchStatus(): Promise<ChatGPTPlanStatus | null> {
  if (!inflight) {
    inflight = api
      .get<{ data: ChatGPTPlanStatus }>('/me/chatgpt-plan')
      .then((r) => {
        publish(r.data);
        return r.data;
      })
      .catch(() => {
        publish(null);
        return null;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useChatGPTPlan() {
  const [status, setStatus] = useState<ChatGPTPlanStatus | null>(cached);
  const [loading, setLoading] = useState(cached === null);

  useEffect(() => {
    listeners.add(setStatus);
    if (cached === null) fetchStatus().finally(() => setLoading(false));
    else setLoading(false);
    return () => {
      listeners.delete(setStatus);
    };
  }, []);

  const refresh = useCallback(() => fetchStatus(), []);

  /** Start the OAuth flow (navigates this tab to ChatGPT; the callback returns to Settings). */
  const connect = useCallback(async () => {
    const res = await api.post<{ data: { url: string } }>('/auth/chatgpt/start');
    window.location.assign(res.data.url);
  }, []);

  const update = useCallback(
    async (patch: {
      useForChat?: boolean;
      defaultModel?: string | null;
      acknowledgeWelcome?: true;
    }) => {
      const res = await api.patch<{ data: ChatGPTPlanStatus }>('/me/chatgpt-plan', patch);
      publish(res.data);
      return res.data;
    },
    [],
  );

  const disconnect = useCallback(async () => {
    const res = await api.delete<{ data: ChatGPTPlanStatus }>('/me/chatgpt-plan');
    publish(res.data);
  }, []);

  const listModels = useCallback(
    () => api.get<{ data: ChatGPTPlanModel[] }>('/me/chatgpt-plan/models').then((r) => r.data),
    [],
  );

  /** Plan routing is in effect for this user's chats. */
  const active = !!status?.enabled && !!status.connected && !!status.useForChat;

  return { status, loading, active, refresh, connect, update, disconnect, listModels };
}
