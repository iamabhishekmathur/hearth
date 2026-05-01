import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import { HIcon } from '@/components/ui/icon';
import type { ApiResponse } from '@hearth/shared';

interface RecurrenceMatch {
  messageId: string;
  sessionId: string;
  contentPreview: string;
  similarity: number;
  createdAt: string;
}

interface RecurrenceCheckResponse {
  recurring: boolean;
  matches: RecurrenceMatch[];
}

interface RoutineNudgeProps {
  /** Content of the user message we're checking. */
  prompt: string;
  /** Excluded so we don't match against ourselves on reload. */
  messageId: string;
  /** Per-message dismissal key — persists across reloads. */
  dismissalKey: string;
}

/**
 * Calls the recurrence-check endpoint after the message renders. If the
 * server flags this prompt as recurring, surfaces an inline "make this
 * a routine?" suggestion. Dismissal is persisted in localStorage so
 * the nudge doesn't reappear for the same message.
 */
export function RoutineNudge({ prompt, messageId, dismissalKey }: RoutineNudgeProps) {
  const [recurring, setRecurring] = useState<{ matchCount: number } | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(dismissalKey) === '1';
  });

  useEffect(() => {
    if (dismissed) return;
    if (!prompt || prompt.length < 10) return;
    let cancelled = false;
    void api
      .post<ApiResponse<RecurrenceCheckResponse>>('/recurrence/check', {
        prompt,
        excludeMessageId: messageId,
      })
      .then((res) => {
        if (cancelled) return;
        if (res.data?.recurring) {
          setRecurring({ matchCount: res.data.matches.length });
        }
      })
      .catch(() => {
        // best-effort
      });
    return () => {
      cancelled = true;
    };
  }, [prompt, messageId, dismissed]);

  if (dismissed || !recurring) return null;

  const handleDismiss = () => {
    window.localStorage.setItem(dismissalKey, '1');
    setDismissed(true);
  };

  return (
    <div className="mt-1 flex items-center gap-2 text-[11px] text-hearth-text-faint animate-fade-in">
      <HIcon name="clock" size={11} color="var(--hearth-text-faint)" />
      <span>You've asked something like this {recurring.matchCount + 1} times recently —</span>
      <a href="#/routines" className="font-medium text-hearth-accent hover:underline">make it a routine?</a>
      <button
        type="button"
        onClick={handleDismiss}
        className="ml-1 rounded px-1 text-hearth-text-faint hover:bg-hearth-chip hover:text-hearth-text-muted"
        title="Dismiss this suggestion"
        aria-label="Dismiss"
      >
        <HIcon name="x" size={10} />
      </button>
    </div>
  );
}
