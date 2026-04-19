import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { connectSocket } from '@/lib/socket-client';
import { FEED_WORTHY_ACTIONS, type ActivityEvent, type FeedAction, type CursorPaginatedResponse, type ProactiveSignal } from '@hearth/shared';
import { ActivityEventCard } from '@/components/activity/activity-event-card';
import { ActivityEventGroup } from '@/components/activity/activity-event-group';
import { ProactiveSignalCard } from '@/components/activity/proactive-signal-card';

const ACTION_LABEL_MAP: Record<FeedAction, string> = {
  task_completed: 'Tasks',
  skill_published: 'Skills',
  skill_install: 'Installs',
  routine_run: 'Routines',
  session_created: 'Sessions',
  governance_violation: 'Governance',
  decision_captured: 'Decisions',
};

const filterOptions: { value: FeedAction | ''; label: string }[] = [
  { value: '', label: 'All' },
  ...FEED_WORTHY_ACTIONS.map((a) => ({ value: a, label: ACTION_LABEL_MAP[a] })),
];

// ── Time bucket grouping ──

type TimeBucket = 'Today' | 'Yesterday' | 'This Week' | 'Older';

function getTimeBucket(date: string): TimeBucket {
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (d.toDateString() === now.toDateString()) return 'Today';
  if (diffDays === 1 || (diffDays === 0 && d.getDate() !== now.getDate())) return 'Yesterday';
  if (diffDays < 7) return 'This Week';
  return 'Older';
}

interface BucketSection {
  label: TimeBucket;
  items: Array<{ type: 'single'; event: ActivityEvent } | { type: 'group'; action: string; events: ActivityEvent[] }>;
}

function groupEvents(events: ActivityEvent[]): BucketSection[] {
  // Bucket events by time
  const bucketMap = new Map<TimeBucket, ActivityEvent[]>();
  for (const event of events) {
    const bucket = getTimeBucket(event.createdAt);
    if (!bucketMap.has(bucket)) bucketMap.set(bucket, []);
    bucketMap.get(bucket)!.push(event);
  }

  const order: TimeBucket[] = ['Today', 'Yesterday', 'This Week', 'Older'];
  const sections: BucketSection[] = [];

  for (const label of order) {
    const bucketEvents = bucketMap.get(label);
    if (!bucketEvents || bucketEvents.length === 0) continue;

    // Within each bucket, group by action if 3+ events share the same action
    const actionCounts = new Map<string, ActivityEvent[]>();
    for (const e of bucketEvents) {
      if (!actionCounts.has(e.action)) actionCounts.set(e.action, []);
      actionCounts.get(e.action)!.push(e);
    }

    const items: BucketSection['items'] = [];
    const grouped = new Set<string>();

    for (const [action, actionEvents] of actionCounts) {
      if (actionEvents.length >= 3) {
        items.push({ type: 'group', action, events: actionEvents });
        for (const e of actionEvents) grouped.add(e.id);
      }
    }

    // Add ungrouped events as singles, maintaining original order
    for (const e of bucketEvents) {
      if (!grouped.has(e.id)) {
        items.push({ type: 'single', event: e });
      }
    }

    sections.push({ label, items });
  }

  return sections;
}

