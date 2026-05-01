import { HAvatar } from '@/components/ui/primitives';

interface ThinkingIndicatorProps {
  content?: string | null;
}

export function ThinkingIndicator({ content }: ThinkingIndicatorProps) {
  return (
    <div className="flex gap-3 items-start animate-fade-in">
      <HAvatar kind="agent" />
      <div className="py-2">
        {content ? (
          <p className="text-sm italic text-hearth-text-muted">{content}</p>
        ) : (
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 animate-bounce rounded-full" style={{ background: 'var(--hearth-accent)', animationDelay: '0ms' }} />
            <div className="h-1.5 w-1.5 animate-bounce rounded-full" style={{ background: 'var(--hearth-accent)', animationDelay: '150ms' }} />
            <div className="h-1.5 w-1.5 animate-bounce rounded-full" style={{ background: 'var(--hearth-accent)', animationDelay: '300ms' }} />
          </div>
        )}
      </div>
    </div>
  );
}
