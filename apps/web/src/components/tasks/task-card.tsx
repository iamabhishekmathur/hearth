import { useEffect, useRef, useState } from 'react';
import type { Task } from '@hearth/shared';

const SOURCE_LABELS: Record<string, string> = {
  email: 'Email',
  slack: 'Slack',
  meeting: 'Meeting',
  manual: 'Manual',
  agent_proposed: 'Agent',
  sub_agent: 'Sub-agent',
};

/** Statuses where the card is editable inline (title, description, priority) */
const EDITABLE_STATUSES = new Set<Task['status']>(['auto_detected', 'backlog']);

interface TaskCardProps {
  task: Task;
  onClick: () => void;
  onUpdate?: (
    id: string,
    patch: { title?: string; description?: string; priority?: number },
  ) => Promise<void> | void;
  onAddContext?: (id: string, note: string) => Promise<void> | void;
}

export function TaskCard({ task, onClick, onUpdate, onAddContext }: TaskCardProps) {
  const editable = EDITABLE_STATUSES.has(task.status);

  const [editing, setEditing] = useState<'title' | 'description' | null>(null);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [contextOpen, setContextOpen] = useState(false);
  const [contextNote, setContextNote] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  // Keep local state in sync when the parent task changes (e.g. WS updates)
  useEffect(() => {
    if (editing !== 'title') setTitle(task.title);
    if (editing !== 'description') setDescription(task.description ?? '');
  }, [task.title, task.description, editing]);

  useEffect(() => {
    if (editing === 'title') titleRef.current?.focus();
    if (editing === 'description') descRef.current?.focus();
  }, [editing]);

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  async function commitTitle() {
    const next = title.trim();
    setEditing(null);
    if (!next || next === task.title) return;
    await onUpdate?.(task.id, { title: next });
  }

  async function commitDescription() {
    const next = description.trim();
    setEditing(null);
    if (next === (task.description ?? '')) return;
    await onUpdate?.(task.id, { description: next });
  }

  async function cyclePriority(e: React.MouseEvent) {
    e.stopPropagation();
    if (!editable) return;
    const next = (task.priority + 1) % 4; // 0..3
    await onUpdate?.(task.id, { priority: next });
  }

  async function submitContext(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const note = contextNote.trim();
    if (!note) return;
    await onAddContext?.(task.id, note);
    setContextNote('');
    setContextOpen(false);
  }

  const subtaskCount = task.subTasks?.length ?? 0;

  return (
    <div
      role="listitem"
      tabIndex={0}
      aria-label={`Task: ${task.title}, source: ${SOURCE_LABELS[task.source] ?? task.source}, priority: ${task.priority}`}
      draggable
      onDragStart={handleDragStart}
      onClick={(e) => {
        // Don't open detail panel when clicking inputs/buttons inside the card
        const target = e.target as HTMLElement;
        if (target.closest('input, textarea, button, form')) return;
        onClick();
      }}
      onKeyDown={(e) => {
        if (editing) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="cursor-pointer rounded-lg bg-hearth-card p-3 shadow-hearth-1 ring-1 ring-hearth-border transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-hearth-accent animate-fade-in"
    >
      {/* Title — editable in auto_detected/backlog, read-only otherwise */}
      {editing === 'title' ? (
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitTitle(); }
            if (e.key === 'Escape') { setTitle(task.title); setEditing(null); }
          }}
          className="w-full rounded border border-hearth-400 bg-hearth-card px-1 py-0.5 text-sm font-medium text-hearth-text focus:outline-none focus:ring-1 focus:ring-hearth-accent"
          aria-label="Edit task title"
        />
      ) : (
        <p
          className={`text-sm font-medium text-hearth-text ${editable ? 'cursor-text hover:bg-hearth-bg rounded px-1 -mx-1' : ''}`}
          onClick={(e) => { if (editable) { e.stopPropagation(); setEditing('title'); } }}
        >
          {task.title}
        </p>
      )}

      {/* Description — editable in auto_detected/backlog, read-only otherwise */}
      {editing === 'description' ? (
        <textarea
          ref={descRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commitDescription}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitDescription(); }
            if (e.key === 'Escape') { setDescription(task.description ?? ''); setEditing(null); }
          }}
          rows={3}
          className="mt-1 w-full rounded border border-hearth-400 bg-hearth-card px-1 py-0.5 text-xs text-hearth-text focus:outline-none focus:ring-1 focus:ring-hearth-accent"
          aria-label="Edit task description"
          placeholder="Add a description…"
        />
      ) : task.description ? (
        <p
          className={`mt-1 line-clamp-2 text-xs text-hearth-text-muted ${editable ? 'cursor-text hover:bg-hearth-bg rounded px-1 -mx-1' : ''}`}
          onClick={(e) => { if (editable) { e.stopPropagation(); setEditing('description'); } }}
        >
          {task.description}
        </p>
      ) : editable ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setEditing('description'); }}
          className="mt-1 text-xs italic text-hearth-text-faint hover:text-hearth-text-muted"
        >
          + Add description
        </button>
      ) : null}

      {/* Footer */}
      <div className="mt-2 flex items-center gap-2">
        <span className="rounded bg-hearth-chip px-1.5 py-0.5 text-xs text-hearth-text-muted">
          {SOURCE_LABELS[task.source] ?? task.source}
        </span>
        {editable ? (
          <button
            type="button"
            onClick={cyclePriority}
            className="rounded px-1.5 py-0.5 text-xs font-medium text-amber-600 hover:bg-amber-50"
            aria-label={`Priority ${task.priority}, click to change`}
          >
            P{task.priority}
          </button>
        ) : (
          task.priority > 0 && <span className="text-xs text-amber-600">P{task.priority}</span>
        )}
        {subtaskCount > 0 && (
          <span className="ml-auto text-xs text-hearth-text-faint">
            {subtaskCount} subtask{subtaskCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Add-context affordance (auto_detected/backlog only) */}
      {editable && onAddContext && (
        <div className="mt-2 border-t border-hearth-border pt-2">
          {contextOpen ? (
            <form onSubmit={submitContext} className="flex flex-col gap-1.5">
              <textarea
                value={contextNote}
                onChange={(e) => setContextNote(e.target.value)}
                rows={2}
                placeholder="What should the agent know before planning?"
                className="w-full rounded border border-hearth-border-strong px-2 py-1 text-xs text-hearth-text focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
              <div className="flex gap-1.5">
                <button
                  type="submit"
                  className="rounded bg-hearth-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-hearth-700"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setContextOpen(false); setContextNote(''); }}
                  className="rounded px-2 py-0.5 text-xs text-hearth-text-muted hover:bg-hearth-chip"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setContextOpen(true); }}
              className="text-xs text-hearth-text-muted hover:text-hearth-600"
            >
              + Add context
            </button>
          )}
        </div>
      )}
    </div>
  );
}
