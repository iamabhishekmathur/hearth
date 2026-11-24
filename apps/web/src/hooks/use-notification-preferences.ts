import { useCallback, useEffect, useState } from 'react';
import type { NotificationPreferences, NotificationPreferencesResponse } from '@hearth/shared';
import { api } from '@/lib/api-client';

/** The caller's notification switches, and whether the knowledge loop is on. */
export function useNotificationPreferences() {
  const [data, setData] = useState<NotificationPreferencesResponse | null>(null);
  const [saving, setSaving] = useState<keyof NotificationPreferences | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<{ data: NotificationPreferencesResponse }>('/notifications/preferences')
      .then((res) => {
        if (alive) setData(res.data ?? null);
      })
      .catch(() => {
        if (alive) setData(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const set = useCallback(async (key: keyof NotificationPreferences, value: boolean) => {
    setSaving(key);
    setError(false);
    // Optimistic: flip now, roll back on failure.
    setData((d) => (d ? { ...d, prefs: { ...d.prefs, [key]: value } } : d));
    try {
      const res = await api.put<{ data: NotificationPreferencesResponse }>(
        '/notifications/preferences',
        { [key]: value },
      );
      if (res.data) setData(res.data);
    } catch {
      setError(true);
      setData((d) => (d ? { ...d, prefs: { ...d.prefs, [key]: !value } } : d));
    } finally {
      setSaving(null);
    }
  }, []);

  return { data, saving, error, set };
}
