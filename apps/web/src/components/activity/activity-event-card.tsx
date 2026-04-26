import { useState, useEffect, useCallback } from 'react';
import type { ActivityEvent } from '@hearth/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { ReactionPicker } from './reaction-picker';

export interface ActivityEventCardProps {
  event: ActivityEvent;
}

const ACTION_LABELS: Record<string, string> = {
  task_completed: 'completed a task',
  skill_published: 'published a skill',
  skill_install: 'installed a skill',
  routine_run: 'ran a routine',
  session_created: 'started a session',
};

const ACTION_COLORS: Record<string, string> = {
  task_completed: 'bg-green-100 text-green-700',
  skill_published: 'bg-purple-100 text-purple-700',
  skill_install: 'bg-blue-100 text-blue-700',
  routine_run: 'bg-yellow-100 text-yellow-700',
  session_created: 'bg-hearth-chip text-hearth-text-muted',
};

const ENTITY_ROUTE_MAP: Record<string, string> = {
  session: '/#/chat',
  task: '/#/workspace',
  skill: '/#/skills',
  routine: '/#/routines',
};

const ENTITY_PARAM_MAP: Record<string, string> = {
  session: 'sessionId',
  task: 'taskId',
  skill: 'skillId',
  routine: 'routineId',
};

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function useTimeAgo(date: string): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);
  return timeAgo(date);
}

function getEntityLink(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  const route = ENTITY_ROUTE_MAP[entityType];
  const param = ENTITY_PARAM_MAP[entityType];
  if (!route || !param) return null;
  return `${route}?${param}=${entityId}`;
}

function formatMetrics(event: ActivityEvent): string | null {
  const m = event.metrics;
  if (!m) return null;
  if (m.installCount != null && m.installCount > 0) return `Installed by ${m.installCount} users`;
  if (m.totalRuns != null && m.totalRuns > 0) return `Run ${m.totalRuns} times`;
  if (m.timeSavedMs != null && m.timeSavedMs > 0) {
    const mins = Math.round(m.timeSavedMs / 60000);
    return mins > 0 ? `~${mins}min execution time` : null;
  }
  return null;
}

export function ActivityEventCard({ event }: ActivityEventCardProps) {
  const { user } = useAuth();
  const relativeTime = useTimeAgo(event.createdAt);
  const label = ACTION_LABELS[event.action] ?? event.action.replace(/_/g, ' ');
  const colorClass = ACTION_COLORS[event.action] ?? 'bg-hearth-chip text-hearth-text-muted';
  const details = event.details ?? {};
  const entityName = (details.title ?? details.name ?? event.entityId ?? '') as string;
  const entityLink = getEntityLink(event.entityType, event.entityId);
  const metricsText = formatMetrics(event);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);

  const showInstallButton = event.action === 'skill_published' && event.entityId;

  const handleInstall = useCallback(async () => {
    if (!event.entityId || installing || installed) return;
    setInstalling(true);
    try {
      await api.post(`/skills/${event.entityId}/install`);
      setInstalled(true);
    } catch {
      // Install failed
    } finally {
      setInstalling(false);
    }
  }, [event.entityId, installing, installed]);

  const handleAddReaction = useCallback(async (emoji: string) => {
    try {
      await api.post(`/activity/${event.id}/reactions`, { emoji });
    } catch {
      // Reaction failed
    }
  }, [event.id]);

  const handleRemoveReaction = useCallback(async (emoji: string) => {
    try {
      await api.delete(`/activity/${event.id}/reactions/${emoji}`);
    } catch {
      // Reaction removal failed
    }
  }, [event.id]);

  return (
    <div className="flex items-start gap-3 rounded-lg border border-hearth-border bg-hearth-card p-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-hearth-chip text-sm font-medium text-hearth-text">
        {event.userName?.charAt(0).toUpperCase() ?? '?'}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-hearth-text">
          <span className="font-medium">{event.userName ?? 'System'}</span>{' '}
          {label}
          {entityName && (
            <>
              {' '}
              {entityLink ? (
                <a href={entityLink} className="font-medium text-hearth-600 hover:underline">
                  {entityName}
                </a>
              ) : (
                <span className="font-medium text-hearth-text">{entityName}</span>
              )}
            </>
          )}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${colorClass}`}>
            {event.action.replace(/_/g, ' ')}
          </span>
          <span className="text-xs text-hearth-text-faint">{relativeTime}</span>
          {metricsText && (
            <span className="text-xs text-hearth-text-faint">{metricsText}</span>
          )}
        </div>

        {/* Reactions + actions */}
        <div className="mt-2 flex items-center gap-2">
          {user && (
            <ReactionPicker
              reactions={event.reactions ?? []}
              currentUserId={user.id}
              onAdd={handleAddReaction}
              onRemove={handleRemoveReaction}
            />
          )}
          {showInstallButton && (
            <button
              type="button"
              onClick={handleInstall}
              disabled={installing || installed}
              className={`ml-auto rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                installed
                  ? 'bg-green-100 text-green-700'
                  : 'bg-hearth-100 text-hearth-700 hover:bg-hearth-200'
              } disabled:opacity-50`}
            >
              {installed ? 'Installed' : installing ? 'Installing...' : 'Install'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
