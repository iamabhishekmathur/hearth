import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useChat } from '@/hooks/use-chat';
import { useSessions } from '@/hooks/use-sessions';
import { useArtifacts } from '@/hooks/use-artifacts';
import { useUnreadCounts } from '@/hooks/use-unread-counts';
import { useActiveSessionTasks } from '@/hooks/use-active-session-tasks';
import { api } from '@/lib/api-client';
import { MessageList } from '@/components/chat/message-list';
import { TaskToast } from '@/components/chat/task-toast';
import { SideEffectNotice } from '@/components/chat/side-effect-notice';
import { ChatInput, type PendingAttachment, type MentionUser } from '@/components/chat/chat-input';
import { SessionTabs } from '@/components/chat/session-tabs';
import { ShareDialog } from '@/components/chat/share-dialog';
import { ArtifactPanel } from '@/components/chat/artifact-panel';
import { ArtifactDrawer } from '@/components/chat/artifact-drawer';
import { MemoryDebugPanel } from '@/components/chat/memory-debug-panel';
import { IntegrationsIndicator } from '@/components/chat/integrations-indicator';
import { uploadFile } from '@/lib/upload-client';
import { getSocket } from '@/lib/socket-client';
import type { PresenceUser, SessionVisibility } from '@hearth/shared';
import { HEyebrow, HPill, HChip, HKbd, HButton, HAvatar } from '@/components/ui/primitives';
import { HIcon } from '@/components/ui/icon';

