import { useState } from 'react';

interface TaskContextPanelProps {
  context: Record<string, unknown>;
  editable?: boolean;
  onAddContext?: (patch: Record<string, unknown>) => Promise<unknown>;
}

export function TaskContextPanel({ context, editable, onAddContext }: TaskContextPanelProps) {
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const entries = Object.entries(context);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = note.trim();
    if (!trimmed || !onAddContext) return;
    setSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      await onAddContext({ [`note_${timestamp}`]: trimmed });
      setNote('');
      setAdding(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {entries.length === 0 && !editable && (
        <p className="text-center text-xs text-gray-400 py-4">
          No context attached
        </p>
      )}

      {entries.map(([key, value]) => (
        <div key={key}>
          <h4 className="mb-1 text-xs font-medium text-gray-500">
            {key.startsWith('note_') ? formatNoteKey(key) : key}
          </h4>
          <pre className="whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-800">
            {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
          </pre>
        </div>
      ))}

      {editable && onAddContext && (
        <div className="border-t border-gray-100 pt-3">
          {adding ? (
            <form onSubmit={handleSubmit} className="space-y-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="What should the agent know before planning this task?"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-700 focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={submitting || !note.trim()}
                  className="rounded bg-hearth-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => { setAdding(false); setNote(''); }}
                  className="rounded px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="text-xs text-gray-500 hover:text-hearth-600"
            >
              + Add context
            </button>
          )}
        </div>
      )}

      {entries.length === 0 && editable && !adding && (
        <p className="text-center text-xs text-gray-400 py-2">
          No context yet — add notes to guide the agent during planning.
        </p>
      )}
    </div>
  );
}

/** Format a note key like "note_2026-04-16T05:30:00.000Z" into a readable date */
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
