import { useMemo, useState } from 'react';
import {
  ONBOARDING_STEPS,
  stepsForRole,
  type OnboardingStatus,
  type OnboardingStep,
} from '@hearth/shared';
import { FadeIn } from '@/components/ui/motion';
import { HButton } from '@/components/ui/primitives';
import { HIcon } from '@/components/ui/icon';
import { trackEvent, AnalyticsEvent } from '@/lib/analytics-events';
import { STEP_META, runStepAction } from './steps';
import { DailyBriefStep } from './daily-brief-offer';

/**
 * The guided activation flow — the centered, focused experience that occupies
 * the main content area while the user is onboarding. It is NOT a corner
 * widget: it leads with momentum (a "Step X of N" progress bar), renders the
 * current/next step as a benefit-led HERO card with a strong primary CTA, and
 * shows completed steps ticked + upcoming steps muted beneath it.
 *
 * connect_integration leads the taxonomy and is framed as the aha. Once every
 * taxonomy step is done, the flow folds in the daily-brief as a celebratory
 * final step (DailyBriefStep) before finishing.
 *
 * Completions are driven server-side (Track B) — this component navigates and
 * re-fetches; it never derives completion locally.
 *
 * Skipping is deliberately quiet: a single low-contrast "I'll finish later"
 * link opens a gentle confirm dialog; there is no one-tap dismiss.
 */

interface OnboardingChecklistProps {
  status: OnboardingStatus;
  /** Current user's role — scopes which steps show (admin-only steps hidden for members). */
  role: string | null | undefined;
  /** Permanently dismiss onboarding (PATCH dismiss). */
  onDismiss: () => void;
  /** Re-pull status so newly-completed steps reflect when the user returns. */
  onRefresh: () => void;
  /** Finish the flow without dismissing (all real steps done — flips needsOnboarding via dismiss). */
  onFinish: () => void;
}

