import { useEffect, useState, useRef } from 'react';
import { useTaskDetail } from '@/hooks/use-tasks';
import { api } from '@/lib/api-client';
import type { Task, TaskStatus, ReviewDecision } from '@hearth/shared';
import { TaskComments } from './task-comments';
import { TaskSubtasks } from './task-subtasks';
import { TaskContextPanel } from './task-context-panel';
import { TaskReviewPanel } from './task-review';
import { SkillProposalBanner } from './skill-proposal-banner';

const TABS = ['Overview', 'Context', 'Subtasks', 'Review', 'Comments'] as const;
type Tab = (typeof TABS)[number];

const EDITABLE_STATUSES = new Set<TaskStatus>(['auto_detected', 'backlog']);

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: 'None', color: 'text-hearth-text-faint' },
  1: { label: 'Low', color: 'text-blue-600' },
  2: { label: 'Medium', color: 'text-amber-600' },
  3: { label: 'High', color: 'text-red-600' },
};

interface TaskDetailPanelProps {
  taskId: string;
  onClose: () => void;
}

export function TaskDetailPanel({ taskId, onClose }: TaskDetailPanelProps) {
  const { task, loading, updateTask, updateContext, addComment, submitReview, replan } = useTaskDetail(taskId);
  const [activeTab, setActiveTab] = useState<Tab>('Overview');

  // Auto-focus the Review tab when a task is awaiting review
  useEffect(() => {
    if (task?.status === 'review') setActiveTab('Review');
  }, [task?.status, task?.id]);

  async function handleReviewSubmit(decision: ReviewDecision, feedback?: string) {
    await submitReview(decision, feedback);
  }

  async function handleCancelTask() {
    await api.patch<{ data: Task }>(`/tasks/${taskId}`, { status: 'archived' });
  }

  if (loading || !task) {
    return (
      <div className="fixed inset-y-0 right-0 z-50 w-[460px] max-w-[90vw] border-l border-hearth-border bg-hearth-card shadow-hearth-4">
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-hearth-text-faint">Loading...</p>
        </div>
      </div>
    );
  }

  const editable = EDITABLE_STATUSES.has(task.status as TaskStatus);

  return (
    <div role="dialog" aria-label={`Task detail: ${task.title}`} className="fixed inset-y-0 right-0 z-50 flex w-[460px] max-w-[90vw] flex-col border-l border-hearth-border bg-hearth-card shadow-hearth-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-hearth-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-hearth-text">{task.title}</h2>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="rounded bg-hearth-chip px-1.5 py-0.5 text-xs font-medium text-hearth-text-muted">
              {task.status.replace('_', ' ')}
            </span>
            <span className="text-xs text-hearth-text-faint">{task.source}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close task detail"
          className="rounded p-1 text-hearth-text-faint hover:bg-hearth-chip hover:text-hearth-text-muted"
        >
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Task detail tabs"
        className="flex overflow-x-auto border-b border-hearth-border"
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`tabpanel-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`shrink-0 whitespace-nowrap px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-hearth-600 text-hearth-600'
                : 'text-hearth-text-muted hover:text-hearth-text'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Skill proposal banner */}
      {(task.status === 'review' || task.status === 'done') && (
        <div className="px-4 pt-3">
          <SkillProposalBanner taskId={taskId} />
        </div>
      )}

      {/* Tab content */}
      <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-label={activeTab} className="flex-1 overflow-y-auto p-4">
        {activeTab === 'Overview' && (
          <OverviewTab task={task} editable={editable} onUpdate={updateTask} />
        )}

        {activeTab === 'Context' && (
          <TaskContextPanel
            taskId={task.id}
            context={task.context}
            editable={editable}
            onAddContext={updateContext}
          />
        )}

        {activeTab === 'Review' && (
          <TaskReviewPanel
            task={task}
            reviews={task.reviews ?? []}
            onSubmit={handleReviewSubmit}
            onCancel={handleCancelTask}
          />
        )}

        {activeTab === 'Comments' && (
          <TaskComments
            comments={task.comments ?? []}
            onAddComment={addComment}
          />
        )}

        {activeTab === 'Subtasks' && (
          <TaskSubtasks
            subtasks={task.subTasks ?? []}
            taskStatus={task.status as TaskStatus}
            parentSteps={task.executionSteps ?? []}
            onReplan={replan}
          />
        )}
      </div>
    </div>
  );
}

// ── Editable Overview Tab ────────────────────────────────────────────────

