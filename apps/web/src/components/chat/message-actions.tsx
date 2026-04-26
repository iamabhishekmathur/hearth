import { useState, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { HIcon } from '@/components/ui/icon';

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

  return (
    <div className="absolute -top-1 right-0 z-10 flex items-center gap-0.5 rounded-md border border-hearth-border bg-hearth-card px-1 py-0.5 shadow-hearth-2 opacity-0 transition-opacity duration-fast group-hover:opacity-100">
      <ActionBtn icon={copied ? 'check' : 'copy'} title={copied ? 'Copied' : 'Copy'} onClick={handleCopy} />
      {role === 'assistant' && onRegenerate && (
        <ActionBtn icon="retry" title="Regenerate" onClick={onRegenerate} />
      )}
      {role === 'assistant' && (
        <>
          <ActionBtn icon="thumbs-up" title="Good" onClick={() => handleFeedback('positive')} active={feedbackGiven === 'positive'} activeColor="var(--hearth-ok)" />
          <ActionBtn icon="thumbs-down" title="Bad" onClick={() => handleFeedback('negative')} active={feedbackGiven === 'negative'} activeColor="var(--hearth-err)" />
        </>
      )}
      {role === 'user' && onDuplicate && (
        <ActionBtn icon="copy" title="Duplicate from here" onClick={onDuplicate} />
      )}
    </div>
  );
}

function ActionBtn({ icon, title, onClick, active, activeColor }: { icon: string; title: string; onClick: () => void; active?: boolean; activeColor?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded p-1 transition-colors duration-fast hover:bg-hearth-chip"
      title={title}
      style={{ color: active ? activeColor : 'var(--hearth-text-muted)' }}
    >
      <HIcon name={icon} size={14} color={active ? activeColor : 'var(--hearth-text-muted)'} />
    </button>
  );
}