export function OnboardingChecklist({
  status,
  role,
  onDismiss,
  onRefresh,
  onFinish,
}: OnboardingChecklistProps) {
  // The applicable step set for this role — must match the server's role-scoped
  // computation (see stepsForRole) so progress and nextStep line up.
  const steps = useMemo(() => stepsForRole(role), [role]);
  const completed = useMemo(
    () => new Set(status.state.completedSteps),
    [status.state.completedSteps],
  );
  const total = steps.length;
  const doneCount = steps.filter((s) => completed.has(s)).length;
  const allStepsDone = doneCount >= total;

  const [confirmingSkip, setConfirmingSkip] = useState(false);

  // The hero is the server-computed nextStep, or — when every taxonomy step is
  // done — the folded-in daily-brief finale.
  const heroStep = status.nextStep;

  const handleStepClick = (step: OnboardingStep) => {
    const navigated = runStepAction(step);
    if (!navigated) return; // placeholder (invite_teammate) — no-op
    // Completion is recorded server-side once the user does the thing; re-pull
    // when they come back so the tick appears.
    onRefresh();
  };

  // Progress: count the daily-brief finale as the (N+1)th milestone so the bar
  // doesn't read "100%" before the celebratory step.
  const flowTotal = total + 1;
  const flowDone = doneCount; // finale isn't "done" until they finish/turn it on
  const stepNumber = Math.min(doneCount + 1, flowTotal);

  return (
    <FadeIn className="w-full max-w-2xl">
      {/* Progress header — front and centre, builds momentum. */}
      <div className="mb-6">
        <div className="flex items-baseline justify-between">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-hearth-accent">
            Setting up Hearth
          </p>
          <p className="text-[12.5px] font-medium text-hearth-text-muted">
            Step {stepNumber} of {flowTotal}
          </p>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-pill bg-hearth-chip">
          <div
            className="h-full rounded-pill transition-all duration-base ease-hearth"
            style={{
              width: `${(flowDone / flowTotal) * 100}%`,
              background: 'var(--hearth-accent-grad)',
            }}
          />
        </div>
      </div>

      {/* Hero card — the current/next step, benefit-led. */}
      <div
        className="rounded-xl border p-7 shadow-hearth-2"
        style={{
          background:
            'linear-gradient(135deg, var(--hearth-accent-soft), var(--hearth-accent-soft-2))',
          borderColor: 'color-mix(in srgb, var(--hearth-accent) 40%, transparent)',
        }}
      >
        {allStepsDone || !heroStep ? (
          <DailyBriefStep onComplete={onFinish} />
        ) : (
          <HeroStep step={heroStep} onAct={() => handleStepClick(heroStep)} />
        )}
      </div>

      {/* Step list — completed ticked, upcoming muted, current highlighted. */}
      <ul className="mt-6 space-y-1">
        {steps.map((step) => {
          const meta = STEP_META[step];
          const isDone = completed.has(step);
          const isCurrent = !allStepsDone && heroStep === step;

          return (
            <li
              key={step}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                isCurrent ? '' : 'opacity-100'
              }`}
              style={isCurrent ? { background: 'var(--hearth-accent-soft)' } : undefined}
            >
              <div
                className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full"
                style={{
                  background: isDone
                    ? 'color-mix(in srgb, var(--hearth-ok) 16%, transparent)'
                    : 'var(--hearth-chip)',
                }}
              >
                {isDone ? (
                  <HIcon name="check" size={13} color="var(--hearth-ok)" />
                ) : (
                  <HIcon
                    name={meta.icon}
                    size={12}
                    color={isCurrent ? 'var(--hearth-accent)' : 'var(--hearth-text-faint)'}
                  />
                )}
              </div>
              <span
                className={`flex-1 text-[13.5px] font-medium ${
                  isDone
                    ? 'text-hearth-text-muted'
                    : isCurrent
                      ? 'text-hearth-text font-semibold'
                      : 'text-hearth-text-faint'
                }`}
              >
                {meta.title}
              </span>
              {isCurrent && (
                <span className="text-[11px] font-semibold uppercase tracking-wide text-hearth-accent">
                  Now
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {/* Quiet, low-contrast skip — a deliberate extra click via confirm. */}
      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => setConfirmingSkip(true)}
          className="text-[12.5px] font-medium text-hearth-text-faint underline-offset-2 transition-colors hover:text-hearth-text-muted hover:underline"
        >
          I&rsquo;ll finish later
        </button>
      </div>

      {confirmingSkip && (
        <SkipConfirm
          onKeepGoing={() => setConfirmingSkip(false)}
          onSkip={() => {
            setConfirmingSkip(false);
            onDismiss();
          }}
        />
      )}
    </FadeIn>
  );
}

// ── Hero step (benefit-led current step) ─────────────────────────────────────

function HeroStep({ step, onAct }: { step: OnboardingStep; onAct: () => void }) {
  const meta = STEP_META[step];
  const isPlaceholder = meta.action.kind === 'placeholder';

  return (
    <div className="text-center">
      <div
        className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-hearth-card shadow-hearth-1"
      >
        <HIcon name={meta.icon} size={22} color="var(--hearth-accent)" />
      </div>
      <h2
        className="font-display font-semibold text-hearth-text"
        style={{ fontSize: 24, letterSpacing: -0.5, lineHeight: 1.15 }}
      >
        {meta.headline}
      </h2>
      <p className="mx-auto mt-2.5 max-w-md text-[14px] leading-relaxed text-hearth-text-muted">
        {meta.description}
      </p>
      <div className="mt-6 flex justify-center">
        <HButton
          variant="accent"
          size="md"
          disabled={isPlaceholder}
          iconRight={isPlaceholder ? undefined : 'arrow-right'}
          onClick={onAct}
        >
          {meta.cta}
        </HButton>
      </div>
    </div>
  );
}

// ── Gentle skip confirmation ─────────────────────────────────────────────────

function SkipConfirm({
  onKeepGoing,
  onSkip,
}: {
  onKeepGoing: () => void;
  onSkip: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-6"
      style={{ background: 'color-mix(in srgb, var(--hearth-bg) 70%, transparent)' }}
      onClick={onKeepGoing}
    >
      <FadeIn variant="scale-in" className="w-full max-w-md">
        <div
          className="rounded-xl border border-hearth-border bg-hearth-card p-6 shadow-hearth-3"
          onClick={(e) => e.stopPropagation()}
        >
          <h3
            className="font-display font-semibold text-hearth-text"
            style={{ fontSize: 19, letterSpacing: -0.3 }}
          >
            Finish setting up?
          </h3>
          <p className="mt-2 text-[13.5px] leading-relaxed text-hearth-text-muted">
            Hearth works best once it knows your tools and goals — you&rsquo;ll get
            more value in less time. You can always finish later from your profile
            menu.
          </p>
          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onSkip}
              className="text-[13px] font-medium text-hearth-text-faint transition-colors hover:text-hearth-text-muted"
            >
              Skip anyway
            </button>
            <HButton variant="accent" size="md" onClick={onKeepGoing}>
              Keep setting up
            </HButton>
          </div>
        </div>
      </FadeIn>
    </div>
  );
}

/**
 * Fire analytics for a step the server just reported as newly completed. Called
 * from the surface when it observes completedSteps grow, so emission stays tied
 * to real server-confirmed completion (not optimistic UI). connect_integration
 * additionally emits AHA_REACHED.
 */
export function emitStepCompletedAnalytics(step: OnboardingStep): void {
  trackEvent(AnalyticsEvent.ONBOARDING_STEP_COMPLETED, {
    step,
    stepIndex: ONBOARDING_STEPS.indexOf(step),
  });
  if (step === 'connect_integration') {
    trackEvent(AnalyticsEvent.AHA_REACHED, { via: 'integration_pull' });
  }
}
