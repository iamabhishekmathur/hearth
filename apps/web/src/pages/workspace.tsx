import { useState, useEffect, useCallback } from 'react';
import type { Task, TaskStatus } from '@hearth/shared';
import { VALID_STATUS_TRANSITIONS } from '@hearth/shared';
import { useTasks } from '@/hooks/use-tasks';
import { KanbanColumn } from '@/components/workspace/kanban-column';
import { TaskDetailPanel } from '@/components/workspace/task-detail-panel';
import { HButton, HCard, HEyebrow, HPill } from '@/components/ui/primitives';
import { HIcon } from '@/components/ui/icon';

const KANBAN_COLUMNS: TaskStatus[] = [
  'auto_detected',
  'backlog',
  'planning',
  'executing',
  'review',
  'done',
];

type FilterTab = 'all' | 'mine' | 'auto';

export function WorkspacePage() {
  const { tasks, loading, fetchTasks, createTask, updateTask, addContext } = useTasks();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [filter, setFilter] = useState<FilterTab>('all');

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Auto-select task from URL query param (e.g., ?taskId=abc)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get('taskId');
    if (taskId && tasks.length > 0) {
      const task = tasks.find((t) => t.id === taskId);
      if (task) setSelectedTask(task);
    }
  }, [tasks]);

  const handleDrop = useCallback(
    async (taskId: string, newStatus: TaskStatus) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.status === newStatus) return;

      // Validate transition
      const allowed = VALID_STATUS_TRANSITIONS[task.status as TaskStatus];
      if (!allowed.includes(newStatus)) return;

      await updateTask(taskId, { status: newStatus });
      fetchTasks();
    },
    [tasks, updateTask, fetchTasks],
  );

  const handleCreate = useCallback(async () => {
    if (!newTitle.trim()) return;
    await createTask({ title: newTitle, source: 'manual' });
    setNewTitle('');
    setShowCreateForm(false);
    fetchTasks();
  }, [newTitle, createTask, fetchTasks]);

  const handleCardUpdate = useCallback(
    async (
      id: string,
      patch: { title?: string; description?: string; priority?: number },
    ) => {
      await updateTask(id, patch);
      fetchTasks();
    },
    [updateTask, fetchTasks],
  );

  const handleAddContext = useCallback(
    async (id: string, note: string) => {
      await addContext(id, note);
      fetchTasks();
    },
    [addContext, fetchTasks],
  );

  /* ---- Filtering --------------------------------------------------------- */

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'auto') return t.source !== 'manual';
    if (filter === 'mine') return t.source === 'manual';
    return true;
  });

  const tasksByStatus = KANBAN_COLUMNS.reduce(
    (acc, status) => {
      acc[status] = filteredTasks.filter((t) => t.status === status);
      return acc;
    },
    {} as Record<TaskStatus, Task[]>,
  );

  /* ---- Render ------------------------------------------------------------ */

  return (
    <div className="flex h-full flex-col bg-hearth-bg">
      {/* ---- Header ---- */}
      <div
        className="flex items-center justify-between border-b border-hearth-border px-6"
        style={{ paddingTop: 'var(--hearth-space-5)', paddingBottom: 'var(--hearth-space-5)' }}
      >
        <div className="flex flex-col gap-1">
          <HEyebrow>Board</HEyebrow>
          <h1
            className="font-display font-semibold text-hearth-text"
            style={{ fontSize: 38, letterSpacing: -1, lineHeight: 1.05 }}
          >
            Workspace<span style={{ color: 'var(--hearth-accent)' }}>.</span>
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Filter pills */}
          <div className="flex items-center gap-1">
            <HPill active={filter === 'all'} onClick={() => setFilter('all')}>All</HPill>
            <HPill active={filter === 'mine'} onClick={() => setFilter('mine')}>Mine</HPill>
            <HPill active={filter === 'auto'} onClick={() => setFilter('auto')}>Auto-detected</HPill>
          </div>

          <HButton
            variant="accent"
            icon="plus"
            onClick={() => setShowCreateForm(!showCreateForm)}
          >
            New Task
          </HButton>
        </div>
      </div>

      {/* ---- Create form ---- */}
      {showCreateForm && (
        <div
          className="border-b border-hearth-border"
          style={{ padding: 'var(--hearth-space-3) var(--hearth-space-6)' }}
        >
          <HCard variant="alt" padding="p-3">
            <HEyebrow className="mb-2">Create task</HEyebrow>
            <div className="flex gap-2">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="Task title..."
                className="flex-1 rounded-md border border-hearth-border-strong bg-hearth-card px-3 py-1.5 text-sm text-hearth-text placeholder:text-hearth-text-faint focus:border-hearth-accent focus:outline-none focus:shadow-hearth-focus transition-all duration-fast ease-hearth"
                autoFocus
              />
              <HButton variant="primary" onClick={handleCreate}>
                Create
              </HButton>
              <HButton
                variant="ghost"
                onClick={() => setShowCreateForm(false)}
              >
                Cancel
              </HButton>
            </div>
          </HCard>
        </div>
      )}

      {/* ---- Board content ---- */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div
              className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-hearth-border"
              style={{ borderTopColor: 'var(--hearth-accent)' }}
            />
            <p className="mt-3 text-sm text-hearth-text-faint">Loading tasks...</p>
          </div>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div
              className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full"
              style={{ background: 'var(--hearth-accent-soft)' }}
            >
              <HIcon name="board" size={32} color="var(--hearth-accent)" />
            </div>
            <h2
              className="font-display font-semibold text-hearth-text"
              style={{ fontSize: 22, letterSpacing: -0.4, lineHeight: 1.2 }}
            >
              No tasks yet<span style={{ color: 'var(--hearth-accent)' }}>.</span>
            </h2>
            <p className="mt-2 max-w-sm text-sm text-hearth-text-muted">
              Create your first task to get started. Tasks can be created manually or detected automatically from your integrations.
            </p>
            <div className="mt-5">
              <HButton
                variant="accent"
                icon="plus"
                onClick={() => setShowCreateForm(true)}
              >
                Create your first task
              </HButton>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 gap-3 overflow-x-auto p-4" role="region" aria-label="Kanban board">
          {KANBAN_COLUMNS.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tasks={tasksByStatus[status] ?? []}
              onTaskClick={(task) => setSelectedTask(task)}
              onDrop={handleDrop}
              onTaskUpdate={handleCardUpdate}
              onTaskAddContext={handleAddContext}
            />
          ))}
        </div>
      )}

      {/* ---- Detail panel ---- */}
      {selectedTask && (
        <TaskDetailPanel
          taskId={selectedTask.id}
          onClose={() => {
            setSelectedTask(null);
            fetchTasks();
          }}
        />
      )}
    </div>
  );
}
