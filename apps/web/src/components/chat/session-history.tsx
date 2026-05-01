import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/lib/api-client';
import type { ChatSession, ApiResponse } from '@hearth/shared';

interface SharedSession extends ChatSession {
  user?: { id: string; name: string };
}

interface SessionHistoryProps {
  openSessionIds: Set<string>;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => Promise<void>;
}

export function SessionHistory({ openSessionIds, onSelect, onDelete }: SessionHistoryProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [allSessions, setAllSessions] = useState<ChatSession[]>([]);
  const [sharedSessions, setSharedSessions] = useState<SharedSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch all sessions + shared sessions when dropdown opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);

    Promise.all([
      api.get<ApiResponse<ChatSession[]>>('/chat/sessions'),
      api.get<ApiResponse<SharedSession[]>>('/chat/sessions/shared'),
    ])
      .then(([ownRes, sharedRes]) => {
        if (ownRes.data) setAllSessions(ownRes.data);
        if (sharedRes.data) setSharedSessions(sharedRes.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  // Focus search input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleSelect = useCallback(
    (session: ChatSession) => {
      onSelect(session.id);
      setOpen(false);
      setQuery('');
    },
    [onSelect],
  );

  const handleDelete = useCallback(
    async (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      if (confirmDeleteId === sessionId) {
        await onDelete(sessionId);
        setAllSessions((prev) => prev.filter((s) => s.id !== sessionId));
        setConfirmDeleteId(null);
      } else {
        setConfirmDeleteId(sessionId);
        setTimeout(() => setConfirmDeleteId(null), 3000);
      }
    },
    [confirmDeleteId, onDelete],
  );

  const filteredOwn = useMemo(() => {
    const q = query.toLowerCase().trim();
    return allSessions.filter((s) => {
      if (!q) return true;
      return (s.title || 'Untitled chat').toLowerCase().includes(q);
    });
  }, [allSessions, query]);

  const filteredShared = useMemo(() => {
    const q = query.toLowerCase().trim();
    return sharedSessions.filter((s) => {
      if (!q) return true;
      const titleMatch = (s.title || 'Untitled chat').toLowerCase().includes(q);
      const nameMatch = s.user?.name?.toLowerCase().includes(q) ?? false;
      return titleMatch || nameMatch;
    });
  }, [sharedSessions, query]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex shrink-0 items-center gap-1 px-2.5 py-2 text-hearth-text-faint transition-colors hover:bg-hearth-chip hover:text-hearth-text-muted"
        title="Chat history (⌘K)"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-lg border border-hearth-border bg-hearth-card shadow-hearth-4 animate-scale-in">
          {/* Search input */}
          <div className="border-b border-hearth-border p-2">
            <div className="flex items-center gap-2 rounded-md border border-hearth-border bg-hearth-bg px-2.5 py-1.5">
              <svg
                className="h-3.5 w-3.5 shrink-0 text-hearth-text-faint"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
                  clipRule="evenodd"
                />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setOpen(false);
                    setQuery('');
                  }
                  if (e.key === 'Enter' && filteredOwn.length > 0) {
                    handleSelect(filteredOwn[0]);
                  }
                }}
                placeholder="Search chats..."
                className="min-w-0 flex-1 bg-transparent text-sm text-hearth-text placeholder-hearth-text-faint focus:outline-none"
              />
              <kbd className="hidden rounded border border-hearth-border bg-hearth-card px-1.5 py-0.5 text-[10px] text-hearth-text-faint sm:inline">
                ⌘K
              </kbd>
            </div>
          </div>

          {/* Session list */}
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <p className="px-3 py-6 text-center text-xs text-hearth-text-faint">Loading...</p>
            ) : filteredOwn.length === 0 && filteredShared.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-hearth-text-faint">
                {query ? 'No chats found' : 'No chat history'}
              </p>
            ) : (
              <>
                {/* Own sessions */}
                {filteredOwn.length > 0 && (
                  <>
                    <div className="px-3 pb-1 pt-2">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-hearth-text-faint">
                        {query ? 'Results' : 'Recent'}
                      </p>
                    </div>
                    {filteredOwn.map((session) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        isOpen={openSessionIds.has(session.id)}
                        isConfirming={confirmDeleteId === session.id}
                        onSelect={() => handleSelect(session)}
                        onDelete={(e) => handleDelete(e, session.id)}
                      />
                    ))}
                  </>
                )}

                {/* Shared sessions */}
                {filteredShared.length > 0 && (
                  <>
                    <div className="px-3 pb-1 pt-3">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-hearth-text-faint">
                        Shared by team
                      </p>
                    </div>
                    {filteredShared.map((session) => (
                      <SharedSessionRow
                        key={session.id}
                        session={session}
                        isOpen={openSessionIds.has(session.id)}
                        onSelect={() => handleSelect(session)}
                      />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SessionRow({
  session,
  isOpen,
  isConfirming,
  onSelect,
  onDelete,
}: {
  session: ChatSession;
  isOpen: boolean;
  isConfirming: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className="group flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-hearth-bg"
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${isOpen ? 'font-medium text-hearth-text' : 'text-hearth-text'}`}>
          {session.title || 'Untitled chat'}
        </p>
        <p className="text-[11px] text-hearth-text-faint">
          {formatRelativeDate(session.updatedAt)}
        </p>
      </div>
      <button
        type="button"
        onClick={onDelete}
        title={isConfirming ? 'Click again to delete' : 'Delete'}
        className={`shrink-0 rounded p-1 transition-all ${
          isConfirming
            ? 'bg-red-100 text-red-500'
            : 'text-hearth-text-faint opacity-0 hover:bg-hearth-chip hover:text-hearth-text-muted group-hover:opacity-100'
        }`}
      >
        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.519.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
}

function SharedSessionRow({
  session,
  isOpen,
  onSelect,
}: {
  session: ChatSession & { user?: { id: string; name: string } };
  isOpen: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-hearth-bg"
      onClick={onSelect}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-hearth-100 text-[10px] font-medium text-hearth-700">
        {session.user?.name?.charAt(0)?.toUpperCase() ?? '?'}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${isOpen ? 'font-medium text-hearth-text' : 'text-hearth-text'}`}>
          {session.title || 'Untitled chat'}
        </p>
        <p className="text-[11px] text-hearth-text-faint">
          {session.user?.name ?? 'Unknown'} · {formatRelativeDate(session.updatedAt)}
        </p>
      </div>
    </div>
  );
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
