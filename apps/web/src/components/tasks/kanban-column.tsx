import type { Task, TaskStatus } from '@hearth/shared';
import { TaskCard } from './task-card';

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  auto_detected: { label: 'Auto Detected', color: 'bg-amber-500' },
  backlog: { label: 'Backlog', color: 'bg-hearth-bg0' },
  planning: { label: 'Planning', color: 'bg-blue-500' },
  executing: { label: 'Executing', color: 'bg-purple-500' },
  review: { label: 'Review', color: 'bg-orange-500' },
  done: { label: 'Done', color: 'bg-green-500' },
  failed: { label: 'Failed', color: 'bg-red-500' },
  archived: { label: 'Archived', color: 'bg-gray-400' },
};

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onDrop: (taskId: string, newStatus: TaskStatus) => void;
  onTaskUpdate?: (
    id: string,
    patch: { title?: string; description?: string; priority?: number },
  ) => Promise<void> | void;
  onTaskAddContext?: (id: string, note: string) => Promise<void> | void;
}

export function KanbanColumn({
  status,
  tasks,
  onTaskClick,
  onDrop,
  onTaskUpdate,
  onTaskAddContext,
}: KanbanColumnProps) {
  const config = STATUS_CONFIG[status];

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.currentTarget.classList.add('bg-hearth-chip');
  }

  function handleDragLeave(e: React.DragEvent) {
    e.currentTarget.classList.remove('bg-hearth-chip');
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.currentTarget.classList.remove('bg-hearth-chip');
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) onDrop(taskId, status);
  }

  return (
    <div
      role="list"
      aria-label={`${config.label} column, ${tasks.length} tasks`}
      className="flex w-72 flex-shrink-0 flex-col rounded-lg bg-hearth-bg animate-fade-in"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-3">
        <div className={`h-2 w-2 rounded-full ${config.color}`} aria-hidden="true" />
        <h3 className="text-sm font-semibold text-hearth-text">{config.label}</h3>
        <span className="ml-auto text-xs text-hearth-text-faint" aria-label={`${tasks.length} tasks`}>{tasks.length}</span>
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-hearth-border py-8">
            <p className="text-xs text-hearth-text-faint">Drop tasks here</p>
          </div>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={() => onTaskClick(task)}
              onUpdate={onTaskUpdate}
              onAddContext={onTaskAddContext}
            />
          ))
        )}
      </div>
    </div>
  );
}
