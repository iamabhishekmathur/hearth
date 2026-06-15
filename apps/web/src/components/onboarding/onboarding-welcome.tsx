import { useState } from 'react';
import { FadeIn } from '@/components/ui/motion';
import { HButton, HInput } from '@/components/ui/primitives';
import { HIcon } from '@/components/ui/icon';

/**
 * One-screen warm welcome. A single question — "What do you want help with?" —
 * with quick-pick chips plus free text. Submitting captures the goal (which
 * implicitly starts onboarding server-side) and reveals the checklist. Fully
 * skippable.
 */

const QUICK_PICKS = [
  'Keep up with Slack & email',
  'Summarize my meetings',
  'Track tasks & follow-ups',
  'Find decisions & context',
  'Just exploring',
] as const;

interface OnboardingWelcomeProps {
  /** Capture the goal + start onboarding. */
  onSubmit: (goal: string) => Promise<void>;
  /** Skip the welcome — dismisses onboarding entirely. */
  onSkip: () => void;
}

export function OnboardingWelcome({ onSubmit, onSkip }: OnboardingWelcomeProps) {
  const [goal, setGoal] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
    } catch {
      // Re-enable so the user can retry; the goal text is preserved.
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <FadeIn className="w-full max-w-xl">
        <div className="text-center">
          <div
            className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl text-white font-display font-medium"
            style={{ background: 'var(--hearth-accent-grad)', fontSize: 28, letterSpacing: -0.8 }}
          >
            H
          </div>
          <h1
            className="font-display font-semibold text-hearth-text"
            style={{ fontSize: 30, letterSpacing: -0.6, lineHeight: 1.15 }}
          >
            What do you want help with<span style={{ color: 'var(--hearth-accent)' }}>?</span>
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-hearth-text-muted">
            Tell Hearth what matters to you. We'll use it to set things up around
            how you actually work — you can change this anytime.
          </p>
        </div>

        <div className="mt-7 flex flex-wrap justify-center gap-2">
          {QUICK_PICKS.map((pick) => (
            <button
              key={pick}
              type="button"
              disabled={submitting}
              onClick={() => {
                setGoal(pick);
                void submit(pick);
              }}
              className="rounded-pill border border-hearth-border-strong bg-hearth-card px-3.5 py-2 text-[13px] font-medium text-hearth-text transition-all duration-fast ease-hearth hover:border-hearth-accent disabled:opacity-60"
            >
              {pick}
            </button>
          ))}
        </div>

        <div className="mt-5">
          <HInput
            placeholder="…or tell us in your own words"
            value={goal}
            icon="sparkle"
            autoFocus
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit(goal);
            }}
          />
        </div>

        <div className="mt-6 flex items-center justify-center gap-3">
          <HButton
            variant="accent"
            iconRight="arrow-right"
            disabled={submitting || !goal.trim()}
            onClick={() => void submit(goal)}
          >
            {submitting ? 'Setting up…' : 'Continue'}
          </HButton>
          <button
            type="button"
            onClick={onSkip}
            disabled={submitting}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-hearth-text-faint transition-colors hover:text-hearth-text-muted disabled:opacity-60"
          >
            Skip for now
            <HIcon name="chevron-right" size={13} />
          </button>
        </div>
      </FadeIn>
    </div>
  );
}
