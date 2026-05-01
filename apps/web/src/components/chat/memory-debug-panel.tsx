import { useState } from 'react';

interface DebugSource {
  index: number;
  type: string;
  label: string;
  content: string;
}

interface MemoryDebugInfo {
  sources: DebugSource[];
  rollingSummary: string | null;
  timestamp: string;
}

interface MemoryDebugPanelProps {
  debugInfo: MemoryDebugInfo;
  onClose: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  memory: 'bg-blue-100 text-blue-700',
  experience: 'bg-purple-100 text-purple-700',
  decision: 'bg-amber-100 text-amber-700',
  context: 'bg-green-100 text-green-700',
  skill: 'bg-pink-100 text-pink-700',
};

export function MemoryDebugPanel({ debugInfo, onClose }: MemoryDebugPanelProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // Group sources by type
  const grouped = debugInfo.sources.reduce<Record<string, DebugSource[]>>((acc, s) => {
    (acc[s.type] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="border-b border-hearth-border bg-hearth-bg animate-fade-in">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-hearth-text-muted">
            Context Debug
          </h3>
          <span className="rounded-full bg-hearth-chip px-1.5 py-0.5 text-[10px] font-medium text-hearth-text-muted">
            {debugInfo.sources.length} items
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-hearth-text-faint hover:text-hearth-text-muted"
          aria-label="Close debug panel"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto px-4 pb-3">
        {Object.entries(grouped).map(([type, sources]) => (
          <div key={type} className="mt-2">
            <div className="flex items-center gap-1.5">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${TYPE_COLORS[type] ?? 'bg-hearth-chip text-hearth-text-muted'}`}>
                {type}
              </span>
              <span className="text-[10px] text-hearth-text-faint">{sources.length}</span>
            </div>
            <div className="mt-1 space-y-1">
              {sources.map((s) => (
                <button
                  key={s.index}
                  type="button"
                  onClick={() => setExpandedIdx(expandedIdx === s.index ? null : s.index)}
                  className="w-full rounded border border-hearth-border bg-hearth-card px-2.5 py-1.5 text-left text-xs text-hearth-text-muted hover:bg-hearth-bg"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 font-mono text-[10px] text-hearth-text-faint">[{s.index}]</span>
                    <span className="truncate font-medium">{s.label}</span>
                  </div>
                  {expandedIdx === s.index && (
                    <p className="mt-1 whitespace-pre-wrap text-[11px] text-hearth-text-muted">
                      {s.content}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}

        {debugInfo.rollingSummary && (
          <div className="mt-2">
            <div className="flex items-center gap-1.5">
              <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                summary
              </span>
            </div>
            <p className="mt-1 rounded border border-hearth-border bg-hearth-card px-2.5 py-1.5 text-[11px] text-hearth-text-muted">
              {debugInfo.rollingSummary}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
