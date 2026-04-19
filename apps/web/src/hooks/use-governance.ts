import { useState, useEffect, useCallback } from 'react';
import { getSocket, connectSocket } from '@/lib/socket-client';
import { api } from '@/lib/api-client';
import type { GovernanceSettings } from '@hearth/shared';

interface GovernanceViolationEvent {
  violationId: string;
  userId: string;
  userName: string;
  policyName: string;
  severity: string;
  snippet: string;
}

/**
 * Hook for subscribing to real-time governance violation alerts (admin use).
 */
export function useGovernanceAlerts(orgId: string | null) {
  const [recentViolations, setRecentViolations] = useState<GovernanceViolationEvent[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!orgId) return;

    const socket = connectSocket();
    socket.emit('join:org', orgId);

    const handler = (event: GovernanceViolationEvent) => {
      setRecentViolations((prev) => [event, ...prev].slice(0, 20));
      setUnreadCount((prev) => prev + 1);
    };

    socket.on('governance:violation', handler);

    return () => {
      socket.off('governance:violation', handler);
    };
  }, [orgId]);

  const clearUnread = useCallback(() => setUnreadCount(0), []);

  return { recentViolations, unreadCount, clearUnread };
}

/**
 * Hook for fetching governance settings (used by chat components for monitoring banner).
 */
export function useGovernanceSettings(orgId: string | null) {
  const [settings, setSettings] = useState<GovernanceSettings | null>(null);

  useEffect(() => {
    if (!orgId) return;
    api
      .get<{ data: GovernanceSettings }>('/admin/governance/settings')
      .then((res) => setSettings(res.data))
      .catch(() => {
        // Non-admin users may get 403 — that's fine, means governance banner not shown
        setSettings(null);
      });
  }, [orgId]);

  return settings;
}

/**
 * Hook for listening to governance:warning and governance:blocked events on a session.
 */
export function useGovernanceSessionEvents(sessionId: string | null) {
  const [warnings, setWarnings] = useState<Map<string, string>>(new Map());
  const [blocked, setBlocked] = useState<Map<string, { policyName: string; reason: string }>>(new Map());

  useEffect(() => {
    if (!sessionId) return;

    const socket = getSocket();

    const onWarning = (event: { messageId: string; policyName: string; reason: string }) => {
      setWarnings((prev) => new Map(prev).set(event.messageId, event.reason));
    };

    const onBlocked = (event: { messageId: string; policyName: string; severity: string; reason: string }) => {
      setBlocked((prev) =>
        new Map(prev).set(event.messageId, { policyName: event.policyName, reason: event.reason }),
      );
    };

    socket.on('governance:warning', onWarning);
    socket.on('governance:blocked', onBlocked);

    return () => {
      socket.off('governance:warning', onWarning);
      socket.off('governance:blocked', onBlocked);
    };
  }, [sessionId]);

  return { warnings, blocked };
}
