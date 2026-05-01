import { HIcon } from '@/components/ui/icon';

interface TaskProgressCardProps {
  taskId: string;
  taskTitle: string;
  milestone: 'started' | 'executing' | 'review' | 'done' | 'failed';
}

const MILESTONE_LABELS: Record<TaskProgressCardProps['milestone'], string> = {
  started: 'Task started',
  executing: 'Agent executing',
  review: 'Awaiting review',
  done: 'Task complete',
  failed: 'Task failed',
};

const MILESTONE_DOT_COLOR: Record<TaskProgressCardProps['milestone'], string> = {
  started: 'var(--hearth-text-faint)',
  executing: 'var(--hearth-accent)',
  review: 'var(--hearth-warn)',
  done: 'var(--hearth-ok)',
  failed: 'var(--hearth-err)',
};

export function TaskProgressCard({ taskId, taskTitle, milestone }: TaskProgressCardProps) {
  const dotColor = MILESTONE_DOT_COLOR[milestone];
  const animatePulse = milestone === 'executing';
  return (
    <div className="my-2 flex justify-center animate-fade-in">
      <a
        href={`#/tasks?taskId=${taskId}`}
        className="inline-flex items-center gap-2 rounded-pill border px-2.5 py-1 text-[11px] transition-colors hover:bg-hearth-chip"
        style={{ borderColor: 'var(--hearth-border)', background: 'var(--hearth-card)', color: 'var(--hearth-text-muted)' }}
        title="Open task"
      >
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${animatePulse ? 'animate-pulse' : ''}`}
          style={{ background: dotColor }}
        />
        <span className="font-medium text-hearth-text">{MILESTONE_LABELS[milestone]}</span>
        <span className="text-hearth-text-faint">·</span>
        <span className="max-w-[280px] truncate">{taskTitle}</span>
        <span className="text-hearth-text-faint">·</span>
        <span style={{ color: 'var(--hearth-accent)' }}>View →</span>
      </a>
    </div>
  );
}
