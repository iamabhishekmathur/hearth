interface SkillRowProps {
  skill: {
    id: string;
    name: string;
    description: string | null;
    installCount: number;
    status: string;
  };
  installed: boolean;
  recommended?: boolean;
  selected?: boolean;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  onSelect: () => void;
}

export function SkillRow({
  skill,
  installed,
  recommended,
  selected,
  onInstall,
  onUninstall,
  onSelect,
}: SkillRowProps) {
  return (
    <div
      className={`flex cursor-pointer items-center gap-3 px-6 py-3 transition-colors hover:bg-hearth-bg animate-fade-in ${
        selected ? 'bg-hearth-50' : ''
      }`}
      onClick={onSelect}
    >
      {/* Icon */}
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-hearth-chip text-xs font-semibold text-hearth-text-muted">
        {skill.name
          .split('-')
          .map((w) => w[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-hearth-text">{skill.name}</p>
          {skill.status === 'pending_review' && (
            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              Pending review
            </span>
          )}
          {recommended && (
            <span className="shrink-0 rounded bg-hearth-100 px-1.5 py-0.5 text-[10px] font-medium text-hearth-700">
              Recommended
            </span>
          )}
        </div>
        <p className="truncate text-xs text-hearth-text-muted">{skill.description || 'No description'}</p>
      </div>

      {/* Install count */}
      <span className="shrink-0 text-xs text-hearth-text-faint">{skill.installCount} installs</span>

      {/* Action button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (installed) {
            onUninstall(skill.id);
          } else {
            onInstall(skill.id);
          }
        }}
        className={`shrink-0 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
          installed
            ? 'border border-hearth-border-strong text-hearth-text-muted hover:bg-hearth-chip'
            : 'bg-hearth-600 text-white hover:bg-hearth-700'
        }`}
      >
        {installed ? 'Uninstall' : 'Install'}
      </button>
    </div>
  );
}
