import { useState } from 'react';
import { FadeIn } from '@/components/ui/motion';
import { HButton, HInput } from '@/components/ui/primitives';

/**
 * Step 0 of the onboarding flow — the on-ramp. A warm "Welcome to Hearth" with
 * a one-line value prop, a clear time expectation, and quick-pick goal chips
 * (plus free text). Submitting captures the goal (PATCH welcome, which starts
 * onboarding server-side) and hands off to the guided checklist.
 *
 * This is deliberately framed as the START of a committed setup flow, not an
 * optional aside: a single prominent "Get started" primary, no skip affordance
 * here (skipping lives behind the quiet "I'll finish later" link in the flow).
 */

const QUICK_PICKS = [
  'Keep up with Slack & email',
  'Summarize my meetings',
  'Track tasks & follow-ups',
  'Find decisions & context',
  'Just exploring',
] as const;

interface OnboardingWelcomeProps {
  /** Capture the goal + start onboarding, then advance to the checklist. */
  onSubmit: (goal: string) => Promise<void>;
}

export function OnboardingWelcome({ onSubmit }: OnboardingWelcomeProps) {
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
    <FadeIn className="w-full max-w-xl">
      <div className="text-center">
        <div
          className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl text-white font-display font-medium"
          style={{ background: 'var(--hearth-accent-grad)', fontSize: 32, letterSpacing: -0.8 }}
        >
          H
        </div>
        <h1
          className="font-display font-semibold text-hearth-text"
          style={{ fontSize: 34, letterSpacing: -0.8, lineHeight: 1.1 }}
        >
          Welcome to Hearth
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-hearth-text-muted">
          Hearth pulls your tools, tasks, and team context into one place — so
          you spend less time hunting and more time doing.
        </p>
        <p className="mt-4 text-[13px] font-semibold text-hearth-accent">
          Let&rsquo;s get you set up — about 2 minutes.
        </p>
      </div>

      <div className="mt-8">
        <p className="mb-3 text-center text-[12.5px] font-medium text-hearth-text-muted">
          What do you want help with first?
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {QUICK_PICKS.map((pick) => {
            const active = goal === pick;
            return (
              <button
                key={pick}
                type="button"
                disabled={submitting}
                onClick={() => setGoal(pick)}
                className={`rounded-pill border px-3.5 py-2 text-[13px] font-medium transition-all duration-fast ease-hearth disabled:opacity-60 ${
                  active
                    ? 'border-hearth-accent text-hearth-text shadow-hearth-1'
                    : 'border-hearth-border-strong bg-hearth-card text-hearth-text hover:border-hearth-accent'
                }`}
                style={active ? { background: 'var(--hearth-accent-soft)' } : undefined}
              >
                {pick}
              </button>
            );
          })}
        </div>
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

      <div className="mt-7 flex justify-center">
        <HButton
          variant="accent"
          size="md"
          iconRight="arrow-right"
          disabled={submitting || !goal.trim()}
          onClick={() => void submit(goal)}
        >
          {submitting ? 'Setting up…' : 'Get started'}
        </HButton>
      </div>
    </FadeIn>
  );
}
