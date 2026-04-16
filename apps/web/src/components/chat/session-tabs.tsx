import { useState, useRef, useEffect, useMemo } from 'react';
import type { ChatSession } from '@hearth/shared';
import { SessionHistory } from './session-history';

interface SessionTabsProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  onClose: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function Tab({
  session,
  isActive,
  onSelect,
  onRename,
  onClose,
}: {
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
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

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  return (
    <div
      className={`group relative flex min-w-0 max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-gray-200 px-3 py-2 text-xs transition-colors ${
        isActive
          ? 'bg-white text-gray-900'
          : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700'
      }`}
      onClick={onSelect}
    >
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleEditKeyDown}
          onBlur={commitEdit}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 rounded border border-hearth-400 bg-white px-1 py-0 text-xs text-gray-900 focus:outline-none"
        />
      ) : (
        <span
          className="min-w-0 flex-1 truncate"
          onDoubleClick={startEdit}
          title={session.title || 'Untitled chat'}
        >
          {session.title || 'Untitled chat'}
        </span>
      )}

      {!editing && (
        <button
          type="button"
          onClick={handleClose}
          title="Close tab"
          className={`shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600 ${isActive ? 'opacity-60' : ''}`}
        >
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      )}

      {isActive && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-hearth-500" />
      )}
    </div>
  );
}

export function SessionTabs({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  onClose,
  onRename,
  onDelete,
}: SessionTabsProps) {
  const openSessionIds = useMemo(
    () => new Set(sessions.map((s) => s.id)),
    [sessions],
  );

  return (
    <div className="flex items-stretch border-b border-gray-200 bg-gray-50">
      {/* History / search — outside scrollable area so dropdown isn't clipped */}
      <SessionHistory openSessionIds={openSessionIds} onSelect={onSelect} onDelete={onDelete} />

      <div className="w-px shrink-0 self-stretch bg-gray-200" />

      {/* Scrollable tabs */}
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {sessions.map((session) => (
          <Tab
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            onSelect={() => onSelect(session.id)}
            onRename={(title) => onRename(session.id, title)}
            onClose={() => onClose(session.id)}
          />
        ))}

        <button
          type="button"
          onClick={onNew}
          className="flex shrink-0 items-center gap-1 px-3 py-2 text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          title="New chat"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          New
        </button>
      </div>
    </div>
  );
}
