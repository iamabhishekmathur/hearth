import type { Artifact } from '@/hooks/use-artifacts';

const TYPE_META: Record<Artifact['type'], { label: string; icon: string; accent: string }> = {
  code: { label: 'Code', icon: '</>', accent: 'bg-violet-100 text-violet-700' },
  document: { label: 'Document', icon: 'Doc', accent: 'bg-blue-100 text-blue-700' },
  diagram: { label: 'Diagram', icon: 'Dia', accent: 'bg-emerald-100 text-emerald-700' },
  table: { label: 'Table', icon: 'Tbl', accent: 'bg-amber-100 text-amber-700' },
  html: { label: 'Web page', icon: 'Web', accent: 'bg-orange-100 text-orange-700' },
  image: { label: 'Image', icon: 'Img', accent: 'bg-pink-100 text-pink-700' },
};

interface ArtifactBadgeProps {
  title: string;
  type: Artifact['type'];
  onClick: () => void;
}

export function ArtifactBadge({ title, type, onClick }: ArtifactBadgeProps) {
  const cfg = TYPE_META[type] ?? TYPE_META.code;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full max-w-sm items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${cfg.accent}`}
      >
        {cfg.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-800">{title}</span>
        <span className="block text-xs text-slate-500">{cfg.label} · Click to open</span>
      </span>
      <span className="flex items-center gap-1 text-xs font-medium text-blue-600 opacity-0 transition-opacity group-hover:opacity-100">
        Open
      </span>
      <svg
        className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M3 10a.75.75 0 0 1 .75-.75h10.638l-3.96-3.96a.75.75 0 1 1 1.06-1.06l5.25 5.25a.75.75 0 0 1 0 1.06l-5.25 5.25a.75.75 0 1 1-1.06-1.06l3.96-3.96H3.75A.75.75 0 0 1 3 10Z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}
