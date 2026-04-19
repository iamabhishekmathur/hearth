import { useState, useCallback, useRef, useEffect } from 'react';
import DOMPurify from 'dompurify';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Artifact, ArtifactVersion } from '@/hooks/use-artifacts';

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
}

// ── Main panel ───────────────────────────────────────────────────────────

export function ArtifactPanel({
  artifact,
  artifacts,
  versions,
  onSelectArtifact,
  onClose,
  onFetchVersions,
}: ArtifactPanelProps) {
  const [copied, setCopied] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

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
    <div className="flex h-full min-w-0 flex-1 flex-col border-l border-gray-200 bg-gray-50">
      {/* ── Header bar (dark) ─────────────────────────────────── */}
      <div className="flex items-center justify-between bg-gray-900 px-4 py-2.5">
        {/* Left: type icon + title + switcher */}
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Type icon */}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-700 text-xs font-bold text-gray-300">
            {typeCfg.icon}
          </span>

          {/* Title + type label */}
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-white">{artifact.title}</h3>
          </div>

          {/* Type label pill */}
          <span className="shrink-0 rounded-full bg-gray-700 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-400">
            {typeCfg.label}
          </span>

          {/* Artifact switcher */}
          {artifacts.length > 1 && (
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setDropdownOpen((p) => !p)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
              >
                <span className="tabular-nums">{artifacts.indexOf(artifact) + 1}/{artifacts.length}</span>
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                </svg>
              </button>

              {dropdownOpen && (
                <div className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-lg border border-gray-700 bg-gray-800 py-1.5 shadow-xl">
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
                            : 'text-gray-300 hover:bg-gray-700/50 hover:text-white'
                        }`}
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gray-600 text-[9px] font-bold text-gray-300">
                          {cfg.icon}
                        </span>
                        <span className="truncate">{a.title}</span>
                        <span className="ml-auto shrink-0 text-[10px] uppercase text-gray-500">{cfg.label}</span>
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
          {/* Copy button */}
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>

          {/* More actions dropdown */}
          <div className="relative" ref={actionsRef}>
            <button
              type="button"
              onClick={() => setActionsOpen((p) => !p)}
              className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
              aria-label="More actions"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            </button>

            {actionsOpen && (
              <div className="absolute right-0 top-full z-50 mt-1.5 w-44 rounded-lg border border-gray-700 bg-gray-800 py-1.5 shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    handleDownload();
                    setActionsOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                >
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                    <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                  </svg>
                  Download
                </button>
                <div className="mx-3 my-1 border-t border-gray-700" />
                <div className="px-3 py-1.5 text-xs text-gray-500">
                  Version {artifact.version}
                </div>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="mx-1 h-5 w-px bg-gray-700" />

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close artifact panel"
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
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
          <ArtifactContent artifact={artifact} />
        </div>
      </div>
    </div>
  );
}

// ── Content renderer ─────────────────────────────────────────────────────

function ArtifactContent({ artifact }: { artifact: Artifact }) {
  switch (artifact.type) {
    case 'code':
      return (
        <div className="overflow-hidden rounded-lg shadow-sm">
          {artifact.language && (
            <div className="bg-gray-800 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
              {artifact.language}
            </div>
          )}
          <SyntaxHighlighter
            style={oneDark}
            language={artifact.language ?? 'text'}
            PreTag="div"
            customStyle={{
              margin: 0,
              borderRadius: artifact.language ? '0 0 0.5rem 0.5rem' : '0.5rem',
              fontSize: '0.8125rem',
              lineHeight: '1.6',
              padding: '1.25rem',
            }}
          >
            {artifact.content}
          </SyntaxHighlighter>
        </div>
      );

    case 'document':
      return (
        <article className="prose prose-gray max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-xl prose-h1:mb-4 prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3 prose-h3:text-base prose-h3:mt-6 prose-h3:mb-2 prose-p:leading-relaxed prose-p:text-gray-600 prose-li:text-gray-600 prose-strong:text-gray-900 prose-table:text-sm prose-th:text-left prose-th:font-semibold prose-th:text-gray-700 prose-td:text-gray-600">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const codeString = String(children).replace(/\n$/, '');

                if (match) {
                  return (
                    <SyntaxHighlighter
                      style={oneDark}
                      language={match[1]}
                      PreTag="div"
                      customStyle={{
                        borderRadius: '0.5rem',
                        fontSize: '0.8125rem',
                        lineHeight: '1.6',
                      }}
                    >
                      {codeString}
                    </SyntaxHighlighter>
                  );
                }

                return (
                  <code
                    className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[13px] font-medium text-hearth-700"
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
            }}
          >
            {artifact.content}
          </ReactMarkdown>
        </article>
      );

    case 'diagram':
      return (
        <div className="overflow-hidden rounded-lg shadow-sm">
          <div className="bg-gray-800 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Mermaid
          </div>
          <SyntaxHighlighter
            style={oneDark}
            language="text"
            PreTag="div"
            customStyle={{
              margin: 0,
              borderRadius: '0 0 0.5rem 0.5rem',
              fontSize: '0.8125rem',
              lineHeight: '1.6',
              padding: '1.25rem',
            }}
          >
            {artifact.content}
          </SyntaxHighlighter>
        </div>
      );

    case 'table':
      return (
        <div className="overflow-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <div
            className="prose prose-gray max-w-none prose-table:m-0 prose-th:text-left prose-th:font-semibold"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(artifact.content) }}
          />
        </div>
      );

    case 'html':
      return (
        <div className="overflow-auto rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(artifact.content) }} />
        </div>
      );

    case 'image':
      return (
        <div className="flex items-center justify-center py-4">
          <img
            src={artifact.content}
            alt={artifact.title}
            className="max-h-[60vh] max-w-full rounded-lg object-contain shadow-sm"
          />
        </div>
      );

    default:
      return (
        <pre className="whitespace-pre-wrap rounded-lg bg-white p-6 text-sm leading-relaxed text-gray-700 shadow-sm ring-1 ring-gray-200">
          {artifact.content}
        </pre>
      );
  }
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
