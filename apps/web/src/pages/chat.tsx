import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useChat } from '@/hooks/use-chat';
import { useSessions } from '@/hooks/use-sessions';
import { api } from '@/lib/api-client';
import { MessageList } from '@/components/chat/message-list';
import { ChatInput } from '@/components/chat/chat-input';
import { SessionTabs } from '@/components/chat/session-tabs';
import { ShareDialog } from '@/components/chat/share-dialog';
import type { PresenceUser, SessionVisibility } from '@hearth/shared';

export function ChatPage() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // Open tab IDs — tracks which sessions are visible as tabs (subset of all sessions)
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const { sessions, createSession, renameSession, deleteSession, refreshSessions } = useSessions();
  const [showShareDialog, setShowShareDialog] = useState(false);
  const { messages, sendMessage, isStreaming, thinking, toolCalls, error, presenceUsers } =
    useChat(activeSessionId);

  // Track session metadata for the active session
  const [activeVisibility, setActiveVisibility] = useState<SessionVisibility>('private');
  const [activeSessionOwnerId, setActiveSessionOwnerId] = useState<string | null>(null);
  const [messageAuthors, setMessageAuthors] = useState<Map<string, string>>(new Map());

  // Sessions that are open as tabs (preserves tab order)
  const openSessions = useMemo(
    () => openTabIds.map((id) => sessions.find((s) => s.id === id)).filter(Boolean) as typeof sessions,
    [openTabIds, sessions],
  );

  // Refresh sessions when streaming ends so the auto-generated title appears
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      refreshSessions();
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, refreshSessions]);

  // Update active session metadata when session data loads
  useEffect(() => {
    if (!activeSessionId) {
      setActiveVisibility('private');
      setActiveSessionOwnerId(null);
      return;
    }
    const session = sessions.find((s) => s.id === activeSessionId);
    if (session) {
      setActiveVisibility((session as { visibility?: SessionVisibility }).visibility ?? 'private');
      setActiveSessionOwnerId(session.userId);
    }
  }, [activeSessionId, sessions]);

  // Build author map from messages with createdBy
  useEffect(() => {
    const authorIds = new Set<string>();
    for (const msg of messages) {
      if (msg.createdBy) authorIds.add(msg.createdBy);
    }
    // Also include presence users
    for (const p of presenceUsers) {
      if (!messageAuthors.has(p.userId)) {
        setMessageAuthors((prev) => {
          const next = new Map(prev);
          next.set(p.userId, p.name);
          return next;
        });
      }
    }
    // We rely on presence data for names; no extra fetch needed
  }, [messages, presenceUsers]);

  const isCollaborative = useMemo(() => {
    const authors = new Set<string | null | undefined>();
    for (const msg of messages) {
      if (msg.role === 'user' && msg.createdBy) authors.add(msg.createdBy);
    }
    return authors.size > 1;
  }, [messages]);

  // Open a session as a tab and make it active
  const handleSelectSession = useCallback((id: string) => {
    setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveSessionId(id);
  }, []);

  const handleSendMessage = useCallback(
    async (content: string) => {
      let sessionId = activeSessionId;

      // Create a new session if none is selected
      if (!sessionId) {
        try {
          const session = await createSession();
          sessionId = session.id;
          setOpenTabIds((prev) => [...prev, sessionId!]);
          setActiveSessionId(sessionId);
        } catch {
          return;
        }
      }

      sendMessage(content, sessionId);
    },
    [activeSessionId, createSession, sendMessage],
  );

  const handleNewSession = useCallback(() => {
    setActiveSessionId(null);
  }, []);

  // Close tab — just removes from open tabs, session persists in history
  const handleCloseTab = useCallback(
    (id: string) => {
      setOpenTabIds((prev) => {
        const idx = prev.indexOf(id);
        const remaining = prev.filter((tid) => tid !== id);
        if (activeSessionId === id) {
          const next = remaining[Math.min(idx, remaining.length - 1)] ?? null;
          setActiveSessionId(next);
        }
        return remaining;
      });
    },
    [activeSessionId],
  );

  // Delete session — removes from API + tabs + history
  const handleDeleteSession = useCallback(
    async (id: string) => {
      await deleteSession(id);
      setOpenTabIds((prev) => prev.filter((tid) => tid !== id));
      if (activeSessionId === id) {
        setActiveSessionId(null);
      }
    },
    [activeSessionId, deleteSession],
  );

  const handleVisibilityChange = useCallback((vis: 'private' | 'org') => {
    setActiveVisibility(vis);
  }, []);

  const handleDuplicateFromMessage = useCallback(
    async (messageId: string) => {
      if (!activeSessionId) return;
      try {
        const res = await api.post<{ data: { id: string } }>(
          `/chat/sessions/${activeSessionId}/duplicate`,
          { upToMessageId: messageId },
        );
        if (res.data) {
          await refreshSessions();
          handleSelectSession(res.data.id);
        }
      } catch {
        // Silently fail — user will see no new tab open
      }
    },
    [activeSessionId, refreshSessions, handleSelectSession],
  );

  const handleJoinSession = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      await api.post(`/chat/sessions/${activeSessionId}/join`);
      // Refresh to get updated access
      refreshSessions();
    } catch {
      // Silently fail
    }
  }, [activeSessionId, refreshSessions]);

  // Determine access level for active session
  // TODO: This is a simplification — in production we'd get this from the session data
  const isOwner = activeSessionOwnerId === null || sessions.some(
    (s) => s.id === activeSessionId && s.userId === activeSessionOwnerId,
  );

  return (
    <div className="flex h-full flex-col">
      {/* Session tabs */}
      <SessionTabs
        sessions={openSessions}
        activeSessionId={activeSessionId}
        onSelect={handleSelectSession}
        onNew={handleNewSession}
        onClose={handleCloseTab}
        onRename={renameSession}
        onDelete={handleDeleteSession}
      />

      {/* Main chat area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header — share button + presence avatars */}
        {activeSessionId && (
          <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-1.5">
            {/* Presence avatars */}
            <div className="flex items-center gap-1">
              {presenceUsers.length > 1 && (
                <PresenceAvatars users={presenceUsers} />
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowShareDialog(true)}
              className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            >
              Share
            </button>
          </div>
        )}

        {/* Share dialog */}
        {showShareDialog && activeSessionId && (
          <ShareDialog
            sessionId={activeSessionId}
            visibility={activeVisibility}
            onClose={() => setShowShareDialog(false)}
            onVisibilityChange={handleVisibilityChange}
          />
        )}

        {/* Error banner */}
        {error && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Messages */}
        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          thinking={thinking}
          toolCalls={toolCalls}
          authors={messageAuthors}
          isCollaborative={isCollaborative}
          onDuplicateFromMessage={handleDuplicateFromMessage}
        />

        {/* Input — shows access prompt for non-contributors viewing org-shared sessions */}
        <ChatInput
          onSend={handleSendMessage}
          disabled={isStreaming}
          accessPrompt={
            activeVisibility === 'org' && !isOwner
              ? { label: 'Join conversation', onClick: handleJoinSession }
              : undefined
          }
        />
      </div>
    </div>
  );
}

/**
 * Renders a row of small user avatar circles for presence display.
 * Only shown when >1 person is in the session.
 */
function PresenceAvatars({ users }: { users: PresenceUser[] }) {
  return (
    <div className="flex items-center -space-x-1">
      {users.slice(0, 5).map((user) => (
        <span
          key={user.userId}
          title={user.name}
          className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-hearth-100 text-[10px] font-medium text-hearth-700"
        >
          {user.name.charAt(0).toUpperCase()}
        </span>
      ))}
      {users.length > 5 && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gray-100 text-[10px] font-medium text-gray-500">
          +{users.length - 5}
        </span>
      )}
    </div>
  );
}
