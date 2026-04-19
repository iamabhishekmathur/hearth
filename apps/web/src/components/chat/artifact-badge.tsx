import type { Artifact } from '@/hooks/use-artifacts';

const TYPE_ICONS: Record<Artifact['type'], { icon: string; bg: string; text: string }> = {
  code: { icon: '</>', bg: 'bg-violet-50 hover:bg-violet-100', text: 'text-violet-700' },
  document: { icon: 'Doc', bg: 'bg-blue-50 hover:bg-blue-100', text: 'text-blue-700' },
  diagram: { icon: 'Dia', bg: 'bg-emerald-50 hover:bg-emerald-100', text: 'text-emerald-700' },
  table: { icon: 'Tbl', bg: 'bg-amber-50 hover:bg-amber-100', text: 'text-amber-700' },
  html: { icon: 'Web', bg: 'bg-orange-50 hover:bg-orange-100', text: 'text-orange-700' },
  image: { icon: 'Img', bg: 'bg-pink-50 hover:bg-pink-100', text: 'text-pink-700' },
};

interface ArtifactBadgeProps {
  title: string;
  type: Artifact['type'];
  onClick: () => void;
}

export function ArtifactBadge({ title, type, onClick }: ArtifactBadgeProps) {
  const cfg = TYPE_ICONS[type] ?? TYPE_ICONS.code;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${cfg.bg} ${cfg.text}`}
    >
      <span className="text-[10px] font-bold opacity-70">{cfg.icon}</span>
      <span className="max-w-[180px] truncate">{title}</span>
      <svg className="h-3 w-3 shrink-0 opacity-50" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M3 10a.75.75 0 0 1 .75-.75h10.638l-3.96-3.96a.75.75 0 1 1 1.06-1.06l5.25 5.25a.75.75 0 0 1 0 1.06l-5.25 5.25a.75.75 0 1 1-1.06-1.06l3.96-3.96H3.75A.75.75 0 0 1 3 10Z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}
