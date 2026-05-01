import { useState, useEffect } from 'react';
import { TaskComposer, type TaskComposerSubmit } from './task-composer';
import { HIcon } from '@/components/ui/icon';

interface TaskShapeNudgeProps {
  sessionId: string;
  messageId: string;
  /** Pre-derived title from the message content. */
  initialTitle: string;
  /** Per-(session,message) localStorage key — dismissals persist across reloads. */
  dismissalKey: string;
}

/**
 * Inline "this looks like a task — promote it?" nudge rendered under
 * assistant messages whose shape suggests delegated multi-step work.
 *
 * Hides itself if the user dismissed (persisted in localStorage so it
 * doesn't reappear on reload).
 */
export function TaskShapeNudge({ sessionId, messageId, initialTitle, dismissalKey }: TaskShapeNudgeProps) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(dismissalKey) === '1';
  });
  const [composerOpen, setComposerOpen] = useState(false);

  useEffect(() => {
    setDismissed(window.localStorage.getItem(dismissalKey) === '1');
  }, [dismissalKey]);

  if (dismissed) return null;

  const handleDismiss = () => {
    window.localStorage.setItem(dismissalKey, '1');
    setDismissed(true);
  };

  const handleSubmit = (_result: TaskComposerSubmit) => {
    setComposerOpen(false);
    handleDismiss(); // dismiss the nudge once the task is created
  };

  if (composerOpen) {
    return (
      <div className="mt-2 max-w-[380px]">
        <TaskComposer
          sessionId={sessionId}
          anchorMessageId={messageId}
          provenance="chat_button"
          initialTitle={initialTitle}
          onSubmit={handleSubmit}
          onCancel={() => setComposerOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-2 text-[11px] text-hearth-text-faint animate-fade-in">
      <HIcon name="board" size={11} color="var(--hearth-text-faint)" />
      <span>This looks like a task —</span>
      <button
        type="button"
        onClick={() => setComposerOpen(true)}
        className="font-medium text-hearth-accent hover:underline"
      >
        promote it?
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        className="ml-1 rounded px-1 text-hearth-text-faint hover:bg-hearth-chip hover:text-hearth-text-muted"
        title="Dismiss this suggestion"
        aria-label="Dismiss"
      >
        <HIcon name="x" size={10} />
      </button>
    </div>
  );
}
