import { useEffect, useRef, useState, useCallback } from 'react';
import type { ChatMessage } from '@hearth/shared';
import type { ToolCallInfo } from '@/hooks/use-chat';
import type { Artifact } from '@/hooks/use-artifacts';
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
  /** Artifacts in this session, keyed by parentMessageId */
  artifacts?: Artifact[];
  /** Callback to open an artifact in the side panel */
  onOpenArtifact?: (id: string) => void;
  /** Whether governance monitoring is active with banner enabled */
  governanceBanner?: boolean;
  /** Governance warnings keyed by messageId */
  governanceWarnings?: Map<string, string>;
  /** Governance blocks keyed by messageId */
  governanceBlocks?: Map<string, { policyName: string; reason: string }>;
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
  artifacts,
  onOpenArtifact,
  governanceBanner,
  governanceWarnings,
  governanceBlocks,
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
        {governanceBanner && (
          <div className="mx-auto mb-3 flex max-w-xl items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" />
            </svg>
            <span>This conversation is monitored per your organization's governance policies.</span>
          </div>
        )}
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

              <MessageBubble message={msg} artifacts={artifacts} onOpenArtifact={onOpenArtifact} />

              {/* Governance warning indicator */}
              {governanceWarnings?.has(msg.id) && (
                <div className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10.339 2.237a.531.531 0 0 0-.678 0 11.947 11.947 0 0 1-7.078 2.75.5.5 0 0 0-.479.425A12.11 12.11 0 0 0 2 7c0 5.163 3.26 9.564 7.834 11.257a.48.48 0 0 0 .332 0C14.74 16.564 18 12.163 18 7c0-.538-.035-1.069-.104-1.589a.5.5 0 0 0-.48-.425 11.947 11.947 0 0 1-7.077-2.75Z" clipRule="evenodd" />
                  </svg>
                  <span>{governanceWarnings.get(msg.id)}</span>
                </div>
              )}

              {/* Governance blocked indicator */}
              {governanceBlocks?.has(msg.id) && (
                <div className="mt-1 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10.339 2.237a.531.531 0 0 0-.678 0 11.947 11.947 0 0 1-7.078 2.75.5.5 0 0 0-.479.425A12.11 12.11 0 0 0 2 7c0 5.163 3.26 9.564 7.834 11.257a.48.48 0 0 0 .332 0C14.74 16.564 18 12.163 18 7c0-.538-.035-1.069-.104-1.589a.5.5 0 0 0-.48-.425 11.947 11.947 0 0 1-7.077-2.75Z" clipRule="evenodd" />
                    </svg>
                    Message blocked
                  </div>
                  <p className="mt-0.5 text-xs">{governanceBlocks.get(msg.id)!.reason}</p>
                </div>
              )}

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
