import { useEffect, useRef, useState, useCallback } from 'react';
import type { ChatMessage, MessageAuthor } from '@hearth/shared';
import type { ToolCallInfo } from '@/hooks/use-chat';
import type { Artifact } from '@/hooks/use-artifacts';
import { MessageBubble } from './message-bubble';
import { ThinkingIndicator } from './thinking-indicator';
import { ToolCallCard } from './tool-call-card';
import { StarterPrompts } from './starter-prompts';
import { MessageActions } from './message-actions';
import { ReactionChips } from './reaction-chips';
import { TaskChip } from './task-chip';
import { TaskSuggestionCard } from './task-suggestion-card';
import { TaskShapeNudge } from './task-shape-nudge';
import { TaskProgressCard } from './task-progress-card';
import { RoutineNudge } from './routine-nudge';
import { detectTaskShape, deriveTaskTitle } from '@/lib/task-shape-detector';
import type { TaskChipInfo } from '@/hooks/use-chat';
import type { TaskSuggestionEvent } from '@hearth/shared';
import { HIcon } from '@/components/ui/icon';

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  thinking: string | null;
  toolCalls: ToolCallInfo[];
  authors?: Map<string, MessageAuthor>;
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
  /**
   * Frozen "what was new when I opened this" anchor. The "New" divider
   * renders above the message immediately after this id and never moves
   * while the session is open.
   */
  unreadAnchorId?: string | null;
  onMessageVisible?: (messageId: string) => void;
  taskChips?: Map<string, TaskChipInfo[]>;
  taskSuggestions?: Map<string, TaskSuggestionEvent>;
  onDismissTaskSuggestion?: (suggestionId: string) => void;
  onUnlinkTask?: (messageId: string, taskId: string) => void;
}

