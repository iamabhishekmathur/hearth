import { useCallback, useEffect, useState } from 'react';
import { FadeIn } from '@/components/ui/motion';
import { HButton } from '@/components/ui/primitives';
import { HIcon } from '@/components/ui/icon';
import { useRoutines } from '@/hooks/use-routines';

/**
 * The daily-brief retention habit-former.
 *
 * Creating the routine wires a daily morning summary that lands in the
 * notification bell each day, giving the user a reason to come back. Track A
 * makes routine_result / digest deliveries into real Notification rows, so the
 * brief actually surfaces.
 *
 * Two surfaces share the same logic via `useDailyBrief`:
 *  - `DailyBriefStep` — folded into the onboarding flow as the encouraged final
 *    step (rendered by the checklist, no own card chrome).
 *  - `DailyBriefOffer` — the standalone floating card shown post-onboarding in
 *    the app shell for users who finished/skipped without setting one up.
 *
 * Both reuse `createRoutine` (which fires ROUTINE_CREATED analytics) and the
 * single DAILY_BRIEF default below — no duplication of routine defaults.
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

interface UseDailyBrief {
  /** Whether we've finished the initial routines fetch. */
  checked: boolean;
  /** Whether the user already has at least one routine. */
  hasRoutines: boolean;
  /** Whether the offer has been dismissed (localStorage-backed). */
  dismissed: boolean;
  state: State;
  create: () => Promise<void>;
  dismiss: () => void;
}

/**
 * Shared daily-brief state: routine existence check, localStorage dismissal,
 * and the one-click create (with its analytics) — used by both surfaces.
 */
export function useDailyBrief(onDismiss?: () => void): UseDailyBrief {
  const { routines, fetchRoutines, createRoutine } = useRoutines();
  const [checked, setChecked] = useState(false);
  const [state, setState] = useState<State>('offer');
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  });

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

  const dismiss = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DISMISS_KEY, '1');
    }
    setDismissed(true);
    onDismiss?.();
  }, [onDismiss]);

  const create = useCallback(async () => {
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

  return {
    checked,
    hasRoutines: routines.length > 0,
    dismissed,
    state,
    create,
    dismiss,
  };
}

// ── Inline final step (folded into the onboarding flow) ──────────────────────

interface DailyBriefStepProps {
  /** Mark this final step seen-to / advance the flow's finish state. */
  onComplete: () => void;
}

/**
 * The daily brief framed as the celebratory FINAL step of the onboarding flow.
 * No card chrome of its own — it renders inside the checklist's hero slot. It's
 * still optional, but framed as recommended ("One last thing"), never as a
 * separate floating offer.
 */
export function DailyBriefStep({ onComplete }: DailyBriefStepProps) {
  const { state, create } = useDailyBrief();

  if (state === 'created') {
    return (
      <div className="text-center">
        <div
          className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full"
          style={{ background: 'color-mix(in srgb, var(--hearth-ok) 16%, transparent)' }}
        >
          <HIcon name="check" size={22} color="var(--hearth-ok)" />
        </div>
        <h2
          className="font-display font-semibold text-hearth-text"
          style={{ fontSize: 22, letterSpacing: -0.4 }}
        >
          You&rsquo;re all set
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-hearth-text-muted">
          Each weekday morning, Hearth will bring your tasks, decisions, and
          anything needing attention straight to your notifications. Hearth now
          comes to you.
        </p>
        <div className="mt-6 flex justify-center">
          <HButton variant="accent" size="md" iconRight="arrow-right" onClick={onComplete}>
            Start using Hearth
          </HButton>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div
        className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full"
        style={{ background: 'var(--hearth-accent-soft)' }}
      >
        <HIcon name="clock" size={22} color="var(--hearth-accent)" />
      </div>
      <p className="text-[12px] font-semibold uppercase tracking-wide text-hearth-accent">
        One last thing
      </p>
      <h2
        className="mt-1.5 font-display font-semibold text-hearth-text"
        style={{ fontSize: 22, letterSpacing: -0.4 }}
      >
        Get a daily brief so Hearth comes to you
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-hearth-text-muted">
        Start each morning with a summary of your open tasks, recent decisions,
        and anything that needs your attention — delivered to your notifications
        every weekday.
      </p>

      {state === 'error' && (
        <p className="mt-3 text-[12.5px] text-hearth-err">
          Couldn&rsquo;t set that up just now. Please try again.
        </p>
      )}

      <div className="mt-6 flex items-center justify-center gap-4">
        <HButton
          variant="accent"
          size="md"
          icon="sparkle"
          disabled={state === 'creating'}
          onClick={() => void create()}
        >
          {state === 'creating' ? 'Setting up…' : 'Turn on daily brief'}
        </HButton>
        <button
          type="button"
          onClick={onComplete}
          disabled={state === 'creating'}
          className="text-[13px] font-medium text-hearth-text-faint transition-colors hover:text-hearth-text-muted disabled:opacity-60"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

// ── Standalone floating offer (post-onboarding) ──────────────────────────────

interface DailyBriefOfferProps {
  /** Optional callback after the user dismisses the offer (skip or after created). */
  onDismiss?: () => void;
}

/**
 * The standalone floating offer for users who reach the app post-onboarding
 * without a daily brief. Self-suppresses if they already have a routine or
 * dismissed it.
 */
export function DailyBriefOffer({ onDismiss }: DailyBriefOfferProps) {
  const { checked, hasRoutines, dismissed, state, create, dismiss } =
    useDailyBrief(onDismiss);

  if (dismissed) return null;
  if (state === 'offer' && (!checked || hasRoutines)) return null;

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
                and anything needing attention — it&rsquo;ll land in your notifications.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <a href="#/routines" className="text-[12px] font-semibold text-hearth-accent hover:underline">
                  View &amp; edit it
                </a>
                <button
                  type="button"
                  onClick={dismiss}
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
              Get a daily brief
            </h2>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismiss}
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
              Couldn&rsquo;t set that up just now. Please try again.
            </p>
          )}

          <div className="mt-3.5 flex items-center gap-3">
            <HButton
              variant="accent"
              size="sm"
              icon="sparkle"
              disabled={state === 'creating'}
              onClick={() => void create()}
            >
              {state === 'creating' ? 'Setting up…' : 'Turn on daily brief'}
            </HButton>
            <button
              type="button"
              onClick={dismiss}
              disabled={state === 'creating'}
              className="text-[12px] font-medium text-hearth-text-faint transition-colors hover:text-hearth-text-muted disabled:opacity-60"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </FadeIn>
  );
}
