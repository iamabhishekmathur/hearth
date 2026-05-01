import { HIcon } from '@/components/ui/icon';

interface SideEffectNoticeProps {
  toolName: string;
  provider: string;
  onDismiss: () => void;
}

/**
 * Inline banner shown when the agent invoked a tool that wrote to an
 * external system. Suggests promoting similar future requests into a
 * task with a review gate.
 */
export function SideEffectNotice({ toolName, provider, onDismiss }: SideEffectNoticeProps) {
  return (
    <div
      className="flex items-center justify-between gap-3 border-b px-5 py-2 text-[12px] animate-fade-in"
      style={{
        borderColor: 'color-mix(in srgb, var(--hearth-warn) 35%, transparent)',
        background: 'color-mix(in srgb, var(--hearth-warn) 10%, transparent)',
        color: 'var(--hearth-text)',
      }}
    >
      <div className="flex items-center gap-2">
        <HIcon name="lock" size={12} color="var(--hearth-warn)" />
        <span>
          The agent just wrote to <span className="font-medium">{provider}</span> via{' '}
          <code className="rounded bg-hearth-chip px-1 py-0.5 font-mono text-[10.5px] text-hearth-text-muted">
            {toolName}
          </code>
          . For repeat work like this, promote to a task with a review gate.
        </span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded p-0.5 text-hearth-text-faint hover:bg-hearth-chip hover:text-hearth-text-muted"
        aria-label="Dismiss"
      >
        <HIcon name="x" size={12} />
      </button>
    </div>
  );
}
