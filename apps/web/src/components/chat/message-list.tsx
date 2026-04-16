import { useEffect, useRef, useState, useCallback } from 'react';
import type { ChatMessage } from '@hearth/shared';
import type { ToolCallInfo } from '@/hooks/use-chat';
import { MessageBubble } from './message-bubble';
import { ThinkingIndicator } from './thinking-indicator';
import { ToolCallCard } from './tool-call-card';

interface MessageAuthor {
  userId: string;
  name: string;
}

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  thinking: string | null;
  toolCalls: ToolCallInfo[];
  /** Map of userId -> name for displaying message authors in collaborative sessions */
  authors?: Map<string, string>;
  /** Whether this is a collaborative session (multiple authors) */
  isCollaborative?: boolean;
  /** Callback for "Duplicate from here" action */
  onDuplicateFromMessage?: (messageId: string) => void;
  /** Whether the user can interact (not a read-only viewer) */
  readOnly?: boolean;
}

export function MessageList({
  messages,
  isStreaming,
  thinking,
  toolCalls,
  authors,
  isCollaborative,
  onDuplicateFromMessage,
  readOnly,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking, toolCalls]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="text-center">
          <div className="text-4xl">&#128293;</div>
          <h2 className="mt-3 text-lg font-semibold text-gray-700">
            Start a conversation
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Type a message below to begin chatting with your AI assistant.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <div className="mx-auto max-w-3xl space-y-3">
        {messages.map((msg) => {
          const authorName =
            isCollaborative && msg.createdBy && authors?.has(msg.createdBy)
              ? authors.get(msg.createdBy)
              : undefined;

          return (
            <div
              key={msg.id}
              className="group relative"
              onMouseEnter={() => setHoveredMessageId(msg.id)}
              onMouseLeave={() => setHoveredMessageId(null)}
            >
              {/* Author label for collaborative sessions */}
              {authorName && msg.role === 'user' && (
                <p className="mb-0.5 text-right text-[11px] text-gray-400">{authorName}</p>
              )}

              <MessageBubble message={msg} />

              {/* Hover actions */}
              {hoveredMessageId === msg.id &&
                !readOnly &&
                onDuplicateFromMessage &&
                msg.id !== '__streaming__' && (
                  <div className="absolute -top-1 right-0 z-10 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => onDuplicateFromMessage(msg.id)}
                      className="rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-500 shadow-sm hover:bg-gray-50 hover:text-gray-700"
                      title="Duplicate from here"
                    >
                      Duplicate from here
                    </button>
                  </div>
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
    </div>
  );
}
