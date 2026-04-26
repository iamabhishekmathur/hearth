import { useState, useCallback, useRef, useEffect } from 'react';
import type { Artifact, ArtifactVersion } from '@/hooks/use-artifacts';
import { ArtifactContent } from './artifact-content';

// ── Type config ──────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<
  Artifact['type'],
  { label: string; icon: string }
> = {
  code: { label: 'Code', icon: '</>' },
  document: { label: 'Document', icon: '\u00b6' },
  diagram: { label: 'Diagram', icon: '\u25e2' },
  table: { label: 'Table', icon: '\u2261' },
  html: { label: 'HTML', icon: '\u29c9' },
  image: { label: 'Image', icon: '\u25a3' },
};

// ── Props ────────────────────────────────────────────────────────────────

interface ArtifactPanelProps {
  artifact: Artifact;
  artifacts: Artifact[];
  versions: ArtifactVersion[];
  onSelectArtifact: (id: string) => void;
  onClose: () => void;
  onFetchVersions: (id: string) => void;
  onSaveContent?: (artifactId: string, content: string) => Promise<void>;
  onRequestRevision?: (instruction: string) => void;
}

// ── Main panel ───────────────────────────────────────────────────────────

export function ArtifactPanel({
  artifact,
  artifacts,
  versions,
  onSelectArtifact,
  onClose,
  onFetchVersions,
  onSaveContent,
  onRequestRevision,
}: ArtifactPanelProps) {
  const [copied, setCopied] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [revisionInput, setRevisionInput] = useState('');
  const [showRevisionInput, setShowRevisionInput] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  // Escape key exits fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!dropdownOpen && !actionsOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownOpen && dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (actionsOpen && actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen, actionsOpen]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable
    }
  }, [artifact.content]);

  const handleDownload = useCallback(() => {
    const ext = getFileExtension(artifact.type, artifact.language);
    const filename = `${artifact.title.replace(/[^a-zA-Z0-9_-]/g, '_')}${ext}`;
    const blob = new Blob([artifact.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [artifact]);

  const typeCfg = TYPE_CONFIG[artifact.type] ?? TYPE_CONFIG.code;

  return (
    <div className={`flex flex-col bg-hearth-bg ${isFullscreen ? 'fixed inset-0 z-50' : 'h-full min-w-0 flex-1 border-l border-hearth-border'}`}>
      {/* ── Header bar (dark) ─────────────────────────────────── */}
      <div className="flex items-center justify-between bg-gray-900 px-4 py-2.5">
        {/* Left: type icon + title + switcher */}
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Type icon */}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-700 text-xs font-bold text-hearth-text-faint">
            {typeCfg.icon}
          </span>

          {/* Title + type label */}
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-white">{artifact.title}</h3>
          </div>

          {/* Type label pill */}
          <span className="shrink-0 rounded-full bg-gray-700 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-hearth-text-faint">
            {typeCfg.label}
          </span>

          {/* Artifact switcher */}
          {artifacts.length > 1 && (
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setDropdownOpen((p) => !p)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-hearth-text-faint transition-colors hover:bg-gray-700 hover:text-gray-200"
              >
                <span className="tabular-nums">{artifacts.indexOf(artifact) + 1}/{artifacts.length}</span>
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                </svg>
              </button>

              {dropdownOpen && (
                <div className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-lg border border-gray-700 bg-gray-800 py-1.5 shadow-hearth-4">
                  {artifacts.map((a) => {
                    const cfg = TYPE_CONFIG[a.type] ?? TYPE_CONFIG.code;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          onSelectArtifact(a.id);
                          setDropdownOpen(false);
                        }}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                          a.id === artifact.id
                            ? 'bg-gray-700 text-white'
                            : 'text-hearth-text-faint hover:bg-gray-700/50 hover:text-white'
                        }`}
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gray-600 text-[9px] font-bold text-hearth-text-faint">
                          {cfg.icon}
                        </span>
                        <span className="truncate">{a.title}</span>
                        <span className="ml-auto shrink-0 text-[10px] uppercase text-hearth-text-muted">{cfg.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex shrink-0 items-center gap-1">
          {/* Edit button */}
          {onSaveContent && !isEditing && (
            <button
              type="button"
              onClick={() => { setEditContent(artifact.content); setIsEditing(true); }}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-hearth-text-faint transition-colors hover:bg-gray-700 hover:text-white"
            >
              Edit
            </button>
          )}
          {isEditing && (
            <>
              <button
                type="button"
                onClick={async () => {
                  await onSaveContent?.(artifact.id, editContent);
                  setIsEditing(false);
                }}
                className="rounded-md bg-hearth-500 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-hearth-600"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-hearth-text-faint transition-colors hover:bg-gray-700 hover:text-white"
              >
                Cancel
              </button>
            </>
          )}

          {/* Copy button */}
          {!isEditing && (
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-hearth-text-faint transition-colors hover:bg-gray-700 hover:text-white"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          )}

          {/* More actions dropdown */}
          <div className="relative" ref={actionsRef}>
            <button
              type="button"
              onClick={() => setActionsOpen((p) => !p)}
              className="rounded-md p-1.5 text-hearth-text-faint transition-colors hover:bg-gray-700 hover:text-gray-200"
              aria-label="More actions"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            </button>

            {actionsOpen && (
              <div className="absolute right-0 top-full z-50 mt-1.5 w-44 rounded-lg border border-gray-700 bg-gray-800 py-1.5 shadow-hearth-4">
                <button
                  type="button"
                  onClick={() => {
                    handleDownload();
                    setActionsOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-hearth-text-faint hover:bg-gray-700 hover:text-white"
                >
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                    <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                  </svg>
                  Download
                </button>
                <div className="mx-3 my-1 border-t border-gray-700" />
                <div className="px-3 py-1.5 text-xs text-hearth-text-muted">
                  Version {artifact.version}
                </div>
              </div>
            )}
          </div>

          {/* Fullscreen toggle */}
          <button
            type="button"
            onClick={() => setIsFullscreen((p) => !p)}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="rounded-md p-1.5 text-hearth-text-faint transition-colors hover:bg-gray-700 hover:text-gray-200"
          >
            {isFullscreen ? (
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M3.28 2.22a.75.75 0 0 0-1.06 1.06L5.94 7H3.75a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 .75-.75v-4.5a.75.75 0 0 0-1.5 0v2.19L3.28 2.22Zm13.44 15.56a.75.75 0 1 0 1.06-1.06L14.06 13h2.19a.75.75 0 0 0 0-1.5h-4.5a.75.75 0 0 0-.75.75v4.5a.75.75 0 0 0 1.5 0v-2.19l3.72 3.72Z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M13.28 7.78 17.22 3.84V6.25a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.41l-3.94 3.94a.75.75 0 1 0 1.06 1.06l.28.28ZM2.78 16.16l3.94-3.94a.75.75 0 1 0-1.06-1.06l-3.94 3.94V12.69a.75.75 0 0 0-1.5 0v4.5c0 .414.336.75.75.75h4.5a.75.75 0 0 0 0-1.5H3.06l-.28-.28Z" />
              </svg>
            )}
          </button>

          {/* Divider */}
          <div className="mx-1 h-5 w-px bg-gray-700" />

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close artifact panel"
            className="rounded-md p-1.5 text-hearth-text-faint transition-colors hover:bg-gray-700 hover:text-gray-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Content area ──────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-8 py-6">
          {isEditing ? (
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className={`h-full min-h-[400px] w-full resize-y rounded-lg border border-hearth-border-strong p-4 text-sm focus:border-hearth-400 focus:outline-none focus:ring-1 focus:ring-hearth-400 ${
                artifact.type === 'code'
                  ? 'bg-gray-900 font-mono text-gray-100'
                  : 'bg-hearth-card text-hearth-text'
              }`}
            />
          ) : (
            <ArtifactContent artifact={artifact} />
          )}
        </div>
      </div>

      {/* ── Ask Hearth to revise ───────────────────────────────── */}
      {onRequestRevision && !isEditing && (
        <div className="border-t border-hearth-border bg-hearth-card px-4 py-2.5">
          {showRevisionInput ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={revisionInput}
                onChange={(e) => setRevisionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && revisionInput.trim()) {
                    onRequestRevision(revisionInput.trim());
                    setRevisionInput('');
                    setShowRevisionInput(false);
                  }
                  if (e.key === 'Escape') setShowRevisionInput(false);
                }}
                placeholder="Describe the change you want..."
                className="flex-1 rounded-lg border border-hearth-border px-3 py-1.5 text-sm focus:border-hearth-400 focus:outline-none"
                autoFocus
              />
              <button
                type="button"
                onClick={() => {
                  if (revisionInput.trim()) {
                    onRequestRevision(revisionInput.trim());
                    setRevisionInput('');
                    setShowRevisionInput(false);
                  }
                }}
                className="rounded-lg bg-hearth-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-hearth-600"
              >
                Send
              </button>
              <button
                type="button"
                onClick={() => setShowRevisionInput(false)}
                className="rounded-lg px-2 py-1.5 text-xs text-hearth-text-faint hover:text-hearth-text-muted"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowRevisionInput(true)}
              className="text-xs text-hearth-text-muted hover:text-hearth-600"
            >
              Ask Hearth to revise...
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function getFileExtension(type: Artifact['type'], language: string | null): string {
  if (type === 'code' && language) {
    const extMap: Record<string, string> = {
      typescript: '.ts',
      javascript: '.js',
      python: '.py',
      rust: '.rs',
      go: '.go',
      java: '.java',
      html: '.html',
      css: '.css',
      json: '.json',
      yaml: '.yaml',
      sql: '.sql',
      bash: '.sh',
      shell: '.sh',
      tsx: '.tsx',
      jsx: '.jsx',
    };
    return extMap[language] ?? '.txt';
  }

  const typeMap: Record<string, string> = {
    document: '.md',
    diagram: '.mmd',
    table: '.html',
    html: '.html',
    image: '.png',
  };
  return typeMap[type] ?? '.txt';
}
