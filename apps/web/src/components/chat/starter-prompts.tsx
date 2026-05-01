import { HCard } from '@/components/ui/primitives';
import { HIcon } from '@/components/ui/icon';

const STARTERS = [
  { icon: 'sparkle', label: 'Summarize my tasks', prompt: 'Summarize my current tasks and priorities', accent: true },
  { icon: 'search', label: 'Search the web', prompt: 'Search the web for ' },
  { icon: 'doc', label: 'Draft a document', prompt: 'Create a document about ' },
  { icon: 'clock', label: 'Create a routine', prompt: 'Create a routine that ' },
];

interface StarterPromptsProps {
  onSelect: (prompt: string) => void;
}

export function StarterPrompts({ onSelect }: StarterPromptsProps) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 animate-fade-in">
      <div className="flex flex-col items-center gap-7 text-center" style={{ maxWidth: 720 }}>
        {/* Logo */}
        <div
          className="grid place-items-center rounded-xl text-white font-display font-medium"
          style={{ width: 56, height: 56, background: 'var(--hearth-accent-grad)', fontSize: 28, letterSpacing: -0.8 }}
        >
          H
        </div>

        {/* Hero title */}
        <div>
          <div className="font-display font-medium tracking-tight" style={{ fontSize: 44, lineHeight: 1.05, letterSpacing: -1.3 }}>
            What should we figure out<span style={{ color: 'var(--hearth-accent)' }}>?</span>
          </div>
          <p className="mt-2.5 text-[15px] text-hearth-text-muted">
            Type a message below or choose a suggestion.
          </p>
        </div>

        {/* Suggestion cards */}
        <div className="w-full">
          <div className="hearth-eyebrow text-left mb-2.5">Suggestions</div>
          <div className="grid grid-cols-2 gap-2.5">
            {STARTERS.map((s) => (
              <HCard
                key={s.label}
                variant={s.accent ? 'hero' : 'default'}
                padding="p-3.5"
                className="flex items-center gap-3 text-left"
                onClick={() => onSelect(s.prompt)}
              >
                <div
                  className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-sm"
                  style={{
                    background: s.accent ? 'var(--hearth-accent-grad)' : 'var(--hearth-chip)',
                    color: s.accent ? '#fff' : 'var(--hearth-text-muted)',
                  }}
                >
                  <HIcon name={s.icon} size={14} color={s.accent ? '#fff' : 'var(--hearth-text-muted)'} />
                </div>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-hearth-text">{s.label}</div>
                  <div className="text-[12.5px] text-hearth-text-muted mt-0.5">{s.prompt}</div>
                </div>
              </HCard>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
