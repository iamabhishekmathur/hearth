import { useState, useCallback } from 'react';
import { api } from '@/lib/api-client';

interface ImportSkillPanelProps {
  onClose: () => void;
  onImported: () => void;
}

export function ImportSkillPanel({ onClose, onImported }: ImportSkillPanelProps) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    name: string;
    description: string;
    content: string;
  } | null>(null);

  const handleFetch = useCallback(async () => {
    setError(null);
    const trimmed = url.trim();
    if (!trimmed) { setError('URL is required'); return; }

    setLoading(true);
    try {
      const res = await api.post<{
        data: { name: string; description: string; content: string };
      }>('/skills/import/preview', { url: trimmed });
      if (res.data) setPreview(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch skill');
    } finally {
      setLoading(false);
    }
  }, [url]);

  const handleImport = useCallback(async () => {
    if (!preview) return;
    setError(null);
    setLoading(true);
    try {
      await api.post('/skills/import', {
        url: url.trim(),
        name: preview.name,
        description: preview.description,
        content: preview.content,
      });
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import skill');
    } finally {
      setLoading(false);
    }
  }, [url, preview, onImported]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <h2 className="text-base font-semibold text-gray-900">Import from GitHub</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            URL to a SKILL.md file
          </label>
          <input
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setPreview(null);
            }}
            placeholder="https://github.com/user/repo/blob/main/skills/my-skill/SKILL.md"
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
          />
          <p className="mt-0.5 text-[11px] text-gray-400">
            Public SKILL.md with YAML frontmatter (name + description)
          </p>
        </div>

        <button
          type="button"
          onClick={handleFetch}
          disabled={loading || !url.trim()}
          className="w-full rounded-lg border border-gray-300 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading && !preview ? 'Fetching...' : 'Preview'}
        </button>

        {/* Preview */}
        {preview && (
          <div className="space-y-2">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm font-medium text-gray-900">{preview.name}</p>
              <p className="mt-0.5 text-xs text-gray-600">{preview.description}</p>
            </div>

            <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3">
              <pre className="whitespace-pre-wrap text-[11px] text-gray-500">
                {preview.content.slice(0, 800)}
                {preview.content.length > 800 && '\n...'}
              </pre>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs text-amber-800">
                Imported skills go through admin review before appearing in the skill browser.
                Once approved, the skill will be available to everyone in your organization.
              </p>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 border-t border-gray-100 px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleImport}
          disabled={loading || !preview}
          className="flex-1 rounded-lg bg-hearth-600 py-2 text-sm font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
        >
          {loading && preview ? 'Importing...' : 'Import & Submit for Review'}
        </button>
      </div>
    </div>
  );
}
