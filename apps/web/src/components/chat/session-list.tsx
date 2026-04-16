import { useState, useRef, useEffect } from 'react';
import type { ChatSession } from '@hearth/shared';

interface SessionListProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  loading?: boolean;
}

interface SessionItemProps {
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => Promise<void>;
  onDelete: () => void;
}

function SessionItem({ session, isActive, onSelect, onRename, onDelete }: SessionItemProps) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(session.title || 'Untitled chat');
    setEditing(true);
  };

  const commitEdit = async () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== session.title) {
      await onRename(trimmed);
    }
    setEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  };

  const startDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(true);
  };

  const cancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  };

  const confirmDeleteAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
    onDelete();
  };

  if (confirmDelete) {
    return (
      <div
        className={`rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-hearth-50' : 'bg-red-50'}`}
      >
        <p className="mb-1.5 text-xs text-gray-700">Delete this chat?</p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={confirmDeleteAction}
            className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={cancelDelete}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group relative flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        isActive ? 'bg-hearth-50 text-hearth-700' : 'text-gray-700 hover:bg-gray-50'
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <svg
        className={`h-4 w-4 shrink-0 ${isActive ? 'text-hearth-500' : 'text-gray-400'}`}
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M3.43 2.524A41.29 41.29 0 0 1 10 2c2.236 0 4.43.18 6.57.524 1.437.231 2.43 1.49 2.43 2.902v5.148c0 1.413-.993 2.67-2.43 2.902a41.202 41.202 0 0 1-5.82.524l-3.306 2.88a.75.75 0 0 1-1.194-.6v-2.602a41.87 41.87 0 0 1-2.82-.678C2.14 12.77 1 11.51 1 10.098V5.426c0-1.413.993-2.67 2.43-2.902Z"
          clipRule="evenodd"
        />
      </svg>

      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleEditKeyDown}
          onBlur={commitEdit}
          className="min-w-0 flex-1 rounded border border-hearth-400 bg-white px-1 py-0 text-sm text-gray-900 focus:outline-none"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 truncate text-left"
        >
          {session.title || 'Untitled chat'}
        </button>
      )}

      {!editing && hovered && (
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={startEdit}
            title="Rename"
            className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
              <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={startDelete}
            title="Delete"
            className="rounded p-0.5 text-gray-400 hover:bg-red-100 hover:text-red-500"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

export function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  loading,
}: SessionListProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Chats
        </h2>
        <button
          type="button"
          onClick={onNew}
          className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          title="New chat"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {loading && sessions.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-400">Loading...</div>
        ) : sessions.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-400">No conversations yet</div>
        ) : (
          sessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onSelect={() => onSelect(session.id)}
              onRename={(title) => onRename(session.id, title)}
              onDelete={() => onDelete(session.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
