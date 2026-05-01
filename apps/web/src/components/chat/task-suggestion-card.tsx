import { useState, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { HIcon } from '@/components/ui/icon';
import type { TaskSuggestionEvent, ApiResponse } from '@hearth/shared';

interface TaskSuggestionCardProps {
  suggestion: TaskSuggestionEvent;
  onLocalDismiss: () => void;
}

export function TaskSuggestionCard({ suggestion, onLocalDismiss }: TaskSuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(suggestion.proposedTitle);
  const [description, setDescription] = useState(suggestion.proposedDescription ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback(
    async (targetStatus: 'backlog' | 'planning') => {
      setSubmitting(true);
      setError(null);
      try {
        await api.post<ApiResponse<unknown>>(`/task-suggestions/${suggestion.id}/accept`, {
          title: title.trim() || suggestion.proposedTitle,
          description: description.trim() || undefined,
          targetStatus,
        });
        // Server emits task:created_from_chat → use-chat clears the suggestion.
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to accept');
        setSubmitting(false);
      }
    },
    [suggestion.id, suggestion.proposedTitle, title, description],
  );

  const dismiss = useCallback(async () => {
    onLocalDismiss(); // optimistic
    try {
      await api.post(`/task-suggestions/${suggestion.id}/dismiss`);
    } catch {
      // server will re-emit on reload if needed
    }
  }, [suggestion.id, onLocalDismiss]);

  return (
    <div className="mt-2 max-w-[480px] rounded-lg border border-hearth-border bg-hearth-card p-3 shadow-hearth-1 animate-fade-in">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--hearth-accent)' }}>
          <HIcon name="sparkle" size={11} color="var(--hearth-accent)" />
          Suggested task
        </div>
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="text-[10px] text-hearth-text-faint hover:text-hearth-text-muted"
        >
          {expanded ? 'Collapse' : 'Edit'}
        </button>
      </div>

      {expanded ? (
        <>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-2 w-full rounded-md border border-hearth-border-strong bg-hearth-bg px-2.5 py-1.5 text-[13px] font-medium text-hearth-text focus:border-hearth-accent focus:outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add notes for the agent (optional)…"
            rows={2}
            className="mt-2 w-full resize-none rounded-md border border-hearth-border-strong bg-hearth-bg px-2.5 py-1.5 text-[12.5px] text-hearth-text focus:border-hearth-accent focus:outline-none"
          />
        </>
      ) : (
        <p className="mt-2 truncate text-[13px] font-medium text-hearth-text">{title}</p>
      )}

      <p className="mt-1 text-[11px] text-hearth-text-faint">
        From this exchange · {suggestion.suggestedContextMessageIds.length} messages of context
      </p>

      {error && <p className="mt-1 text-[11px]" style={{ color: 'var(--hearth-err)' }}>{error}</p>}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={dismiss}
          disabled={submitting}
          className="rounded-md px-2.5 py-1 text-[12px] text-hearth-text-muted hover:bg-hearth-chip"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={() => void accept('planning')}
          disabled={submitting}
          className="rounded-md border border-hearth-border-strong px-2.5 py-1 text-[12px] text-hearth-text hover:bg-hearth-chip"
        >
          Run now
        </button>
        <button
          type="button"
          onClick={() => void accept('backlog')}
          disabled={submitting}
          className="rounded-md px-3 py-1 text-[12px] font-medium text-white"
          style={{ background: 'var(--hearth-accent)' }}
        >
          {submitting ? 'Adding…' : 'Add to backlog'}
        </button>
      </div>
    </div>
  );
}