export function MessageList({
  messages, isStreaming, thinking, toolCalls, authors, isCollaborative,
  onDuplicateFromMessage, readOnly, artifacts, onOpenArtifact,
  governanceBanner, governanceWarnings, governanceBlocks,
  onStarterSelect, onRegenerate, sessionId,
  unreadAnchorId, onMessageVisible,
  taskChips, taskSuggestions, onDismissTaskSuggestion, onUnlinkTask,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // True only when the user has scrolled away AND new content has arrived
  // since they were last at the bottom. Plain scroll-up alone shouldn't
  // surface a "new messages" nag.
  const [hasNewWhileAway, setHasNewWhileAway] = useState(false);
  // Latches true once the user has reached the bottom of the list. The
  // unread divider is dismissed at that point — they've read everything.
  // Reset whenever the anchor changes (i.e. a new session is opened).
  const [dividerDismissed, setDividerDismissed] = useState(false);
  const userScrolledRef = useRef(false);
  const lastBottomCountRef = useRef(messages.length);

  useEffect(() => {
    setDividerDismissed(false);
  }, [unreadAnchorId]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNearBottom = distanceFromBottom < 200;
    userScrolledRef.current = !isNearBottom;
    if (isNearBottom) {
      setDividerDismissed(true);
      setHasNewWhileAway(false);
      lastBottomCountRef.current = messages.length;
    }
  }, [messages.length]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    userScrolledRef.current = false;
    setHasNewWhileAway(false);
    lastBottomCountRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    if (!userScrolledRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      lastBottomCountRef.current = messages.length;
      return;
    }
    // User is scrolled away — flag new-content arrival so the pill can show.
    if (messages.length > lastBottomCountRef.current) {
      setHasNewWhileAway(true);
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
            Iterate live with the AI. Type a message below to begin.
          </p>
          <p className="mt-3 text-[11.5px] text-hearth-text-faint">
            Want to step away while the agent works? Type <code className="rounded bg-hearth-chip px-1 py-0.5 font-mono text-[10.5px] text-hearth-text-muted">/task</code> or hover any message.
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
        {messages.map((msg, idx) => {
          // System task-progress messages render as compact progress cards
          // instead of normal bubbles. They have no chip / suggestion / actions.
          if (msg.role === 'system') {
            const meta = (msg.metadata ?? {}) as Record<string, unknown>;
            if (meta.kind === 'task_progress') {
              return (
                <TaskProgressCard
                  key={msg.id}
                  taskId={String(meta.taskId)}
                  taskTitle={String(meta.taskTitle ?? '')}
                  milestone={meta.milestone as 'started' | 'executing' | 'review' | 'done' | 'failed'}
                />
              );
            }
          }

          const author = msg.createdBy ? authors?.get(msg.createdBy) : undefined;
          const prev = messages[idx - 1];
          const showAuthor = !!isCollaborative && msg.role === 'user'
            && !!author
            && (prev?.role !== 'user' || prev?.createdBy !== msg.createdBy);
          const respondingToAuthor = msg.role === 'assistant' && msg.respondingToMessageId
            ? (() => {
                const target = messages.find((m) => m.id === msg.respondingToMessageId);
                return target?.createdBy ? authors?.get(target.createdBy) : undefined;
              })()
            : undefined;

          // Unread divider sits above the first message after the frozen
          // anchor — does not move while the session is open, and is
          // dismissed once the user reaches the bottom.
          const isFirstUnread = !!unreadAnchorId
            && !dividerDismissed
            && prev?.id === unreadAnchorId;

          return (
            <div key={msg.id}>
              {isFirstUnread && (
                <div className="my-2 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--hearth-accent)' }}>
                  <span className="h-px flex-1" style={{ background: 'var(--hearth-accent)' }} />
                  <span>New</span>
                  <span className="h-px flex-1" style={{ background: 'var(--hearth-accent)' }} />
                </div>
              )}
              <MessageRow
                message={msg}
                onVisible={onMessageVisible}
              >
              <MessageBubble
                message={msg}
                artifacts={artifacts}
                onOpenArtifact={onOpenArtifact}
                author={msg.role === 'user' ? author : undefined}
                showAuthor={showAuthor}
                respondingToAuthor={respondingToAuthor}
              />

              {sessionId && msg.id !== '__streaming__' && msg.reactions && msg.reactions.length > 0 && (
                <ReactionChips
                  sessionId={sessionId}
                  messageId={msg.id}
                  reactions={msg.reactions}
                  align={msg.role === 'user' ? 'end' : 'start'}
                />
              )}

              {taskChips?.get(msg.id)?.map((chip) => (
                <TaskChip
                  key={chip.taskId}
                  chip={chip}
                  align={msg.role === 'user' ? 'end' : 'start'}
                  onUnlink={onUnlinkTask}
                />
              ))}

              {taskSuggestions?.get(msg.id) && onDismissTaskSuggestion && (
                <TaskSuggestionCard
                  suggestion={taskSuggestions.get(msg.id)!}
                  onLocalDismiss={() => onDismissTaskSuggestion(taskSuggestions.get(msg.id)!.id)}
                />
              )}

              {/* "This looks like a task" nudge — only on assistant messages
                  with multi-step shape, no existing chip, no pending
                  suggestion, and not the streaming placeholder. */}
              {sessionId
                && msg.role === 'assistant'
                && msg.id !== '__streaming__'
                && !taskChips?.get(msg.id)?.length
                && !taskSuggestions?.get(msg.id)
                && (() => {
                  const sig = detectTaskShape(msg.content);
                  if (!sig.matches) return null;
                  return (
                    <TaskShapeNudge
                      sessionId={sessionId}
                      messageId={msg.id}
                      initialTitle={deriveTaskTitle(msg.content)}
                      dismissalKey={`hearth.task-nudge.dismissed.${sessionId}.${msg.id}`}
                    />
                  );
                })()}

              {/* "Make it a routine?" nudge — only on user messages, skip
                  optimistic placeholders. The hook calls the recurrence
                  endpoint and renders if ≥2 prior similar prompts exist. */}
              {sessionId
                && msg.role === 'user'
                && !msg.id.startsWith('user_')
                && msg.id !== '__streaming__'
                && msg.content && msg.content.length >= 10
                && (
                  <RoutineNudge
                    prompt={msg.content}
                    messageId={msg.id}
                    dismissalKey={`hearth.routine-nudge.dismissed.${sessionId}.${msg.id}`}
                  />
                )}

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

              {!readOnly && msg.id !== '__streaming__' && sessionId && (
                <MessageActions
                  messageId={msg.id}
                  sessionId={sessionId}
                  content={msg.content}
                  role={msg.role as 'user' | 'assistant'}
                  onRegenerate={msg.role === 'assistant' ? onRegenerate : undefined}
                  onDuplicate={msg.role === 'user' && onDuplicateFromMessage ? () => onDuplicateFromMessage(msg.id) : undefined}
                />
              )}
              </MessageRow>
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

      {hasNewWhileAway && (
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

interface MessageRowProps {
  message: ChatMessage;
  onVisible?: (messageId: string) => void;
  children: React.ReactNode;
}

function MessageRow({ message, onVisible, children }: MessageRowProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Mark as read after the message has been continuously visible for 1.5s.
  // Skip optimistic / streaming placeholders.
  useEffect(() => {
    if (!onVisible) return;
    if (message.id === '__streaming__' || message.id.startsWith('user_')) return;
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          timer = setTimeout(() => onVisible(message.id), 1500);
        } else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [message.id, onVisible]);

  return (
    <div
      ref={ref}
      className="group relative"
      data-message-id={message.id}
    >
      {children}
    </div>
  );
}