export function ActivityPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionFilter, setActionFilter] = useState<FeedAction | ''>('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [signals, setSignals] = useState<ProactiveSignal[]>([]);
  const [dismissedSignals, setDismissedSignals] = useState<Set<string>>(new Set());

  const filterRef = useRef<FeedAction | ''>(actionFilter);
  useEffect(() => { filterRef.current = actionFilter; }, [actionFilter]);

  const lastEventTimeRef = useRef<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const fetchEvents = useCallback(async (loadMore = false) => {
    if (loadMore) setLoadingMore(true);
    else setLoading(true);

    try {
      const params = new URLSearchParams();
      if (actionFilter) params.set('action', actionFilter);
      if (loadMore && cursor) params.set('cursor', cursor);
      const res = await api.get<CursorPaginatedResponse<ActivityEvent>>(`/activity?${params}`);
      const data = res.data ?? [];

      if (loadMore) {
        setEvents((prev) => {
          const newEvents = data.filter((e) => !seenIdsRef.current.has(e.id));
          for (const e of newEvents) seenIdsRef.current.add(e.id);
          return [...prev, ...newEvents];
        });
      } else {
        seenIdsRef.current = new Set(data.map((e) => e.id));
        setEvents(data);
        if (data.length > 0) {
          lastEventTimeRef.current = data[0].createdAt;
        }
      }
      setCursor(res.cursor ?? null);
      setHasMore(res.hasMore ?? false);
    } catch {
      if (!loadMore) setEvents([]);
    } finally {
      if (loadMore) setLoadingMore(false);
      else setLoading(false);
    }
  }, [actionFilter, cursor]);

  // Fetch proactive signals
  useEffect(() => {
    api.get<{ data: ProactiveSignal[] }>('/activity/signals')
      .then((res) => setSignals(res.data ?? []))
      .catch(() => {});
  }, []);

  // Initial fetch + refetch on filter change
  useEffect(() => {
    setCursor(null);
    setHasMore(false);
    fetchEvents(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter]);

  const handleLoadMore = useCallback(() => {
    if (!loadingMore && hasMore) fetchEvents(true);
  }, [loadingMore, hasMore, fetchEvents]);

  const handleDismissSignal = useCallback((id: string) => {
    setDismissedSignals((prev) => new Set([...prev, id]));
  }, []);

  // Real-time updates via shared socket with reconnect catch-up
  useEffect(() => {
    if (!user?.orgId) return;

    const socket = connectSocket();
    socket.emit('join:org', user.orgId);

    const handleEvent = (event: ActivityEvent) => {
      if (filterRef.current && event.action !== filterRef.current) return;
      if (seenIdsRef.current.has(event.id)) return;
      seenIdsRef.current.add(event.id);
      lastEventTimeRef.current = event.createdAt;
      setEvents((prev) => [event, ...prev]);
    };

    socket.on('activity:event', handleEvent);

    const handleReconnect = async () => {
      socket.emit('join:org', user.orgId);
      if (lastEventTimeRef.current) {
        try {
          const params = new URLSearchParams();
          params.set('since', lastEventTimeRef.current);
          if (filterRef.current) params.set('action', filterRef.current);
          const res = await api.get<CursorPaginatedResponse<ActivityEvent>>(`/activity?${params}`);
          const missed = (res.data ?? []).filter((e) => !seenIdsRef.current.has(e.id));
          if (missed.length > 0) {
            for (const e of missed) seenIdsRef.current.add(e.id);
            setEvents((prev) => [...missed, ...prev]);
            lastEventTimeRef.current = missed[0].createdAt;
          }
        } catch {
          // Catch-up failed
        }
      }
    };

    socket.io.on('reconnect', handleReconnect);

    const handleReaction = (payload: { auditLogId: string; emoji: string; userId: string; userName: string; added: boolean }) => {
      setEvents((prev) =>
        prev.map((e) => {
          if (e.id !== payload.auditLogId) return e;
          const reactions = [...(e.reactions ?? [])];
          if (payload.added) {
            const existing = reactions.find((r) => r.emoji === payload.emoji);
            if (existing) {
              existing.count += 1;
              if (!existing.userIds.includes(payload.userId)) existing.userIds.push(payload.userId);
            } else {
              reactions.push({ emoji: payload.emoji, count: 1, userIds: [payload.userId] });
            }
          } else {
            const existing = reactions.find((r) => r.emoji === payload.emoji);
            if (existing) {
              existing.count = Math.max(0, existing.count - 1);
              existing.userIds = existing.userIds.filter((id) => id !== payload.userId);
            }
          }
          return { ...e, reactions: reactions.filter((r) => r.count > 0) };
        }),
      );
    };

    socket.on('activity:reaction', handleReaction);

    return () => {
      socket.off('activity:event', handleEvent);
      socket.off('activity:reaction', handleReaction);
      socket.io.off('reconnect', handleReconnect);
      if (user.orgId) socket.emit('leave:org', user.orgId);
    };
  }, [user?.orgId]);

  const grouped = useMemo(() => groupEvents(events), [events]);
  const visibleSignals = signals.filter((s) => !dismissedSignals.has(s.id)).slice(0, 3);

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
          {filterOptions.map((f) => (
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
      ) : events.length === 0 && visibleSignals.length === 0 ? (
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
          <div className="mx-auto max-w-3xl space-y-4">
            {/* Proactive signals */}
            {visibleSignals.length > 0 && (
              <div className="space-y-2">
                {visibleSignals.map((signal) => (
                  <ProactiveSignalCard
                    key={signal.id}
                    signal={signal}
                    onDismiss={() => handleDismissSignal(signal.id)}
                  />
                ))}
              </div>
            )}

            {/* Grouped timeline */}
            {grouped.map((section) => (
              <div key={section.label}>
                <div className="sticky top-0 z-10 bg-gray-50/95 px-2 py-1.5 backdrop-blur-sm">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {section.label}
                  </h3>
                </div>
                <div className="space-y-2">
                  {section.items.map((item) =>
                    item.type === 'group' ? (
                      <ActivityEventGroup
                        key={`group-${item.action}-${item.events[0].id}`}
                        action={item.action}
                        events={item.events}
                      />
                    ) : (
                      <ActivityEventCard key={item.event.id} event={item.event} />
                    ),
                  )}
                </div>
              </div>
            ))}

            {hasMore && (
              <div className="flex justify-center py-4">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  {loadingMore ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
