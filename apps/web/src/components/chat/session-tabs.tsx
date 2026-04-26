import { useState, useRef, useEffect, useMemo } from 'react';
import type { ChatSession } from '@hearth/shared';
import { SessionHistory } from './session-history';
import { HIcon } from '@/components/ui/icon';

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
  session, isActive, onSelect, onRename, onClose,
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
    if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [editing]);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(session.title || 'Untitled chat');
    setEditing(true);
  };

  const commitEdit = async () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== session.title) await onRename(trimmed);
    setEditing(false);
  };

  return (
    <div
      className={`group relative flex min-w-0 max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-hearth-border px-3 py-2 text-xs transition-colors duration-fast ${
        isActive
          ? 'bg-hearth-card text-hearth-text font-semibold'
          : 'bg-hearth-bg text-hearth-text-muted hover:bg-hearth-card hover:text-hearth-text'
      }`}
      onClick={onSelect}
    >
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(); } else if (e.key === 'Escape') setEditing(false); }}
          onBlur={commitEdit}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 rounded-sm border border-hearth-accent bg-hearth-card px-1 py-0 text-xs text-hearth-text focus:outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate" onDoubleClick={startEdit} title={session.title || 'Untitled chat'}>
          {session.title || 'Untitled chat'}
        </span>
      )}

      {!editing && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Close tab"
          className={`shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 text-hearth-text-faint hover:text-hearth-text ${isActive ? 'opacity-60' : ''}`}
        >
          <HIcon name="x" size={12} />
        </button>
      )}

      {isActive && (
        <div className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: 'var(--hearth-accent)' }} />
      )}
    </div>
  );
}

export function SessionTabs({ sessions, activeSessionId, onSelect, onNew, onClose, onRename, onDelete }: SessionTabsProps) {
  const openSessionIds = useMemo(() => new Set(sessions.map((s) => s.id)), [sessions]);

  return (
    <div className="flex items-stretch border-b border-hearth-border bg-hearth-bg">
      <SessionHistory openSessionIds={openSessionIds} onSelect={onSelect} onDelete={onDelete} />
      <div className="w-px shrink-0 self-stretch bg-hearth-border" />
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
          className="flex shrink-0 items-center gap-1 px-3 py-2 text-xs text-hearth-text-faint transition-colors duration-fast hover:bg-hearth-card hover:text-hearth-text-muted"
          title="New chat"
        >
          <HIcon name="plus" size={14} />
          New
        </button>
      </div>
    </div>
  );
}
