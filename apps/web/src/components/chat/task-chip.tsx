import { useState, useEffect } from 'react';
import type { TaskChipInfo } from '@/hooks/use-chat';
import { HIcon } from '@/components/ui/icon';

interface TaskChipProps {
  chip: TaskChipInfo;
  align: 'start' | 'end';
  onUnlink?: (messageId: string, taskId: string) => void;
}

const UNDO_WINDOW_MS = 5000;

export function TaskChip({ chip, align, onUnlink }: TaskChipProps) {
  // Undo countdown — recomputed on a 250ms tick so the affordance disappears
  // exactly when the window closes, without re-rendering more than needed.
  const initialRemaining = chip.freshAt
    ? Math.max(0, UNDO_WINDOW_MS - (Date.now() - chip.freshAt))
    : 0;
  const [remaining, setRemaining] = useState(initialRemaining);

  useEffect(() => {
    if (!chip.freshAt) return;
    const id = setInterval(() => {
      const r = Math.max(0, UNDO_WINDOW_MS - (Date.now() - chip.freshAt!));
      setRemaining(r);
      if (r === 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [chip.freshAt]);

  const showUndo = remaining > 0 && !!onUnlink && !!chip.messageId;
  const undoSeconds = Math.ceil(remaining / 1000);

  return (
    <div className={`mt-1 flex ${align === 'end' ? 'justify-end' : 'justify-start'}`}>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-none text-hearth-text-muted ${
          chip.freshlyCreated ? 'task-chip-slide-in' : ''
        }`}
        style={{ borderColor: 'var(--hearth-border)', background: 'var(--hearth-card)' }}
      >
        <HIcon name="check" size={11} color="var(--hearth-ok)" />
        <a
          href={`#/tasks?taskId=${chip.taskId}`}
          className="inline-flex items-center gap-1.5 hover:underline"
          title="Open task"
        >
          <span className="font-medium text-hearth-text">Task created</span>
          {chip.title && chip.title !== 'Task' && (
            <>
              <span className="text-hearth-text-faint">·</span>
              <span className="max-w-[180px] truncate">{chip.title}</span>
            </>
          )}
          <span className="text-hearth-text-faint">·</span>
          <span className="text-hearth-accent">View →</span>
        </a>
        {showUndo && (
          <>
            <span className="text-hearth-text-faint">·</span>
            <button
              type="button"
              onClick={() => onUnlink!(chip.messageId!, chip.taskId)}
              className="rounded px-1 text-hearth-text-faint hover:bg-hearth-chip hover:text-hearth-text-muted"
              title="Undo task creation"
            >
              Undo ({undoSeconds}s)
            </button>
          </>
        )}
      </span>
    </div>
  );
}
