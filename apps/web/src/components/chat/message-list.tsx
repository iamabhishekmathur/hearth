import { useEffect, useRef, useState, useCallback } from 'react';
import type { ChatMessage } from '@hearth/shared';
import type { ToolCallInfo } from '@/hooks/use-chat';
import type { Artifact } from '@/hooks/use-artifacts';
import { MessageBubble } from './message-bubble';
import { ThinkingIndicator } from './thinking-indicator';
import { ToolCallCard } from './tool-call-card';
import { StarterPrompts } from './starter-prompts';
import { MessageActions } from './message-actions';
import { HIcon } from '@/components/ui/icon';

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  thinking: string | null;
  toolCalls: ToolCallInfo[];
  authors?: Map<string, string>;
  isCollaborative?: boolean;
  onDuplicateFromMessage?: (messageId: string) => void;
  readOnly?: boolean;
  artifacts?: Artifact[];
  onOpenArtifact?: (id: string) => void;
  governanceBanner?: boolean;
  governanceWarnings?: Map<string, string>;
  governanceBlocks?: Map<string, { policyName: string; reason: string }>;
  onStarterSelect?: (prompt: string) => void;
  onRegenerate?: () => void;
  sessionId?: string;
}

export function MessageList({
  messages, isStreaming, thinking, toolCalls, authors, isCollaborative,
  onDuplicateFromMessage, readOnly, artifacts, onOpenArtifact,
  governanceBanner, governanceWarnings, governanceBlocks,
  onStarterSelect, onRegenerate, sessionId,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const userScrolledRef = useRef(false);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNearBottom = distanceFromBottom < 200;
    userScrolledRef.current = !isNearBottom;
    setShowScrollButton(!isNearBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    userScrolledRef.current = false;
    setShowScrollButton(false);
  }, []);

  useEffect(() => {
    if (!userScrolledRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, thinking, toolCalls]);

  if (messages.length === 0 && !isStreaming) {
    if (onStarterSelect) {
      return <StarterPrompts onSelect={onStarterSelect} />;
    }
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="text-center">
          <div
            className="mx-auto grid h-14 w-14 place-items-center rounded-xl text-white font-display font-medium"
            style={{ background: 'var(--hearth-accent-grad)', fontSize: 28, letterSpacing: -0.8 }}
          >
            H
          </div>
          <h2 className="mt-4 font-display text-lg font-medium text-hearth-text" style={{ letterSpacing: -0.3 }}>
            Start a conversation
          </h2>
          <p className="mt-1 text-[13px] text-hearth-text-muted">
            Type a message below to begin.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-y-auto" ref={scrollContainerRef} onScroll={handleScroll} style={{ padding: '22px 28px' }}>
      <div className="mx-auto space-y-4" style={{ maxWidth: 'var(--hearth-content-max)' }}>
        {governanceBanner && (
          <div className="mx-auto mb-3 flex max-w-xl items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'color-mix(in srgb, var(--hearth-warn) 14%, transparent)', color: 'var(--hearth-warn)' }}>
            <HIcon name="lock" size={14} color="var(--hearth-warn)" />
            <span>This conversation is monitored per your organization's governance policies.</span>
          </div>
        )}
        {messages.map((msg) => {
          const authorName = isCollaborative && msg.createdBy && authors?.has(msg.createdBy) ? authors.get(msg.createdBy) : undefined;
          return (
            <div
              key={msg.id}
              className="group relative"
              onMouseEnter={() => setHoveredMessageId(msg.id)}
              onMouseLeave={() => setHoveredMessageId(null)}
            >
              {authorName && msg.role === 'user' && (
                <p className="mb-0.5 text-right text-[11px] text-hearth-text-faint">{authorName}</p>
              )}
              <MessageBubble message={msg} artifacts={artifacts} onOpenArtifact={onOpenArtifact} />

              {governanceWarnings?.has(msg.id) && (
                <div className="mt-1 flex items-center gap-1 text-xs" style={{ color: 'var(--hearth-warn)' }}>
                  <HIcon name="lock" size={12} color="var(--hearth-warn)" />
                  <span>{governanceWarnings.get(msg.id)}</span>
                </div>
              )}
              {governanceBlocks?.has(msg.id) && (
                <div className="mt-1 rounded-lg border p-2 text-sm" style={{ borderColor: 'var(--hearth-err)', background: 'color-mix(in srgb, var(--hearth-err) 8%, transparent)', color: 'var(--hearth-err)' }}>
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <HIcon name="lock" size={14} color="var(--hearth-err)" />
                    Message blocked
                  </div>
                  <p className="mt-0.5 text-xs">{governanceBlocks.get(msg.id)!.reason}</p>
                </div>
              )}

              {hoveredMessageId === msg.id && !readOnly && msg.id !== '__streaming__' && sessionId && (
                <MessageActions
                  messageId={msg.id}
                  sessionId={sessionId}
                  content={msg.content}
                  role={msg.role as 'user' | 'assistant'}
                  onRegenerate={msg.role === 'assistant' ? onRegenerate : undefined}
                  onDuplicate={msg.role === 'user' && onDuplicateFromMessage ? () => onDuplicateFromMessage(msg.id) : undefined}
                />
              )}
            </div>
          );
        })}
        {toolCalls.map((tc) => (
          <ToolCallCard key={tc.id} toolCall={tc} />
        ))}
        {thinking && <ThinkingIndicator content={thinking} />}
        {isStreaming && !thinking && messages[messages.length - 1]?.id !== '__streaming__' && (
          <ThinkingIndicator />
        )}
        <div ref={bottomRef} />
      </div>

      {showScrollButton && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-pill px-3.5 py-1.5 text-xs font-medium shadow-hearth-3 transition-opacity"
          style={{ background: 'var(--hearth-text)', color: 'var(--hearth-text-inverse)' }}
        >
          <span className="flex items-center gap-1.5">
            <HIcon name="arrow-down" size={12} color="var(--hearth-text-inverse)" />
            New messages
          </span>
        </button>
      )}
    </div>
  );
}
