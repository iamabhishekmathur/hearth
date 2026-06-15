import { useCallback, useEffect, useState } from 'react';
import { FadeIn } from '@/components/ui/motion';
import { HButton } from '@/components/ui/primitives';
import { HIcon } from '@/components/ui/icon';
import { useRoutines } from '@/hooks/use-routines';

/**
 * One-click "Set up your daily brief" offer — the retention habit-former.
 *
 * Shown once the activation checklist is complete (or on dismiss). Creating the
 * routine wires a daily morning summary that lands in the notification bell each
 * day, giving the user a reason to come back. Track A makes routine_result /
 * digest deliveries into real Notification rows, so the brief actually surfaces.
 *
 * Behaviour:
 *  - Don't nag: if the user already has any routine, render nothing.
 *  - One click: POST /routines with a sensible default (daily 8am, in_app).
 *    createRoutine already fires ROUTINE_CREATED analytics — reused here.
 *  - Skippable: dismissal persists in localStorage so it doesn't reappear.
 *  - Confirmation: on success, swap to a "you're set" state.
 */

const DISMISS_KEY = 'hearth:daily-brief-offer-dismissed';

// Default daily brief — 8am every weekday morning, delivered in-app.
const DAILY_BRIEF = {
  name: 'Daily brief',
  description: 'Your morning summary of tasks, decisions, and what needs attention.',
  prompt:
    'Summarize my open tasks, recent decisions, and anything that needs my attention today.',
  schedule: '0 8 * * 1-5',
  delivery: { channels: ['in_app'] as const },
} as const;

type State = 'offer' | 'creating' | 'created' | 'error';

interface DailyBriefOfferProps {
  /** Optional callback after the user dismisses the offer (skip or after created). */
  onDismiss?: () => void;
}

export function DailyBriefOffer({ onDismiss }: DailyBriefOfferProps) {
  const { routines, fetchRoutines, createRoutine } = useRoutines();
  const [checked, setChecked] = useState(false);
  const [state, setState] = useState<State>('offer');
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  });

  // Don't nag people who already have routines — pull their list once.
  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;
    void fetchRoutines().finally(() => {
      if (!cancelled) setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [dismissed, fetchRoutines]);

  const handleDismiss = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DISMISS_KEY, '1');
    }
    setDismissed(true);
    onDismiss?.();
  }, [onDismiss]);

  const handleCreate = useCallback(async () => {
    setState('creating');
    try {
      // createRoutine fires ROUTINE_CREATED analytics internally.
      await createRoutine({
        name: DAILY_BRIEF.name,
        description: DAILY_BRIEF.description,
        prompt: DAILY_BRIEF.prompt,
        schedule: DAILY_BRIEF.schedule,
        delivery: { channels: [...DAILY_BRIEF.delivery.channels] },
      });
      setState('created');
    } catch {
      setState('error');
    }
  }, [createRoutine]);

  // Suppress until we've confirmed the user has no routines (avoids a flash and
  // honours the "don't nag if they already have routines" rule). Always show
  // the confirmation state once they've created one this session.
  if (dismissed) return null;
  if (state === 'offer' && (!checked || routines.length > 0)) return null;

  if (state === 'created') {
    return (
      <FadeIn className="w-[360px] max-w-[calc(100vw-2rem)]">
        <div className="overflow-hidden rounded-lg border border-hearth-border bg-hearth-card shadow-hearth-2">
          <div className="flex items-start gap-3 px-4 py-3.5">
            <div
              className="mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-full"
              style={{ background: 'color-mix(in srgb, var(--hearth-ok) 16%, transparent)' }}
            >
              <HIcon name="check" size={16} color="var(--hearth-ok)" />
            </div>
            <div className="min-w-0 flex-1">
              <h2
                className="font-display font-semibold text-hearth-text"
                style={{ fontSize: 15, letterSpacing: -0.2 }}
              >
                Your daily brief is set
              </h2>
              <p className="mt-1 text-[12px] leading-snug text-hearth-text-muted">
                Each weekday morning, Hearth will summarize your tasks, decisions,
                and anything needing attention — it'll land in your notifications.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <a href="#/routines" className="text-[12px] font-semibold text-hearth-accent hover:underline">
                  View &amp; edit it
                </a>
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="text-[12px] font-medium text-hearth-text-faint transition-colors hover:text-hearth-text-muted"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        </div>
      </FadeIn>
    );
  }

  return (
    <FadeIn className="w-[360px] max-w-[calc(100vw-2rem)]">
      <div className="overflow-hidden rounded-lg border border-hearth-border bg-hearth-card shadow-hearth-2">
        <div className="flex items-start justify-between gap-3 border-b border-hearth-border px-4 py-3.5">
          <div className="flex items-center gap-2">
            <HIcon name="clock" size={15} color="var(--hearth-accent)" />
            <h2
              className="font-display font-semibold text-hearth-text"
              style={{ fontSize: 15, letterSpacing: -0.2 }}
            >
              Set up your daily brief
            </h2>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={handleDismiss}
            className="rounded p-1 text-hearth-text-faint transition-colors hover:text-hearth-text"
          >
            <HIcon name="x" size={15} />
          </button>
        </div>

        <div className="px-4 py-3.5">
          <p className="text-[12.5px] leading-relaxed text-hearth-text-muted">
            Start each morning with a summary of your open tasks, recent
            decisions, and anything that needs your attention — delivered to your
            notifications every weekday.
          </p>

          {state === 'error' && (
            <p className="mt-2 text-[12px] text-hearth-err">
              Couldn't set that up just now. Please try again.
            </p>
          )}

          <div className="mt-3.5 flex items-center gap-3">
            <HButton
              variant="accent"
              size="sm"
              icon="sparkle"
              disabled={state === 'creating'}
              onClick={() => void handleCreate()}
            >
              {state === 'creating' ? 'Setting up…' : 'Set up daily brief'}
            </HButton>
            <button
              type="button"
              onClick={handleDismiss}
              disabled={state === 'creating'}
              className="text-[12px] font-medium text-hearth-text-faint transition-colors hover:text-hearth-text-muted disabled:opacity-60"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </FadeIn>
  );
}
