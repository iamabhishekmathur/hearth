import { useState, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { HIcon } from '@/components/ui/icon';
import { TaskComposer, type TaskComposerSubmit } from './task-composer';

const REACTION_EMOJIS = ['👍', '👎', '✅', '❓', '⚠️', '🎯'] as const;

interface MessageActionsProps {
  messageId: string;
  sessionId: string;
  content: string;
  role: 'user' | 'assistant';
  onRegenerate?: () => void;
  onDuplicate?: () => void;
}

export function MessageActions({ messageId, sessionId, content, role, onRegenerate, onDuplicate }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<'positive' | 'negative' | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);

  const handleTaskCreated = useCallback((_result: TaskComposerSubmit) => {
    setComposerOpen(false);
    // The chip render is driven by the WebSocket event + ChatMessage.producedTaskIds,
    // so no local state update needed here.
  }, []);

  const handleReact = useCallback(async (emoji: string) => {
    setPickerOpen(false);
    try {
      await api.post(`/chat/sessions/${sessionId}/messages/${messageId}/reactions`, { emoji });
    } catch { /* socket event will reconcile if it landed; otherwise silent */ }
  }, [sessionId, messageId]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* noop */ }
  }, [content]);

  const handleFeedback = useCallback(async (rating: 'positive' | 'negative') => {
    setFeedbackGiven(rating);
    try {
      await api.post(`/chat/sessions/${sessionId}/messages/${messageId}/feedback`, { rating });
    } catch { /* noop */ }
  }, [sessionId, messageId]);

  // For user messages, the avatar sits at right-0; offset the action bar
  // left of it so it doesn't sit underneath. For assistant messages the
  // right side is empty.
  const offsetClass = role === 'user' ? 'right-10' : 'right-0';
  return (
    <div className={`absolute -top-3 ${offsetClass} z-20 flex items-center gap-0.5 rounded-md border border-hearth-border bg-hearth-card px-1 py-0.5 shadow-hearth-2 opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto`}>
      <div className="relative">
        <Tooltip label="React">
          <button
            type="button"
            onClick={() => setPickerOpen((p) => !p)}
            className="rounded p-1 text-[14px] leading-none transition-colors duration-fast hover:bg-hearth-chip"
            style={{ color: 'var(--hearth-text-muted)' }}
          >
            <span aria-hidden>☺</span>
          </button>
        </Tooltip>
        {pickerOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 flex items-center gap-0.5 rounded-md border border-hearth-border bg-hearth-card px-1 py-0.5 shadow-hearth-3">
            {REACTION_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => handleReact(e)}
                className="rounded p-1 text-base leading-none transition-colors duration-fast hover:bg-hearth-chip"
                aria-label={`React ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
      <ActionBtn icon={copied ? 'check' : 'copy'} title={copied ? 'Copied' : 'Copy'} onClick={handleCopy} />
      {role === 'assistant' && onRegenerate && (
        <ActionBtn icon="retry" title="Regenerate" onClick={onRegenerate} />
      )}
      {role === 'assistant' && (
        <>
          <ActionBtn icon="thumbs-up" title="Good response" onClick={() => handleFeedback('positive')} active={feedbackGiven === 'positive'} activeColor="var(--hearth-ok)" />
          <ActionBtn icon="thumbs-down" title="Bad response" onClick={() => handleFeedback('negative')} active={feedbackGiven === 'negative'} activeColor="var(--hearth-err)" />
        </>
      )}
      {role === 'user' && onDuplicate && (
        <ActionBtn icon="fork" title="Fork conversation from here" onClick={onDuplicate} />
      )}
      <div className="relative">
        <ActionBtn icon="board" title="Create task from here" onClick={() => setComposerOpen((p) => !p)} active={composerOpen} />
        {composerOpen && (
          <div className="absolute right-0 top-full z-30 mt-1">
            <TaskComposer
              sessionId={sessionId}
              anchorMessageId={messageId}
              provenance="chat_button"
              initialTitle={content.slice(0, 80).replace(/\s+/g, ' ').trim()}
              onSubmit={handleTaskCreated}
              onCancel={() => setComposerOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ActionBtn({ icon, title, onClick, active, activeColor }: { icon: string; title: string; onClick: () => void; active?: boolean; activeColor?: string }) {
  return (
    <Tooltip label={title}>
      <button
        type="button"
        onClick={onClick}
        className="rounded p-1 transition-colors duration-fast hover:bg-hearth-chip"
        aria-label={title}
        style={{ color: active ? activeColor : 'var(--hearth-text-muted)' }}
      >
        <HIcon name={icon} size={14} color={active ? activeColor : 'var(--hearth-text-muted)'} />
      </button>
    </Tooltip>
  );
}

/**
 * Inline tooltip — shows a label below the wrapped trigger on hover/focus.
 * CSS-only (group/tooltip), no portal, so it can clip on tight overflow
 * containers — fine for action bars that float above the message.
 */
function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group/tooltip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-medium opacity-0 shadow-hearth-2 transition-opacity duration-fast group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100"
        style={{ background: 'var(--hearth-text)', color: 'var(--hearth-text-inverse)' }}
      >
        {label}
      </span>
    </span>
  );
}
