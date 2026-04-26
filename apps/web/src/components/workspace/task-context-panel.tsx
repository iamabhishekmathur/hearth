import { useState, useRef, useCallback } from 'react';
import { useTaskContext } from '@/hooks/use-task-context';
import { ContextItemCard } from './context-item-card';

interface TaskContextPanelProps {
  taskId: string;
  context: Record<string, unknown>;
  editable?: boolean;
  onAddContext?: (patch: Record<string, unknown>) => Promise<unknown>;
}

type AddMode = null | 'note' | 'link' | 'text_block';

export function TaskContextPanel({ taskId, context, editable, onAddContext: _onAddContext }: TaskContextPanelProps) {
  const {
    items,
    loading,
    addNote,
    addLink,
    addTextBlock,
    uploadContextFile,
    updateItem,
    removeItem,
    refreshItem,
    analyzeImage,
  } = useTaskContext(taskId);

  const [addMode, setAddMode] = useState<AddMode>(null);
  const [inputValue, setInputValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Legacy context entries (from task.context JSON)
  const legacyEntries = Object.entries(context).filter(
    ([, v]) => v !== null && v !== undefined,
  );
  const hasContent = items.length > 0 || legacyEntries.length > 0;

  // ── Drop zone handlers ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        await uploadContextFile(file);
      }
    },
    [uploadContextFile],
  );

  // ── Paste handler ──
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      if (!editable) return;

      // Check for files in clipboard
      const files = Array.from(e.clipboardData.files);
      if (files.length > 0) {
        e.preventDefault();
        for (const file of files) {
          await uploadContextFile(file);
        }
        return;
      }

      // Check for pasted text
      const text = e.clipboardData.getData('text/plain');
      if (!text) return;

      // If it looks like a URL and we're not in an input, auto-create link
      if (/^https?:\/\//.test(text.trim()) && addMode === null) {
        e.preventDefault();
        await addLink(text.trim());
        return;
      }

      // If it's a long text block and we're not already editing, auto-create text block
      if (text.length > 200 && addMode === null) {
        e.preventDefault();
        await addTextBlock(text);
      }
    },
    [editable, addMode, uploadContextFile, addLink, addTextBlock],
  );

  // ── Submit handler for add modes ──
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    setSubmitting(true);
    try {
      switch (addMode) {
        case 'note':
          await addNote(trimmed);
          break;
        case 'link':
          await addLink(trimmed);
          break;
        case 'text_block':
          await addTextBlock(trimmed);
          break;
      }
      setInputValue('');
      setAddMode(null);
    } finally {
      setSubmitting(false);
    }
  }

  function handleFileSelect() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      await uploadContextFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    setShowAddMenu(false);
  }

  return (
    <div
      className="space-y-3"
      onPaste={handlePaste}
      onDragOver={editable ? handleDragOver : undefined}
      onDragLeave={editable ? handleDragLeave : undefined}
      onDrop={editable ? handleDrop : undefined}
    >
      {/* Drop zone */}
      {editable && (
        <div
          className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
            dragOver
              ? 'border-hearth-400 bg-hearth-50'
              : 'border-hearth-border bg-hearth-bg'
          }`}
        >
          <p className="text-xs text-hearth-text-faint">
            {dragOver ? 'Drop files here' : 'Drag files here, paste URLs or text'}
          </p>
        </div>
      )}

      {/* Rich context items */}
      {items.map((item) => (
        <ContextItemCard
          key={item.id}
          item={item}
          editable={!!editable}
          onDelete={removeItem}
          onRefresh={refreshItem}
          onAnalyze={analyzeImage}
          onUpdateLabel={(id, label) => updateItem(id, { label })}
        />
      ))}

      {/* Legacy context entries */}
      {legacyEntries.map(([key, value]) => (
        <div key={key} className="rounded-lg border border-hearth-border bg-hearth-bg p-3">
          <h4 className="mb-1 text-xs font-medium text-hearth-text-faint">
            {key.startsWith('note_') ? formatNoteKey(key) : key}
          </h4>
          <pre className="whitespace-pre-wrap text-xs text-hearth-text">
            {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
          </pre>
        </div>
      ))}

      {/* Empty state */}
      {!hasContent && !editable && !loading && (
        <p className="text-center text-xs text-hearth-text-faint py-4">No context attached</p>
      )}

      {/* Add menu / input forms */}
      {editable && addMode === null && (
        <div className="relative border-t border-hearth-border pt-3">
          <button
            type="button"
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="text-xs text-hearth-text-muted hover:text-hearth-600"
          >
            + Add context
          </button>

          {showAddMenu && (
            <div className="absolute left-0 top-full mt-1 z-10 rounded-lg border border-hearth-border bg-hearth-card shadow-hearth-3 py-1 min-w-[180px]">
              <MenuButton
                label="Add note"
                onClick={() => { setAddMode('note'); setShowAddMenu(false); }}
              />
              <MenuButton
                label="Add link"
                onClick={() => { setAddMode('link'); setShowAddMenu(false); }}
              />
              <MenuButton
                label="Upload file"
                onClick={() => { handleFileSelect(); setShowAddMenu(false); }}
              />
              <MenuButton
                label="Paste text block"
                onClick={() => { setAddMode('text_block'); setShowAddMenu(false); }}
              />
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
            accept="image/*,.pdf,.txt,.json,.md,.csv"
          />
        </div>
      )}

      {/* Inline input forms */}
      {editable && addMode !== null && (
        <form onSubmit={handleSubmit} className="border-t border-hearth-border pt-3 space-y-2">
          {addMode === 'link' ? (
            <input
              type="url"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="https://..."
              className="w-full rounded border border-hearth-border-strong px-2 py-1.5 text-sm text-hearth-text focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
              autoFocus
            />
          ) : (
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              rows={addMode === 'text_block' ? 6 : 3}
              placeholder={
                addMode === 'note'
                  ? 'What should the agent know before planning this task?'
                  : 'Paste a spec, email thread, or any text...'
              }
              className="w-full rounded border border-hearth-border-strong px-2 py-1.5 text-sm text-hearth-text focus:border-hearth-accent focus:outline-none focus:ring-1 focus:ring-hearth-accent"
              autoFocus
            />
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || !inputValue.trim()}
              className="rounded bg-hearth-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => { setAddMode(null); setInputValue(''); }}
              className="rounded px-3 py-1.5 text-xs text-hearth-text-muted hover:bg-hearth-chip"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {!hasContent && editable && addMode === null && (
        <p className="text-center text-xs text-hearth-text-faint py-2">
          No context yet — add notes, links, or files to guide the agent during planning.
        </p>
      )}
    </div>
  );
}

function MenuButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left text-xs text-hearth-text hover:bg-hearth-bg"
    >
      {label}
    </button>
  );
}

function formatNoteKey(key: string): string {
  const dateStr = key.replace('note_', '');
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return key;
    return `Note — ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return key;
  }
}
