import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api-client';
import {
  joinSession,
  leaveSession,
  onSessionEvent,
  onPresenceList,
  onPresenceJoin,
  onPresenceLeave,
  onTyping,
  onTypingStop,
  onComposing,
  onComposingStop,
  onPresenceState,
  onMessageReaction,
  onTaskCreatedFromChat,
  onTaskSuggested,
  onTaskSuggestionResolved,
  onTaskProgress,
  connectSocket,
} from '@/lib/socket-client';
import type {
  ChatMessage, AgentEvent, ApiResponse, PresenceUser, ComposingUser, PresenceState, MessageAuthor,
  TaskCreatedFromChatEvent, TaskSuggestionEvent,
} from '@hearth/shared';

export interface TaskChipInfo {
  taskId: string;
  title: string;
  status: string;
  createdAt: string;
  /** True only for chips that arrived this session via socket (not hydrated from history). Drives slide-in animation + undo affordance. */
  freshlyCreated?: boolean;
  /** Epoch ms when the chip was created on the client; used to gate the 5s undo window. */
  freshAt?: number;
  /** The originating message id — needed for the unlink call. */
  messageId?: string;
}

export interface TaskToastInfo {
  taskId: string;
  title: string;
  status: string;
  messageId: string;
  shownAt: number;
}

interface CognitiveQueryMeta {
  subjectUserId: string;
}

interface UseChatReturn {
  messages: ChatMessage[];
  sendMessage: (content: string, overrideSessionId?: string, activeArtifactId?: string, attachmentIds?: string[], cognitiveQuery?: CognitiveQueryMeta) => Promise<void>;
  retryLastMessage: () => void;
  regenerateMessage: () => void;
  isStreaming: boolean;
  thinking: string | null;
  toolCalls: ToolCallInfo[];
  error: string | null;
  presenceUsers: PresenceUser[];
  typingUsers: PresenceUser[];
  composingUsers: ComposingUser[];
  messageAuthors: Map<string, MessageAuthor>;
  /**
   * Frozen snapshot of the user's last-read message at the moment the
   * session was opened. Used to anchor the visual "New" divider so it
   * doesn't chase the user as they scroll. Cleared on session change.
   */
  unreadAnchorId: string | null;
  markRead: (messageId: string) => void;
  /** Tasks newly created from this session, keyed by originating messageId. */
  taskChips: Map<string, TaskChipInfo[]>;
  /** Pending AI task suggestions, keyed by originating messageId. */
  taskSuggestions: Map<string, TaskSuggestionEvent>;
  /** Locally dismiss a chip's undo affordance after the timer expires. */
  dismissTaskSuggestion: (suggestionId: string) => void;
  /** Most-recent task creation, used to render the transient toast. Null after auto-dismiss. */
  taskToast: TaskToastInfo | null;
  dismissTaskToast: () => void;
  /** Undo a freshly-created chip — archives the task and removes the chip locally. */
  unlinkTask: (messageId: string, taskId: string) => Promise<void>;
  /** Most recent side-effecting tool call this session, if any. UI surfaces a hint. */
  sideEffectNotice: { toolName: string; provider: string; shownAt: number } | null;
  dismissSideEffectNotice: () => void;
}

export interface ToolCallInfo {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: 'running' | 'done';
}

