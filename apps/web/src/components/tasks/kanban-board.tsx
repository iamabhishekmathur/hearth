import { useState, useEffect, useCallback } from 'react';
import type { Task, TaskStatus } from '@hearth/shared';
import { VALID_STATUS_TRANSITIONS } from '@hearth/shared';
import { useTasks } from '@/hooks/use-tasks';
import { KanbanColumn } from './kanban-column';
import { TaskDetailPanel } from './task-detail-panel';

const KANBAN_COLUMNS: TaskStatus[] = [
  'auto_detected',
  'backlog',
  'planning',
  'executing',
  'review',
  'done',
];

export function KanbanBoard() {
  const { tasks, loading, fetchTasks, createTask, updateTask, addContext } = useTasks();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');

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

  const tasksByStatus = KANBAN_COLUMNS.reduce(
    (acc, status) => {
      acc[status] = tasks.filter((t) => t.status === status);
      return acc;
    },
    {} as Record<TaskStatus, Task[]>,
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-hearth-border px-6 py-4">
        <h1 className="text-xl font-bold text-hearth-text">Tasks</h1>
        <button
          type="button"
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="rounded-lg bg-hearth-600 px-4 py-2 text-sm font-medium text-white hover:bg-hearth-700"
        >
          New Task
        </button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="flex gap-2 border-b border-hearth-border bg-hearth-bg px-6 py-3">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Task title..."
            className="flex-1 rounded-lg border border-hearth-border-strong px-3 py-1.5 text-sm focus:border-hearth-accent focus:outline-none"
            autoFocus
          />
          <button
            type="button"
            onClick={handleCreate}
            className="rounded-lg bg-hearth-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-hearth-700"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setShowCreateForm(false)}
            className="rounded-lg border border-hearth-border-strong px-3 py-1.5 text-sm text-hearth-text-muted hover:bg-hearth-bg"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Board */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-hearth-border border-t-hearth-600" />
            <p className="mt-3 text-sm text-hearth-text-faint">Loading tasks...</p>
          </div>
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-hearth-50">
              <svg className="h-8 w-8 text-hearth-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v11.75A2.75 2.75 0 0 0 16.75 18h-12A2.75 2.75 0 0 1 2 15.25V3.5Zm3.75 7a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-4.5Zm0 3a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-4.5ZM5 5.75A.75.75 0 0 1 5.75 5h4.5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 8.25v-2.5Z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-hearth-text">No tasks yet</h2>
            <p className="mt-1 max-w-sm text-sm text-hearth-text-muted">
              Create your first task to get started. Tasks can be created manually or detected automatically from your integrations.
            </p>
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              className="mt-4 rounded-lg bg-hearth-600 px-4 py-2 text-sm font-medium text-white hover:bg-hearth-700"
            >
              Create your first task
            </button>
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

      {/* Detail panel */}
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
