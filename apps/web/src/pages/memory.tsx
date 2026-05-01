import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useMemory } from '@/hooks/use-memory';
import { HButton, HEyebrow, HCard } from '@/components/ui/primitives';
import type { MemoryEntry, MemoryLayer } from '@hearth/shared';

const LAYERS: { value: MemoryLayer | 'all'; label: string }[] = [
  { value: 'all', label: 'All Layers' },
  { value: 'org', label: 'Organization' },
  { value: 'team', label: 'Team' },
  { value: 'user', label: 'Personal' },
];

const LAYER_COLORS: Record<string, string> = {
  org: 'bg-purple-100 text-purple-700',
  team: 'bg-blue-100 text-blue-700',
  user: 'bg-green-100 text-green-700',
};

export function MemoryPage() {
  const { user } = useAuth();
  const {
    entries,
    total,
    page,
    loading,
    searchResults,
    fetchMemory,
    createMemory,
    updateMemory,
    deleteMemory,
    searchMemory,
    clearSearch,
  } = useMemory();

  const [activeLayer, setActiveLayer] = useState<MemoryLayer | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingEntry, setEditingEntry] = useState<MemoryEntry | null>(null);
  const [formLayer, setFormLayer] = useState<MemoryLayer>('user');
  const [formContent, setFormContent] = useState('');
  const [formSource, setFormSource] = useState('');

  const reload = useCallback(() => {
    const layer = activeLayer === 'all' ? undefined : activeLayer;
    fetchMemory(layer);
  }, [activeLayer, fetchMemory]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      clearSearch();
      reload();
      return;
    }
    const layer = activeLayer === 'all' ? undefined : activeLayer;
    await searchMemory(searchQuery, layer);
  }, [searchQuery, activeLayer, searchMemory, clearSearch, reload]);

  const handleCreate = useCallback(async () => {
    if (!formContent.trim()) return;
    await createMemory({
      layer: formLayer,
      content: formContent,
      source: formSource || undefined,
    });
    setShowCreate(false);
    setFormContent('');
    setFormSource('');
    reload();
  }, [formLayer, formContent, formSource, createMemory, reload]);

  const handleUpdate = useCallback(async () => {
    if (!editingEntry || !formContent.trim()) return;
    await updateMemory(editingEntry.id, {
      content: formContent,
      source: formSource || undefined,
    });
    setEditingEntry(null);
    setFormContent('');
    setFormSource('');
    reload();
  }, [editingEntry, formContent, formSource, updateMemory, reload]);

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteMemory(id);
      reload();
    },
    [deleteMemory, reload],
  );

  const startEdit = useCallback((entry: MemoryEntry) => {
    setEditingEntry(entry);
    setFormContent(entry.content);
    setFormSource(entry.source ?? '');
    setShowCreate(false);
  }, []);

  const cancelForm = useCallback(() => {
    setShowCreate(false);
    setEditingEntry(null);
    setFormContent('');
    setFormSource('');
  }, []);

  const displayEntries = searchResults ?? entries;

  const canWriteLayer = (layer: MemoryLayer) => {
    if (layer === 'org') return user?.role === 'admin';
    if (layer === 'team') return user?.role === 'admin' || user?.role === 'team_lead';
    return true;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-hearth-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <HEyebrow>Knowledge Base</HEyebrow>
            <h1 className="mt-1 font-display text-[22px] font-medium" style={{ letterSpacing: '-0.4px', lineHeight: 1.2 }}>
              Memory<span style={{ color: 'var(--hearth-accent)' }}>.</span>
            </h1>
            <p className="mt-1 text-sm text-hearth-text-muted">
              {total} entries across all accessible layers
            </p>
          </div>
          <HButton
            variant="accent"
            icon="plus"
            onClick={() => {
              setShowCreate(true);
              setEditingEntry(null);
              setFormContent('');
              setFormSource('');
              setFormLayer('user');
            }}
          >
            New Entry
          </HButton>
        </div>

        {/* Search */}
        <div className="mt-4 flex gap-2">
          <input
            type="text"
            placeholder="Search memory..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1 rounded-md border border-hearth-border-strong bg-hearth-card px-3 py-2 text-sm text-hearth-text placeholder:text-hearth-text-faint focus:border-hearth-accent focus:outline-none focus:shadow-hearth-focus"
          />
          <HButton onClick={handleSearch}>Search</HButton>
          {searchResults && (
            <HButton
              variant="ghost"
              onClick={() => {
                setSearchQuery('');
                clearSearch();
                reload();
              }}
            >
              Clear
            </HButton>
          )}
        </div>

        {/* Layer filter */}
        <div className="mt-3 flex gap-1">
          {LAYERS.map((l) => (
            <button
              key={l.value}
              type="button"
              onClick={() => setActiveLayer(l.value)}
              className={`rounded-pill px-3 py-1 text-xs font-medium transition-all duration-fast ease-hearth ${
                activeLayer === l.value
                  ? 'bg-hearth-accent-soft text-hearth-accent'
                  : 'text-hearth-text-muted hover:bg-hearth-chip'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Create / Edit form */}
      {(showCreate || editingEntry) && (
        <div className="border-b border-hearth-border bg-hearth-card-alt px-6 py-4 animate-fade-in">
          <h3 className="mb-3 text-sm font-semibold text-hearth-text">
            {editingEntry ? 'Edit Entry' : 'New Memory Entry'}
          </h3>
          {!editingEntry && (
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-hearth-text-muted">Layer</label>
              <select
                value={formLayer}
                onChange={(e) => setFormLayer(e.target.value as MemoryLayer)}
                className="rounded-md border border-hearth-border-strong bg-hearth-card px-3 py-1.5 text-sm text-hearth-text"
              >
                {LAYERS.filter((l) => l.value !== 'all' && canWriteLayer(l.value as MemoryLayer)).map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <textarea
            value={formContent}
            onChange={(e) => setFormContent(e.target.value)}
            placeholder="Memory content..."
            rows={3}
            className="w-full rounded-md border border-hearth-border-strong bg-hearth-card px-3 py-2 text-sm text-hearth-text placeholder:text-hearth-text-faint focus:border-hearth-accent focus:outline-none focus:shadow-hearth-focus"
          />
          <input
            type="text"
            value={formSource}
            onChange={(e) => setFormSource(e.target.value)}
            placeholder="Source (optional)"
            className="mt-2 w-full rounded-md border border-hearth-border-strong bg-hearth-card px-3 py-2 text-sm text-hearth-text placeholder:text-hearth-text-faint focus:border-hearth-accent focus:outline-none focus:shadow-hearth-focus"
          />
          <div className="mt-3 flex gap-2">
            <HButton
              variant="accent"
              onClick={editingEntry ? handleUpdate : handleCreate}
            >
              {editingEntry ? 'Save' : 'Create'}
            </HButton>
            <HButton variant="ghost" onClick={cancelForm}>
              Cancel
            </HButton>
          </div>
        </div>
      )}

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-hearth-text-faint">Loading...</p>
          </div>
        ) : displayEntries.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-hearth-text-faint">
              {searchResults ? 'No search results' : 'No memory entries yet'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-hearth-border">
            {displayEntries.map((entry) => (
              <div key={entry.id} className="px-6 py-4 transition-colors hover:bg-hearth-card-alt">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${LAYER_COLORS[entry.layer as MemoryLayer]}`}
                      >
                        {entry.layer}
                      </span>
                      {entry.source && (
                        <span className="text-xs text-hearth-text-faint">{entry.source}</span>
                      )}
                      {'score' in entry && (
                        <span className="text-xs text-hearth-text-faint">
                          score: {((entry as unknown as { score: number }).score * 100).toFixed(1)}
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-hearth-text">{entry.content}</p>
                    <p className="mt-1 text-xs text-hearth-text-faint">
                      {new Date(entry.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="ml-4 flex gap-1">
                    {canWriteLayer(entry.layer as MemoryLayer) && (
                      <>
                        <button
                          type="button"
                          onClick={() => startEdit(entry)}
                          className="rounded-md p-1 text-hearth-text-faint transition-colors hover:bg-hearth-chip hover:text-hearth-text-muted"
                          title="Edit"
                        >
                          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
                            <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(entry.id)}
                          className="rounded-md p-1 text-hearth-text-faint hover:bg-red-50 hover:text-red-500"
                          title="Delete"
                        >
                          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path
                              fillRule="evenodd"
                              d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {!searchResults && total > 20 && (
        <div className="flex items-center justify-between border-t border-hearth-border px-6 py-3">
          <p className="text-xs text-hearth-text-muted">
            Page {page} of {Math.ceil(total / 20)}
          </p>
          <div className="flex gap-2">
            <HButton
              size="sm"
              disabled={page <= 1}
              onClick={() => fetchMemory(activeLayer === 'all' ? undefined : activeLayer, page - 1)}
            >
              Previous
            </HButton>
            <HButton
              size="sm"
              disabled={page >= Math.ceil(total / 20)}
              onClick={() => fetchMemory(activeLayer === 'all' ? undefined : activeLayer, page + 1)}
            >
              Next
            </HButton>
          </div>
        </div>
      )}
    </div>
  );
}