export function useChat(sessionId: string | null): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [thinking, setThinking] = useState<string | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<PresenceUser[]>([]);
  const [composingUsers, setComposingUsers] = useState<ComposingUser[]>([]);
  const [messageAuthors, setMessageAuthors] = useState<Map<string, MessageAuthor>>(new Map());
  const [unreadAnchorId, setUnreadAnchorId] = useState<string | null>(null);
  const [taskChips, setTaskChips] = useState<Map<string, TaskChipInfo[]>>(new Map());
  const [taskSuggestions, setTaskSuggestions] = useState<Map<string, TaskSuggestionEvent>>(new Map());
  const [taskToast, setTaskToast] = useState<TaskToastInfo | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sideEffectNotice, setSideEffectNotice] = useState<{ toolName: string; provider: string; shownAt: number } | null>(null);
  // Live last-read tracker (separate from the visual divider anchor). Used to
  // de-dupe markRead network calls so we don't POST for every viewport hit.
  const lastReadMessageIdRef = useRef<string | null>(null);
  const streamingContentRef = useRef('');
  const toolCallIdRef = useRef(0);
  const lastFailedContentRef = useRef<string | null>(null);

  // Track current subscription so sendMessage can set it up eagerly
  const subscribedSessionRef = useRef<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  // Ref for sessionId so the event handler closure never goes stale
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // Stable event handler — only references refs and state setters (stable)
  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'thinking':
        setThinking(event.content);
        setIsStreaming(true);
        break;

      case 'text_delta':
        setThinking(null);
        streamingContentRef.current += event.content;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && last.id === '__streaming__') {
            return [
              ...prev.slice(0, -1),
              { ...last, content: streamingContentRef.current },
            ];
          }
          return [
            ...prev,
            {
              id: '__streaming__',
              sessionId: sessionIdRef.current ?? '',
              role: 'assistant',
              content: streamingContentRef.current,
              metadata: {},
              createdAt: new Date().toISOString(),
            },
          ];
        });
        break;

      case 'tool_call_start': {
        const id = `tc_${++toolCallIdRef.current}`;
        setToolCalls((prev) => [
          ...prev,
          { id, tool: event.tool, input: event.input, status: 'running' },
        ]);
        break;
      }

      case 'tool_call_result':
        setToolCalls((prev) => {
          let idx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].tool === event.tool && prev[i].status === 'running') {
              idx = i;
              break;
            }
          }
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            output: event.output,
            status: 'done',
          };
          return updated;
        });
        break;

      case 'error':
        setError(event.message);
        setIsStreaming(false);
        setThinking(null);
        // lastFailedContentRef is set by the sendMessage catch block for HTTP errors.
        // For SSE errors, the content was already sent; retry isn't useful.
        break;

      case 'side_effect':
        // Show inline notice once per agent run; auto-clears on dismiss.
        setSideEffectNotice({ toolName: event.toolName, provider: event.provider, shownAt: Date.now() });
        break;

      case 'done':
        setIsStreaming(false);
        setThinking(null);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.id === '__streaming__') {
            return [
              ...prev.slice(0, -1),
              { ...last, id: `msg_${Date.now()}` },
            ];
          }
          return prev;
        });
        streamingContentRef.current = '';
        setToolCalls([]);
        break;
    }
  }, []);

  // Subscribe to a session's WebSocket events. Idempotent — skips if already subscribed.
  const subscribe = useCallback(
    (sid: string) => {
      if (subscribedSessionRef.current === sid) return;

      // Tear down previous subscription
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      connectSocket();
      joinSession(sid);
      const unsubAgent = onSessionEvent(sid, handleEvent);

      // Presence subscriptions
      const unsubList = onPresenceList((members) => {
        setPresenceUsers(members);
      });
      const unsubJoin = onPresenceJoin((user) => {
        setPresenceUsers((prev) => {
          if (prev.some((p) => p.userId === user.userId)) return prev;
          return [...prev, user];
        });
        // Merge into authors map so a teammate who joins mid-session is
        // attributed correctly when they post.
        setMessageAuthors((prev) => {
          if (prev.has(user.userId)) return prev;
          const next = new Map(prev);
          next.set(user.userId, { id: user.userId, name: user.name });
          return next;
        });
      });
      const unsubLeave = onPresenceLeave((user) => {
        setPresenceUsers((prev) => prev.filter((p) => p.userId !== user.userId));
        setTypingUsers((prev) => prev.filter((p) => p.userId !== user.userId));
        setComposingUsers((prev) => prev.filter((p) => p.userId !== user.userId));
      });

      const unsubTyping = onTyping((user) => {
        setTypingUsers((prev) => {
          if (prev.some((p) => p.userId === user.userId)) return prev;
          return [...prev, user];
        });
      });
      const unsubTypingStop = onTypingStop(({ userId }) => {
        setTypingUsers((prev) => prev.filter((p) => p.userId !== userId));
      });
      const unsubComposing = onComposing((user) => {
        setComposingUsers((prev) => {
          const idx = prev.findIndex((p) => p.userId === user.userId);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = user;
            return next;
          }
          return [...prev, user];
        });
      });
      const unsubComposingStop = onComposingStop(({ userId }) => {
        setComposingUsers((prev) => prev.filter((p) => p.userId !== userId));
      });
      const unsubState = onPresenceState(({ userId, state }) => {
        setPresenceUsers((prev) =>
          prev.map((p) => (p.userId === userId ? { ...p, state } : p)),
        );
      });

      const unsubTaskCreated = onTaskCreatedFromChat((e: TaskCreatedFromChatEvent) => {
        if (e.sessionId !== sid || !e.originatingMessageId) return;
        const now = Date.now();
        setTaskChips((prev) => {
          const next = new Map(prev);
          const list = next.get(e.originatingMessageId!) ?? [];
          if (list.some((c) => c.taskId === e.taskId)) return prev;
          next.set(e.originatingMessageId!, [
            ...list,
            {
              taskId: e.taskId,
              title: e.title,
              status: e.status,
              createdAt: new Date().toISOString(),
              freshlyCreated: !e.existing,
              freshAt: e.existing ? undefined : now,
              messageId: e.originatingMessageId!,
            },
          ]);
          return next;
        });
        // If this task came from accepting a suggestion, clear the suggestion card.
        setTaskSuggestions((prev) => {
          if (!prev.has(e.originatingMessageId!)) return prev;
          const next = new Map(prev);
          next.delete(e.originatingMessageId!);
          return next;
        });
        // Show transient toast (skip if this was an idempotent re-promote).
        if (!e.existing) {
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          setTaskToast({
            taskId: e.taskId,
            title: e.title,
            status: e.status,
            messageId: e.originatingMessageId!,
            shownAt: now,
          });
          toastTimerRef.current = setTimeout(() => setTaskToast(null), 5000);
        }
      });

      const unsubTaskSuggested = onTaskSuggested((e: TaskSuggestionEvent) => {
        if (e.sessionId !== sid) return;
        setTaskSuggestions((prev) => {
          const next = new Map(prev);
          next.set(e.messageId, e);
          return next;
        });
      });

      const unsubTaskSuggestionResolved = onTaskSuggestionResolved((e) => {
        setTaskSuggestions((prev) => {
          let changed = false;
          const next = new Map(prev);
          for (const [mid, sug] of prev) {
            if (sug.id === e.suggestionId) {
              next.delete(mid);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      });

      const unsubTaskProgress = onTaskProgress((e) => {
        // Append a synthetic system message so the progress card renders
        // immediately. The real message exists in DB; this avoids a refetch.
        setMessages((prev) => {
          const synthetic: ChatMessage = {
            id: `task_progress_${e.taskId}_${e.milestone}_${Date.now()}`,
            sessionId: sid,
            role: 'system',
            content: `${e.milestone}: ${e.taskTitle}`,
            metadata: {
              kind: 'task_progress',
              taskId: e.taskId,
              milestone: e.milestone,
              taskTitle: e.taskTitle,
              taskStatus: e.taskStatus,
            },
            createdBy: null,
            createdAt: new Date().toISOString(),
          };
          // Avoid duplicate cards if the user just reloaded; check the last
          // few messages for the same milestone+taskId.
          const tailWindow = prev.slice(-8);
          const dup = tailWindow.some((m) => {
            const meta = (m.metadata ?? {}) as Record<string, unknown>;
            return meta.kind === 'task_progress' && meta.taskId === e.taskId && meta.milestone === e.milestone;
          });
          if (dup) return prev;
          return [...prev, synthetic];
        });
      });

      const unsubReaction = onMessageReaction(({ messageId, userId, emoji, op }) => {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId) return m;
            const reactions = (m.reactions ?? []).slice();
            const idx = reactions.findIndex((r) => r.emoji === emoji);
            if (op === 'add') {
              if (idx >= 0) {
                if (reactions[idx].userIds.includes(userId)) return m;
                reactions[idx] = {
                  ...reactions[idx],
                  count: reactions[idx].count + 1,
                  userIds: [...reactions[idx].userIds, userId],
                };
              } else {
                reactions.push({ emoji, count: 1, userIds: [userId] });
              }
            } else if (idx >= 0) {
              const userIds = reactions[idx].userIds.filter((u) => u !== userId);
              if (userIds.length === 0) reactions.splice(idx, 1);
              else reactions[idx] = { ...reactions[idx], count: userIds.length, userIds };
            }
            return { ...m, reactions };
          }),
        );
      });

      subscribedSessionRef.current = sid;
      cleanupRef.current = () => {
        unsubAgent();
        unsubList();
        unsubJoin();
        unsubLeave();
        unsubTyping();
        unsubTypingStop();
        unsubComposing();
        unsubComposingStop();
        unsubState();
        unsubReaction();
        unsubTaskCreated();
        unsubTaskSuggested();
        unsubTaskSuggestionResolved();
        unsubTaskProgress();
        leaveSession(sid);
        subscribedSessionRef.current = null;
        setPresenceUsers([]);
        setTypingUsers([]);
        setComposingUsers([]);
      };
    },
    [handleEvent],
  );

  // Load messages and subscribe when sessionId changes
  useEffect(() => {
    // Reset per-session state on session change.
    setUnreadAnchorId(null);
    lastReadMessageIdRef.current = null;
    setTaskChips(new Map());
    setTaskSuggestions(new Map());
    setTaskToast(null);
    setSideEffectNotice(null);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }

    if (!sessionId) {
      setMessages([]);
      setPresenceUsers([]);
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      return;
    }

    // Subscribe (no-op if sendMessage already did it)
    subscribe(sessionId);

    api
      .get<ApiResponse<{
        session: unknown;
        messages: ChatMessage[];
        messageAuthors?: Record<string, MessageAuthor>;
        lastReadMessageId?: string | null;
      }>>(
        `/chat/sessions/${sessionId}`,
      )
      .then((res) => {
        if (res.data) {
          setMessages((prev) => {
            const serverMessages = res.data!.messages;
            // Deduplicate by role+content so optimistic messages don't duplicate
            // server-persisted messages (which have different IDs)
            const serverKeys = new Set(
              serverMessages.map((m) => `${m.role}:${m.content}`),
            );
            const optimistic = prev.filter(
              (m) =>
                (m.id.startsWith('user_') || m.id === '__streaming__') &&
                !serverKeys.has(`${m.role}:${m.content}`),
            );
            return [...serverMessages, ...optimistic];
          });
          if (res.data.messageAuthors) {
            const map = new Map<string, MessageAuthor>();
            for (const [id, a] of Object.entries(res.data.messageAuthors)) map.set(id, a);
            setMessageAuthors(map);
          }
          // Snapshot the divider position once per session-open. This is
          // the "what was new when I opened this" anchor — never moves
          // while the session is open.
          setUnreadAnchorId(res.data.lastReadMessageId ?? null);
          lastReadMessageIdRef.current = res.data.lastReadMessageId ?? null;

          // Hydrate task chips from producedTaskIds on each message.
          const chipMap = new Map<string, TaskChipInfo[]>();
          for (const m of res.data.messages) {
            const ids = m.producedTaskIds ?? [];
            if (ids.length === 0) continue;
            chipMap.set(
              m.id,
              ids.map((tid) => ({ taskId: tid, title: 'Task', status: 'backlog', createdAt: m.createdAt })),
            );
          }
          setTaskChips(chipMap);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load messages');
      });

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [sessionId, subscribe]);

  const sendMessage = useCallback(
    async (content: string, overrideSessionId?: string, activeArtifactId?: string, attachmentIds?: string[], cognitiveQuery?: CognitiveQueryMeta) => {
      const sid = overrideSessionId ?? sessionId;
      if (!sid) return;

      // CRITICAL: subscribe BEFORE posting so we never miss WebSocket events
      subscribe(sid);

      setError(null);
      streamingContentRef.current = '';

      const userMsg: ChatMessage = {
        id: `user_${Date.now()}`,
        sessionId: sid,
        role: 'user',
        content,
        metadata: {},
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);

      try {
        const body: Record<string, unknown> = { content };
        if (activeArtifactId) {
          body.activeArtifactId = activeArtifactId;
        }
        if (attachmentIds && attachmentIds.length > 0) {
          body.attachmentIds = attachmentIds;
        }

        if (cognitiveQuery) {
          body.cognitiveQuery = cognitiveQuery;
        }

        await api.post(`/chat/sessions/${sid}/messages`, body);
      } catch (err) {
        lastFailedContentRef.current = content;
        setError(err instanceof Error ? err.message : 'Failed to send message');
        setIsStreaming(false);
      }
    },
    [sessionId, subscribe],
  );

  const retryLastMessage = useCallback(() => {
    const content = lastFailedContentRef.current;
    if (!content) return;
    lastFailedContentRef.current = null;
    setError(null);
    sendMessage(content);
  }, [sendMessage]);

  const dismissSideEffectNotice = useCallback(() => setSideEffectNotice(null), []);

  const dismissTaskToast = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setTaskToast(null);
  }, []);

  const unlinkTask = useCallback(async (messageId: string, taskId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    // Optimistic local removal of the chip + close toast.
    setTaskChips((prev) => {
      const list = prev.get(messageId);
      if (!list) return prev;
      const filtered = list.filter((c) => c.taskId !== taskId);
      const next = new Map(prev);
      if (filtered.length === 0) next.delete(messageId);
      else next.set(messageId, filtered);
      return next;
    });
    setTaskToast((prev) => (prev?.taskId === taskId ? null : prev));
    try {
      await api.post(`/chat/sessions/${sid}/messages/${messageId}/tasks/${taskId}/unlink`);
    } catch {
      // Best-effort. The chip stays gone locally; on next session reload
      // it'll come back if the server didn't actually unlink.
    }
  }, []);

  const dismissTaskSuggestion = useCallback((suggestionId: string) => {
    setTaskSuggestions((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [mid, sug] of prev) {
        if (sug.id === suggestionId) {
          next.delete(mid);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const markRead = useCallback(
    (messageId: string) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      // Skip optimistic placeholders (defensive — MessageRow already filters).
      if (messageId === '__streaming__' || messageId.startsWith('user_')) return;
      // Dedupe: if the same message was already marked read for this open
      // session, skip the network call. This intentionally does NOT touch
      // the divider anchor — the divider is frozen once per session-open.
      if (lastReadMessageIdRef.current === messageId) return;
      lastReadMessageIdRef.current = messageId;
      api.post(`/chat/sessions/${sid}/read`, { lastMessageId: messageId }).catch(() => {
        // Read receipts are best-effort; swallow errors so UI stays clean.
      });
    },
    [],
  );

  const regenerateMessage = useCallback(() => {
    // Find the last user message, remove the following assistant message, and re-send
    setMessages((prev) => {
      const lastAssistantIdx = prev.length - 1;
      if (lastAssistantIdx < 0 || prev[lastAssistantIdx].role !== 'assistant') return prev;
      // Find the user message before it
      let userIdx = lastAssistantIdx - 1;
      while (userIdx >= 0 && prev[userIdx].role !== 'user') userIdx--;
      if (userIdx < 0) return prev;
      const userContent = prev[userIdx].content;
      // Remove the assistant message
      const updated = prev.slice(0, lastAssistantIdx);
      // Trigger re-send after state update
      setTimeout(() => sendMessage(userContent), 0);
      return updated;
    });
  }, [sendMessage]);

  return {
    messages, sendMessage, retryLastMessage, regenerateMessage,
    isStreaming, thinking, toolCalls, error, presenceUsers,
    typingUsers, composingUsers,
    messageAuthors, unreadAnchorId, markRead,
    taskChips, taskSuggestions, dismissTaskSuggestion,
    taskToast, dismissTaskToast, unlinkTask,
    sideEffectNotice, dismissSideEffectNotice,
  };
}