export function ChatPage() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const { sessions, createSession, renameSession, deleteSession, refreshSessions } = useSessions();
  const { counts: unreadCounts, refresh: refreshUnread, clearForSession: clearUnread } = useUnreadCounts();
  const activeTasks = useActiveSessionTasks(activeSessionId);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const {
    messages, sendMessage, retryLastMessage, regenerateMessage,
    isStreaming, thinking, toolCalls, error, presenceUsers,
    typingUsers, composingUsers,
    messageAuthors, unreadAnchorId, markRead,
    taskChips, taskSuggestions, dismissTaskSuggestion,
    taskToast, dismissTaskToast, unlinkTask,
    sideEffectNotice, dismissSideEffectNotice,
  } = useChat(activeSessionId);
  const {
    artifacts, activeArtifact, panelOpen, versions,
    openArtifact, closePanel, togglePanel, fetchVersions, saveArtifactContent,
  } = useArtifacts(activeSessionId);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const [activeVisibility, setActiveVisibility] = useState<SessionVisibility>('private');
  const [activeSessionOwnerId, setActiveSessionOwnerId] = useState<string | null>(null);

  const openSessions = useMemo(
    () => openTabIds.map((id) => sessions.find((s) => s.id === id)).filter(Boolean) as typeof sessions,
    [openTabIds, sessions],
  );

  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      refreshSessions();
      void refreshUnread();
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, refreshSessions, refreshUnread]);

  // Clear local unread badge as soon as the user opens a session (the
  // IntersectionObserver's markRead will catch up server-side).
  useEffect(() => {
    if (activeSessionId) clearUnread(activeSessionId);
  }, [activeSessionId, clearUnread]);

  // Deep-link from task panel: #/chat?sessionId=...&messageId=...
  useEffect(() => {
    const hash = window.location.hash;
    const queryStart = hash.indexOf('?');
    if (queryStart === -1) return;
    const params = new URLSearchParams(hash.slice(queryStart + 1));
    const sid = params.get('sessionId');
    if (sid) {
      setOpenTabIds((prev) => (prev.includes(sid) ? prev : [...prev, sid]));
      setActiveSessionId(sid);
    }
  }, []);

  // Scroll to highlighted message when ?messageId= is present.
  useEffect(() => {
    if (!activeSessionId || messages.length === 0) return;
    const hash = window.location.hash;
    const queryStart = hash.indexOf('?');
    if (queryStart === -1) return;
    const params = new URLSearchParams(hash.slice(queryStart + 1));
    const mid = params.get('messageId');
    if (!mid) return;
    // Wait one tick for the message list to render
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-message-id="${mid}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('chat-msg-highlight');
        setTimeout(() => el.classList.remove('chat-msg-highlight'), 2000);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [activeSessionId, messages.length]);

  useEffect(() => {
    if (!activeSessionId) { setActiveVisibility('private'); setActiveSessionOwnerId(null); return; }
    const session = sessions.find((s) => s.id === activeSessionId);
    if (session) {
      setActiveVisibility((session as { visibility?: SessionVisibility }).visibility ?? 'private');
      setActiveSessionOwnerId(session.userId);
    }
  }, [activeSessionId, sessions]);

  const isCollaborative = useMemo(() => {
    const authors = new Set<string | null | undefined>();
    for (const msg of messages) { if (msg.role === 'user' && msg.createdBy) authors.add(msg.createdBy); }
    return authors.size > 1;
  }, [messages]);

  const handleSelectSession = useCallback((id: string) => {
    setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveSessionId(id);
  }, []);

  // Memory debug panel (dev mode)
  const [debugInfo, setDebugInfo] = useState<{ sources: Array<{ index: number; type: string; label: string; content: string }>; rollingSummary: string | null; timestamp: string } | null>(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const isDev = import.meta.env.DEV;

  useEffect(() => {
    if (!isDev) return;
    const socket = getSocket();
    if (!socket) return;
    const handler = (info: typeof debugInfo) => setDebugInfo(info);
    socket.on('memory:debug', handler);
    return () => { socket.off('memory:debug', handler); };
  }, [isDev]);

  const [cognitiveEnabled, setCognitiveEnabled] = useState(false);
  useEffect(() => {
    api.get<{ data: { orgEnabled: boolean } }>('/chat/cognitive-profile/status')
      .then((res) => setCognitiveEnabled(res.data.orgEnabled))
      .catch(() => {});
  }, []);

  const handleSendMessage = useCallback(
    async (content: string, attachments: PendingAttachment[], mentionUser?: MentionUser) => {
      let sessionId = activeSessionId;
      if (!sessionId) {
        try {
          const session = await createSession();
          sessionId = session.id;
          setOpenTabIds((prev) => [...prev, sessionId!]);
          setActiveSessionId(sessionId);
        } catch { return; }
      }
      let attachmentIds: string[] = [];
      if (attachments.length > 0) {
        const results = await Promise.all(attachments.map((att) => uploadFile(att.file)));
        attachmentIds = results.filter((r) => r !== null).map((r) => r!.id);
      }
      sendMessage(content, sessionId, activeArtifact?.id, attachmentIds.length > 0 ? attachmentIds : undefined, mentionUser ? { subjectUserId: mentionUser.id } : undefined);
    },
    [activeSessionId, createSession, sendMessage, activeArtifact],
  );

  const handleNewSession = useCallback(() => setActiveSessionId(null), []);

  const handleCloseTab = useCallback((id: string) => {
    setOpenTabIds((prev) => {
      const idx = prev.indexOf(id);
      const remaining = prev.filter((tid) => tid !== id);
      if (activeSessionId === id) { setActiveSessionId(remaining[Math.min(idx, remaining.length - 1)] ?? null); }
      return remaining;
    });
  }, [activeSessionId]);

  const handleDeleteSession = useCallback(async (id: string) => {
    await deleteSession(id);
    setOpenTabIds((prev) => prev.filter((tid) => tid !== id));
    if (activeSessionId === id) setActiveSessionId(null);
  }, [activeSessionId, deleteSession]);

  const handleVisibilityChange = useCallback((vis: 'private' | 'org') => setActiveVisibility(vis), []);

  const handleDuplicateFromMessage = useCallback(async (messageId: string) => {
    if (!activeSessionId) return;
    try {
      const res = await api.post<{ data: { id: string } }>(`/chat/sessions/${activeSessionId}/duplicate`, { upToMessageId: messageId });
      if (res.data) { await refreshSessions(); handleSelectSession(res.data.id); }
    } catch { /* noop */ }
  }, [activeSessionId, refreshSessions, handleSelectSession]);

  const handleJoinSession = useCallback(async () => {
    if (!activeSessionId) return;
    try { await api.post(`/chat/sessions/${activeSessionId}/join`); refreshSessions(); } catch { /* noop */ }
  }, [activeSessionId, refreshSessions]);

  const isOwner = activeSessionOwnerId === null || sessions.some((s) => s.id === activeSessionId && s.userId === activeSessionOwnerId);

  return (
    <div className="flex h-full flex-col font-sans text-hearth-text">
      {/* Page header — matches the canonical pattern used across all routes */}
      <div className="border-b border-hearth-border px-6 py-4">
        <HEyebrow>Conversations</HEyebrow>
        <h1 className="mt-1 font-display text-[22px] font-medium" style={{ letterSpacing: '-0.4px', lineHeight: 1.2 }}>
          Chat<span style={{ color: 'var(--hearth-accent)' }}>.</span>
        </h1>
      </div>

      {/* Session pill tabs — matching design's pill row style */}
      <SessionTabs
        sessions={openSessions}
        activeSessionId={activeSessionId}
        onSelect={handleSelectSession}
        onNew={handleNewSession}
        onClose={handleCloseTab}
        onRename={renameSession}
        onDelete={handleDeleteSession}
        unreadCounts={unreadCounts}
      />

      {/* Main chat area + artifact panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className={`relative flex flex-col overflow-hidden ${panelOpen && activeArtifact && !isMobile ? 'w-2/5 min-w-[320px]' : 'flex-1'}`}>
          {taskToast && (
            <TaskToast toast={taskToast} onDismiss={dismissTaskToast} onUndo={unlinkTask} />
          )}
          {/* Header bar */}
          {activeSessionId && (
            <div key={activeSessionId} className="flex items-center justify-between border-b border-hearth-border bg-hearth-bg px-5 py-2 animate-fade-in">
              <div className="flex items-center gap-3">
                {presenceUsers.length > 1 && <PresenceAvatars users={presenceUsers} />}
                <IntegrationsIndicator />
                {activeTasks.count > 0 && (
                  <a
                    href={
                      activeTasks.firstTaskId
                        ? `#/tasks?taskId=${activeTasks.firstTaskId}`
                        : '#/tasks'
                    }
                    className="inline-flex items-center gap-1.5 rounded-pill border px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-hearth-chip animate-fade-in"
                    style={{ borderColor: 'var(--hearth-accent)', color: 'var(--hearth-accent)', background: 'var(--hearth-accent-soft)' }}
                    title="View task progress"
                  >
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: 'var(--hearth-accent)' }} />
                    {activeTasks.count} {activeTasks.count === 1 ? 'task' : 'tasks'} running
                    <span aria-hidden>→</span>
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isDev && debugInfo && (
                  <button
                    type="button"
                    onClick={() => setShowDebugPanel((p) => !p)}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors duration-fast ${showDebugPanel ? 'text-hearth-accent' : 'text-hearth-text-faint hover:text-hearth-text-muted'}`}
                  >
                    Debug
                  </button>
                )}
                <HButton size="sm" icon="share" onClick={() => setShowShareDialog(true)}>Share</HButton>
              </div>
            </div>
          )}

          {showShareDialog && activeSessionId && (
            <ShareDialog sessionId={activeSessionId} visibility={activeVisibility} onClose={() => setShowShareDialog(false)} onVisibilityChange={handleVisibilityChange} />
          )}

          {isDev && showDebugPanel && debugInfo && (
            <MemoryDebugPanel debugInfo={debugInfo} onClose={() => setShowDebugPanel(false)} />
          )}

          {/* Side-effect notice (agent wrote to external system) */}
          {sideEffectNotice && (
            <SideEffectNotice
              toolName={sideEffectNotice.toolName}
              provider={sideEffectNotice.provider}
              onDismiss={dismissSideEffectNotice}
            />
          )}

          {/* Error banner */}
          {error && (
            <div className="flex items-center justify-between border-b px-5 py-2 text-sm animate-fade-in" style={{ borderColor: 'var(--hearth-err)', background: 'color-mix(in srgb, var(--hearth-err) 8%, transparent)', color: 'var(--hearth-err)' }}>
              <span>{error}</span>
              <HButton size="sm" onClick={retryLastMessage}>Retry</HButton>
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
            artifacts={artifacts}
            onOpenArtifact={openArtifact}
            onStarterSelect={(prompt) => handleSendMessage(prompt, [])}
            onRegenerate={regenerateMessage}
            sessionId={activeSessionId ?? undefined}
            unreadAnchorId={unreadAnchorId}
            onMessageVisible={markRead}
            taskChips={taskChips}
            taskSuggestions={taskSuggestions}
            onDismissTaskSuggestion={dismissTaskSuggestion}
            onUnlinkTask={unlinkTask}
          />

          {/* Input */}
          <ChatInput
            onSend={handleSendMessage}
            disabled={isStreaming}
            cognitiveEnabled={cognitiveEnabled}
            sessionId={activeSessionId}
            typingUsers={typingUsers}
            composingUsers={composingUsers}
            latestMessageId={messages.length > 0 ? messages[messages.length - 1].id : null}
            accessPrompt={
              activeVisibility === 'org' && !isOwner
                ? { label: 'Join conversation', onClick: handleJoinSession }
                : undefined
            }
          />
        </div>

        {/* Artifact panel */}
        {panelOpen && activeArtifact && !isMobile && (
          <ArtifactPanel
            artifact={activeArtifact} artifacts={artifacts} versions={versions}
            onSelectArtifact={openArtifact} onClose={closePanel} onFetchVersions={fetchVersions}
            onSaveContent={saveArtifactContent}
            onRequestRevision={(instruction) => handleSendMessage(`Please update the artifact: ${instruction}`, [])}
          />
        )}
        {panelOpen && activeArtifact && isMobile && (
          <ArtifactDrawer artifact={activeArtifact} onClose={closePanel} />
        )}
      </div>
    </div>
  );
}

function PresenceAvatars({ users }: { users: PresenceUser[] }) {
  const opacityFor = (state?: PresenceUser['state']) =>
    state === 'idle' ? 0.4 : state === 'viewing' ? 0.7 : 1;
  const labelFor = (user: PresenceUser) =>
    `${user.name}${user.state ? ` (${user.state})` : ''}`;
  return (
    <div className="flex items-center -space-x-1.5">
      {users.slice(0, 5).map((user) => (
        <div key={user.userId} style={{ opacity: opacityFor(user.state) }} title={labelFor(user)}>
          <HAvatar initials={user.name.charAt(0).toUpperCase()} size={24} />
        </div>
      ))}
      {users.length > 5 && (
        <span className="ml-1 text-[11px] text-hearth-text-faint font-medium">+{users.length - 5}</span>
      )}
    </div>
  );
}
