import type { TaskToastInfo } from '@/hooks/use-chat';
import { HIcon } from '@/components/ui/icon';

interface TaskToastProps {
  toast: TaskToastInfo;
  onDismiss: () => void;
  onUndo: (messageId: string, taskId: string) => void;
}

export function TaskToast({ toast, onDismiss, onUndo }: TaskToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="task-toast-slide-in pointer-events-auto absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2 rounded-pill border px-3 py-1.5 text-[12px] shadow-hearth-3"
      style={{ background: 'var(--hearth-text)', color: 'var(--hearth-text-inverse)', borderColor: 'transparent' }}
    >
      <HIcon name="check" size={12} color="var(--hearth-ok)" />
      <span className="font-medium">Task created</span>
      {toast.title && (
        <>
          <span style={{ opacity: 0.5 }}>·</span>
          <span className="max-w-[260px] truncate">{toast.title}</span>
        </>
      )}
      <span style={{ opacity: 0.5 }}>·</span>
      <a
        href={`#/tasks?taskId=${toast.taskId}`}
        className="font-medium underline-offset-2 hover:underline"
        style={{ color: 'var(--hearth-accent)' }}
      >
        View
      </a>
      <span style={{ opacity: 0.5 }}>·</span>
      <button
        type="button"
        onClick={() => onUndo(toast.messageId, toast.taskId)}
        className="rounded px-1 hover:bg-white/10"
        style={{ color: 'rgba(255,255,255,0.75)' }}
      >
        Undo
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="ml-1 rounded p-0.5 hover:bg-white/10"
        style={{ color: 'rgba(255,255,255,0.6)' }}
      >
        <HIcon name="x" size={11} color="currentColor" />
      </button>
    </div>
  );
}
