interface DecisionBadgeProps {
  decisionId: string;
  title: string;
}

export function DecisionBadge({ decisionId, title }: DecisionBadgeProps) {
  return (
    <a
      href={`#/decisions?id=${decisionId}`}
      className="inline-flex items-center gap-1.5 rounded-full bg-teal-100 px-3 py-1 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-200"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10 1a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 1ZM5.05 3.05a.75.75 0 0 1 1.06 0l1.062 1.06a.75.75 0 0 1-1.061 1.062L5.05 4.11a.75.75 0 0 1 0-1.06ZM14.95 3.05a.75.75 0 0 1 0 1.06l-1.06 1.062a.75.75 0 0 1-1.062-1.061l1.061-1.06a.75.75 0 0 1 1.06 0ZM3 8a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 3 8ZM14 8a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 14 8ZM10 14a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 14Z" />
        <path fillRule="evenodd" d="M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" clipRule="evenodd" />
      </svg>
      <span className="max-w-[200px] truncate">{title}</span>
    </a>
  );
}
