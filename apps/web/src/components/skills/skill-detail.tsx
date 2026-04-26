import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface SkillPanelProps {
  skill: {
    id: string;
    name: string;
    description: string | null;
    content: string;
    installCount: number;
    status: string;
    author?: { id: string; name: string };
  };
  installed: boolean;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  onClose: () => void;
}

export function SkillPanel({
  skill,
  installed,
  onInstall,
  onUninstall,
  onClose,
}: SkillPanelProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-hearth-border px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-hearth-text">{skill.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-hearth-text-muted">
            <span>{skill.installCount} installs</span>
            {skill.author && (
              <>
                <span>&middot;</span>
                <span>by {skill.author.name}</span>
              </>
            )}
          </div>
          {skill.status === 'pending_review' && (
            <span className="mt-2 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              Pending admin review
            </span>
          )}
          {skill.status === 'draft' && (
            <span className="mt-2 inline-block rounded bg-hearth-chip px-2 py-0.5 text-xs font-medium text-hearth-text-muted">
              Draft
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-hearth-text-faint hover:bg-hearth-chip hover:text-hearth-text-muted"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>

      {/* Actions */}
      <div className="border-b border-hearth-border px-5 py-3">
        <button
          type="button"
          onClick={() => (installed ? onUninstall(skill.id) : onInstall(skill.id))}
          className={`w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            installed
              ? 'border border-hearth-border-strong text-hearth-text hover:bg-hearth-bg'
              : 'bg-hearth-600 text-white hover:bg-hearth-700'
          }`}
        >
          {installed ? 'Uninstall' : 'Install'}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {skill.description && (
          <p className="mb-4 text-sm text-hearth-text-muted">{skill.description}</p>
        )}
        <div className="prose prose-sm max-w-none prose-headings:text-sm prose-headings:font-semibold prose-p:my-1.5 prose-ul:my-1 prose-li:my-0.5">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{skill.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