function OverviewTab({
  task,
  editable,
  onUpdate,
}: {
  task: Task;
  editable: boolean;
  onUpdate: (data: { title?: string; description?: string; priority?: number }) => Promise<unknown>;
}) {
  const [editingField, setEditingField] = useState<'title' | 'description' | null>(null);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  // Sync local state with task changes (WS updates)
  useEffect(() => {
    if (editingField !== 'title') setTitle(task.title);
    if (editingField !== 'description') setDescription(task.description ?? '');
  }, [task.title, task.description, editingField]);

  useEffect(() => {
    if (editingField === 'title') titleRef.current?.focus();
    if (editingField === 'description') descRef.current?.focus();
  }, [editingField]);

  async function commitTitle() {
    const next = title.trim();
    setEditingField(null);
    if (!next || next === task.title) return;
    await onUpdate({ title: next });
  }

  async function commitDescription() {
    const next = description.trim();
    setEditingField(null);
    if (next === (task.description ?? '')) return;
    await onUpdate({ description: next });
  }

  async function setPriority(p: number) {
    if (p === task.priority) return;
    await onUpdate({ priority: p });
  }

  const priorityCfg = PRIORITY_LABELS[task.priority] ?? PRIORITY_LABELS[0];

  return (
    <div className="space-y-4">
      {/* Title */}
      <div>
        <h4 className="mb-1 text-xs font-medium text-hearth-text-muted">Title</h4>
        {editingField === 'title' ? (
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitTitle(); }
              if (e.key === 'Escape') { setTitle(task.title); setEditingField(null); }
            }}
            className="w-full rounded border border-hearth-400 bg-hearth-card px-2 py-1.5 text-sm text-hearth-text focus:outline-none focus:ring-1 focus:ring-hearth-accent"
          />
        ) : (
          <p
            className={`text-sm text-hearth-text ${editable ? 'cursor-text rounded px-2 py-1.5 -mx-2 hover:bg-hearth-bg' : ''}`}
            onClick={() => { if (editable) setEditingField('title'); }}
          >
            {task.title}
          </p>
        )}
      </div>

      {/* Description */}
      <div>
        <h4 className="mb-1 text-xs font-medium text-hearth-text-muted">Description</h4>
        {editingField === 'description' ? (
          <textarea
            ref={descRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={commitDescription}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitDescription(); }
              if (e.key === 'Escape') { setDescription(task.description ?? ''); setEditingField(null); }
            }}
            rows={4}
            placeholder="Add a description..."
            className="w-full rounded border border-hearth-400 bg-hearth-card px-2 py-1.5 text-sm text-hearth-text focus:outline-none focus:ring-1 focus:ring-hearth-accent"
          />
        ) : task.description ? (
          <p
            className={`whitespace-pre-wrap text-sm text-hearth-text ${editable ? 'cursor-text rounded px-2 py-1.5 -mx-2 hover:bg-hearth-bg' : ''}`}
            onClick={() => { if (editable) setEditingField('description'); }}
          >
            {task.description}
          </p>
        ) : editable ? (
          <button
            type="button"
            onClick={() => setEditingField('description')}
            className="text-sm italic text-hearth-text-faint hover:text-hearth-text-muted"
          >
            + Add description
          </button>
        ) : (
          <p className="text-sm text-hearth-text-faint italic">No description</p>
        )}
      </div>

      {/* Priority */}
      <div>
        <h4 className="mb-1 text-xs font-medium text-hearth-text-muted">Priority</h4>
        {editable ? (
          <div className="flex gap-1.5">
            {[0, 1, 2, 3].map((p) => {
              const cfg = PRIORITY_LABELS[p];
              const isActive = task.priority === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-gray-900 text-white'
                      : 'bg-hearth-chip text-hearth-text-muted hover:bg-hearth-chip'
                  }`}
                >
                  {p === 0 ? 'None' : `P${p}`}
                </button>
              );
            })}
          </div>
        ) : (
          <p className={`text-sm font-medium ${priorityCfg.color}`}>
            {task.priority === 0 ? 'None' : `P${task.priority} — ${priorityCfg.label}`}
          </p>
        )}
      </div>

      {/* Read-only metadata */}
      <div className="grid grid-cols-2 gap-3 border-t border-hearth-border pt-4">
        <div>
          <h4 className="text-xs font-medium text-hearth-text-muted">Created</h4>
          <p className="text-sm text-hearth-text">
            {new Date(task.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div>
          <h4 className="text-xs font-medium text-hearth-text-muted">Source</h4>
          <p className="text-sm text-hearth-text">{task.source.replace('_', ' ')}</p>
        </div>
        <div>
          <h4 className="text-xs font-medium text-hearth-text-muted">Subtasks</h4>
          <p className="text-sm text-hearth-text">{task.subTasks?.length ?? 0}</p>
        </div>
        <div>
          <h4 className="text-xs font-medium text-hearth-text-muted">Comments</h4>
          <p className="text-sm text-hearth-text">{task.comments?.length ?? 0}</p>
        </div>
      </div>
    </div>
  );
}
