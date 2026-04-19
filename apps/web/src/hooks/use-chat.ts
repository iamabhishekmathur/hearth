import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api-client';
import {
  joinSession,
  leaveSession,
  onSessionEvent,
  onPresenceList,
  onPresenceJoin,
  onPresenceLeave,
  connectSocket,
} from '@/lib/socket-client';
import type { ChatMessage, AgentEvent, ApiResponse, PresenceUser } from '@hearth/shared';

interface CognitiveQueryMeta {
  subjectUserId: string;
}

interface UseChatReturn {
  messages: ChatMessage[];
  sendMessage: (content: string, overrideSessionId?: string, activeArtifactId?: string, attachmentIds?: string[], cognitiveQuery?: CognitiveQueryMeta) => Promise<void>;
  isStreaming: boolean;
  thinking: string | null;
  toolCalls: ToolCallInfo[];
  error: string | null;
  presenceUsers: PresenceUser[];
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
  const streamingContentRef = useRef('');
  const toolCallIdRef = useRef(0);

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
      });
      const unsubLeave = onPresenceLeave((user) => {
        setPresenceUsers((prev) => prev.filter((p) => p.userId !== user.userId));
      });

      subscribedSessionRef.current = sid;
      cleanupRef.current = () => {
        unsubAgent();
        unsubList();
        unsubJoin();
        unsubLeave();
        leaveSession(sid);
        subscribedSessionRef.current = null;
        setPresenceUsers([]);
      };
    },
    [handleEvent],
  );

  // Load messages and subscribe when sessionId changes
  useEffect(() => {
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
      .get<ApiResponse<{ session: unknown; messages: ChatMessage[] }>>(
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
        setError(err instanceof Error ? err.message : 'Failed to send message');
        setIsStreaming(false);
      }
    },
    [sessionId, subscribe],
  );

  return { messages, sendMessage, isStreaming, thinking, toolCalls, error, presenceUsers };
}
