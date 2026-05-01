import { useCallback } from 'react';
import { api } from '@/lib/api-client';
import type { ReactionSummary } from '@hearth/shared';
import { useAuth } from '@/hooks/use-auth';

interface ReactionChipsProps {
  sessionId: string;
  messageId: string;
  reactions: ReactionSummary[];
  align: 'start' | 'end';
}

export function ReactionChips({ sessionId, messageId, reactions, align }: ReactionChipsProps) {
  const { user } = useAuth();
  const myId = user?.id;

  const toggle = useCallback(
    async (r: ReactionSummary) => {
      if (!myId) return;
      const mine = r.userIds.includes(myId);
      try {
        if (mine) {
          await api.delete(
            `/chat/sessions/${sessionId}/messages/${messageId}/reactions/${encodeURIComponent(r.emoji)}`,
          );
        } else {
          await api.post(`/chat/sessions/${sessionId}/messages/${messageId}/reactions`, { emoji: r.emoji });
        }
      } catch {
        // Socket event will reconcile if it landed; silent on error.
      }
    },
    [myId, sessionId, messageId],
  );

  if (reactions.length === 0) return null;

  return (
    <div className={`mt-1 flex flex-wrap gap-1 ${align === 'end' ? 'justify-end' : 'justify-start'}`}>
      {reactions.map((r) => {
        const mine = !!myId && r.userIds.includes(myId);
        return (
          <button
            key={r.emoji}
            type="button"
            onClick={() => toggle(r)}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-none transition-colors"
            style={
              mine
                ? {
                    background: 'color-mix(in srgb, var(--hearth-accent) 14%, transparent)',
                    borderColor: 'var(--hearth-accent)',
                    color: 'var(--hearth-accent)',
                  }
                : {
                    background: 'var(--hearth-card)',
                    borderColor: 'var(--hearth-border)',
                    color: 'var(--hearth-text-muted)',
                  }
            }
            title={`${r.count} ${r.count === 1 ? 'reaction' : 'reactions'}`}
          >
            <span aria-hidden>{r.emoji}</span>
            <span className="font-medium">{r.count}</span>
          </button>
        );
      })}
    </div>
  );
}
