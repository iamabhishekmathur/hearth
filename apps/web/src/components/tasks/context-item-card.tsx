import { useState } from 'react';
import type { TaskContextItem, ExtractionStatus } from '@hearth/shared';

const TYPE_ICONS: Record<string, string> = {
  note: 'note',
  link: 'link',
  file: 'file',
  image: 'image',
  text_block: 'text',
  mcp_reference: 'integration',
  chat_excerpt: 'chat',
};

const STATUS_BADGE: Record<ExtractionStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-hearth-chip text-hearth-text-muted' },
  processing: { label: 'Extracting...', color: 'bg-blue-100 text-blue-700' },
  completed: { label: 'Ready', color: 'bg-green-100 text-green-700' },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-700' },
  skipped: { label: 'Skipped', color: 'bg-hearth-chip text-hearth-text-muted' },
};

interface ContextItemCardProps {
  item: TaskContextItem;
  editable: boolean;
  onDelete: (id: string) => void;
  onRefresh: (id: string) => void;
  onAnalyze: (id: string) => void;
  onUpdateLabel: (id: string, label: string) => void;
}

export function ContextItemCard({
  item,
  editable,
  onDelete,
  onRefresh,
  onAnalyze,
  onUpdateLabel,
}: ContextItemCardProps) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(item.label ?? '');

  const typeIcon = TYPE_ICONS[item.type] ?? 'file';
  const badge = STATUS_BADGE[item.extractionStatus] ?? STATUS_BADGE.pending;

  const title = item.extractedTitle ?? item.label ?? item.rawValue.slice(0, 60);
  const preview = item.extractedText?.slice(0, 150) ?? item.visionAnalysis?.slice(0, 150) ?? null;

  function commitLabel() {
    setEditingLabel(false);
    const trimmed = labelValue.trim();
    if (trimmed && trimmed !== (item.label ?? '')) {
      onUpdateLabel(item.id, trimmed);
    }
  }

  return (
    <div className="group rounded-lg border border-hearth-border bg-hearth-card p-3 transition-colors hover:border-hearth-border-strong animate-fade-in">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <TypeIcon type={typeIcon} />
          {editingLabel ? (
            <input
              type="text"
              value={labelValue}
              onChange={(e) => setLabelValue(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitLabel();
                if (e.key === 'Escape') {
                  setLabelValue(item.label ?? '');
                  setEditingLabel(false);
                }
              }}
              className="flex-1 min-w-0 rounded border border-hearth-400 px-1.5 py-0.5 text-sm text-hearth-text focus:outline-none focus:ring-1 focus:ring-hearth-accent"
              autoFocus
            />
          ) : (
            <span
              className={`text-sm font-medium text-hearth-text truncate ${editable ? 'cursor-text hover:underline decoration-dotted' : ''}`}
              title={title}
              onClick={() => {
                if (editable) {
                  setLabelValue(item.label ?? title);
                  setEditingLabel(true);
                }
              }}
            >
              {title}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.color}`}>
            {badge.label}
          </span>
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <p className="mt-1.5 text-xs text-hearth-text-muted line-clamp-2">{preview}</p>
      )}

      {/* Source info */}
      {item.type === 'link' && (
        <p className="mt-1 text-xs text-blue-500 truncate">{item.rawValue}</p>
      )}
      {item.type === 'chat_excerpt' && item.deepLink && (
        <a
          href={`#${item.deepLink}`}
          className="mt-1 inline-flex items-center gap-1 text-xs text-hearth-accent hover:underline"
          title="Open the source chat"
        >
          <span aria-hidden>↩</span>
          Open in chat
        </a>
      )}
      {(item.type === 'file' || item.type === 'image') && item.sizeBytes != null && (
        <p className="mt-1 text-xs text-hearth-text-faint">
          {item.rawValue} ({formatBytes(item.sizeBytes)})
        </p>
      )}
      {item.extractionError && (
        <p className="mt-1 text-xs text-red-500">{item.extractionError}</p>
      )}

      {/* Actions */}
      {editable && (
        <div className="mt-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {(item.type === 'link' || item.type === 'mcp_reference' || item.extractionStatus === 'failed') && (
            <button
              type="button"
              onClick={() => onRefresh(item.id)}
              className="text-[10px] text-hearth-text-muted hover:text-hearth-600"
            >
              Refresh
            </button>
          )}
          {item.type === 'image' && !item.visionAnalysis && (
            <button
              type="button"
              onClick={() => onAnalyze(item.id)}
              className="text-[10px] text-hearth-text-muted hover:text-hearth-600"
            >
              Analyze
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(item.id)}
            className="text-[10px] text-hearth-text-muted hover:text-red-600"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function TypeIcon({ type }: { type: string }) {
  const icons: Record<string, React.ReactNode> = {
    note: (
      <svg className="h-4 w-4 text-hearth-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
    link: (
      <svg className="h-4 w-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.193-9.193a4.5 4.5 0 016.364 6.364l-4.5 4.5a4.5 4.5 0 01-7.244-1.242" />
      </svg>
    ),
    file: (
      <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
    image: (
      <svg className="h-4 w-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M6.75 6.75h.008v.008H6.75V6.75z" />
      </svg>
    ),
    text: (
      <svg className="h-4 w-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
      </svg>
    ),
    integration: (
      <svg className="h-4 w-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5z" />
      </svg>
    ),
  };
  return icons[type] ?? icons.file;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
