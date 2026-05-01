import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { HIcon } from '@/components/ui/icon';
import type { ApiResponse } from '@hearth/shared';

export interface TaskComposerSubmit {
  task: { id: string; title: string; status: string };
  existing: boolean;
  messageCount: number;
}

interface TaskComposerProps {
  sessionId: string;
  /** The chat message this task is anchored on. */
  anchorMessageId: string;
  /** Provenance for analytics — which entry point invoked this composer. */
  provenance: 'chat_button' | 'chat_slash' | 'agent_propose_accepted';
  /** Initial title (e.g. pre-filled by Haiku synthesis). Empty = let user type. */
  initialTitle?: string;
  initialDescription?: string;
  /** Default attached-context size. Default: 4 messages back from the anchor. */
  initialAttachRecentN?: number;
  onSubmit: (result: TaskComposerSubmit) => void;
  onCancel: () => void;
}

type TargetStatus = 'backlog' | 'planning';

export function TaskComposer({
  sessionId,
  anchorMessageId,
  provenance,
  initialTitle = '',
  initialDescription = '',
  initialAttachRecentN = 4,
  onSubmit,
  onCancel,
}: TaskComposerProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [attachRecentN, setAttachRecentN] = useState(initialAttachRecentN);
  const [targetStatus, setTargetStatus] = useState<TargetStatus>('backlog');
  const [priority, setPriority] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  const submit = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Title is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post<ApiResponse<TaskComposerSubmit['task'] & { existing: boolean; messageCount: number }>>(
        `/chat/sessions/${sessionId}/messages/${anchorMessageId}/promote-to-task`,
        {
          title: trimmed,
          description: description.trim() || undefined,
          attachRecentN,
          targetStatus,
          priority,
          provenance,
        },
      );
      if (!res.data) throw new Error('No data returned');
      onSubmit({
        task: { id: res.data.id, title: res.data.title, status: res.data.status },
        existing: res.data.existing,
        messageCount: res.data.messageCount,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
      setSubmitting(false);
    }
  }, [title, description, attachRecentN, targetStatus, priority, sessionId, anchorMessageId, provenance, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void submit();
      }
    },
    [submit, onCancel],
  );

  return (
    <div
      className="w-[380px] rounded-lg border border-hearth-border bg-hearth-card p-3 shadow-hearth-3 animate-scale-in"
      onKeyDown={handleKeyDown}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-hearth-text-faint">Create task</span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-0.5 text-hearth-text-faint hover:bg-hearth-chip hover:text-hearth-text-muted"
          aria-label="Cancel"
        >
          <HIcon name="x" size={12} />
        </button>
      </div>

      <input
        ref={titleRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title…"
        className="w-full rounded-md border border-hearth-border-strong bg-hearth-bg px-2.5 py-1.5 text-[13px] font-medium text-hearth-text placeholder:text-hearth-text-faint focus:border-hearth-accent focus:outline-none"
      />

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Add notes for the agent (optional)…"
        rows={2}
        className="mt-2 w-full resize-none rounded-md border border-hearth-border-strong bg-hearth-bg px-2.5 py-1.5 text-[12.5px] text-hearth-text placeholder:text-hearth-text-faint focus:border-hearth-accent focus:outline-none"
      />

      <div className="mt-2 flex items-center justify-between text-[11px] text-hearth-text-muted">
        <span>Attach context</span>
        <div className="flex items-center gap-1">
          {[0, 1, 4, 8].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setAttachRecentN(n)}
              className={`rounded-pill px-2 py-0.5 text-[10px] font-medium transition-colors ${
                attachRecentN === n
                  ? 'bg-hearth-accent-soft text-hearth-accent'
                  : 'text-hearth-text-faint hover:bg-hearth-chip'
              }`}
            >
              {n === 0 ? 'None' : `${n} msg${n > 1 ? 's' : ''}`}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-hearth-text-muted">
        <span>Priority</span>
        <div className="flex items-center gap-1">
          {([0, 1, 2, 3] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              className={`rounded-pill px-2 py-0.5 text-[10px] font-medium transition-colors ${
                priority === p
                  ? 'bg-hearth-accent-soft text-hearth-accent'
                  : 'text-hearth-text-faint hover:bg-hearth-chip'
              }`}
            >
              P{p}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-md bg-hearth-bg p-1">
        {(['backlog', 'planning'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setTargetStatus(s)}
            className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
              targetStatus === s
                ? 'bg-hearth-card text-hearth-text shadow-hearth-1'
                : 'text-hearth-text-muted hover:text-hearth-text'
            }`}
          >
            {s === 'backlog' ? 'Backlog' : 'Run now'}
          </button>
        ))}
      </div>

      {error && <p className="mt-2 text-[11px]" style={{ color: 'var(--hearth-err)' }}>{error}</p>}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-md px-2.5 py-1 text-[12px] text-hearth-text-muted hover:bg-hearth-chip"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || !title.trim()}
          className="rounded-md px-3 py-1 text-[12px] font-medium text-white transition-opacity disabled:opacity-50"
          style={{ background: 'var(--hearth-accent)' }}
        >
          {submitting ? 'Creating…' : targetStatus === 'planning' ? 'Run now' : 'Create task'}
        </button>
      </div>
    </div>
  );
}
