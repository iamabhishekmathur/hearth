import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { io, type Socket } from 'socket.io-client';
import type { ActivityEvent } from '@hearth/shared';
import { ActivityEventCard } from '@/components/activity/activity-event-card';

const WS_URL = import.meta.env.VITE_WS_URL || '';

type ActionFilter = '' | 'task_completed' | 'skill_published' | 'skill_install' | 'routine_run' | 'session_created';

export function ActivityPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState<ActionFilter>('');
  const socketRef = useRef<Socket | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (actionFilter) params.set('action', actionFilter);
      const res = await api.get<{ data: ActivityEvent[] }>(`/activity?${params}`);
      setEvents(res.data ?? []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [actionFilter]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Real-time updates via WebSocket
  useEffect(() => {
    if (!user?.orgId) return;

    const socket = io(WS_URL, { path: '/ws', withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join:org', user.orgId);
    });

    socket.on('activity:event', (event: ActivityEvent) => {
      setEvents((prev) => [event, ...prev]);
    });

    return () => {
      if (user.orgId) socket.emit('leave:org', user.orgId);
      socket.disconnect();
    };
  }, [user?.orgId]);

  const filters: { value: ActionFilter; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'task_completed', label: 'Tasks' },
    { value: 'skill_published', label: 'Skills' },
    { value: 'routine_run', label: 'Routines' },
    { value: 'session_created', label: 'Sessions' },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Activity</h1>
          <p className="mt-0.5 text-sm text-gray-500">Real-time org activity across sessions, skills, and tasks</p>
        </div>
      </div>

      {/* Filters */}
      <div className="border-b border-gray-200 px-6 py-3">
        <div role="group" aria-label="Filter activity" className="flex gap-2">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setActionFilter(f.value)}
              aria-pressed={actionFilter === f.value}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                actionFilter === f.value
                  ? 'bg-hearth-100 text-hearth-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-hearth-600" />
            <p className="mt-3 text-sm text-gray-400">Loading activity...</p>
          </div>
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-hearth-50">
              <svg className="h-8 w-8 text-hearth-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M12.577 4.878a.75.75 0 0 1 .919-.53l4.78 1.281a.75.75 0 0 1 .531.919l-1.281 4.78a.75.75 0 0 1-1.449-.387l.81-3.022a19.407 19.407 0 0 0-5.594 5.203.75.75 0 0 1-1.139.093L7 10.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06l5.25-5.25a.75.75 0 0 1 1.06 0l3.074 3.073a20.923 20.923 0 0 1 5.545-4.931l-3.042.815a.75.75 0 0 1-.53-.919Z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">No activity yet</h2>
            <p className="mt-1 max-w-sm text-sm text-gray-500">
              Activity will appear here as your team uses Hearth — completing tasks, installing skills, running routines, and more.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-3xl space-y-2">
            {events.map((event) => (
              <ActivityEventCard key={event.id} event={event} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
