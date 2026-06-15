import { useMemo } from 'react';
import {
  ONBOARDING_STEPS,
  type OnboardingStatus,
  type OnboardingStep,
} from '@hearth/shared';
import { FadeIn } from '@/components/ui/motion';
import { HButton } from '@/components/ui/primitives';
import { HIcon } from '@/components/ui/icon';
import { trackEvent, AnalyticsEvent } from '@/lib/analytics-events';
import { STEP_META, runStepAction } from './steps';

/**
 * The persistent, dismissible activation checklist. Renders ONBOARDING_STEPS in
 * taxonomy order with completion ticks, highlights the server-computed
 * nextStep, and gives each step a CTA. connect_integration leads (it is the
 * aha). Completions are driven server-side (Track B) — this component only
 * navigates and re-fetches.
 */

interface OnboardingChecklistProps {
  status: OnboardingStatus;
  /** Collapse/hide the panel without dismissing onboarding for good. */
  onCollapse: () => void;
  /** Permanently dismiss onboarding (PATCH dismiss). */
  onDismiss: () => void;
  /** Re-pull status so newly-completed steps reflect when the user returns. */
  onRefresh: () => void;
}

export function OnboardingChecklist({
  status,
  onCollapse,
  onDismiss,
  onRefresh,
}: OnboardingChecklistProps) {
  const completed = useMemo(
    () => new Set(status.state.completedSteps),
    [status.state.completedSteps],
  );
  const doneCount = completed.size;
  const total = ONBOARDING_STEPS.length;
  const allDone = doneCount >= total;

  const handleStepClick = (step: OnboardingStep) => {
    const navigated = runStepAction(step);
    if (!navigated) return; // placeholder (invite_teammate) — no-op
    // Completion is recorded server-side once the user does the thing; re-pull
    // when they come back so the tick appears.
    onRefresh();
  };

  return (
    <FadeIn className="w-[360px] max-w-[calc(100vw-2rem)]">
      <div className="overflow-hidden rounded-lg border border-hearth-border bg-hearth-card shadow-hearth-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-hearth-border px-4 py-3.5">
          <div>
            <div className="flex items-center gap-2">
              <HIcon name="sparkle" size={15} color="var(--hearth-accent)" />
              <h2 className="font-display font-semibold text-hearth-text" style={{ fontSize: 16, letterSpacing: -0.2 }}>
                {allDone ? "You're all set" : 'Get started with Hearth'}
              </h2>
            </div>
            <p className="mt-1 text-[12px] text-hearth-text-muted">
              {allDone
                ? 'Nice work — everything below is done.'
                : `${doneCount} of ${total} done`}
            </p>
          </div>
          <button
            type="button"
            aria-label="Collapse"
            onClick={onCollapse}
            className="rounded p-1 text-hearth-text-faint transition-colors hover:text-hearth-text"
          >
            <HIcon name="x" size={15} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 w-full bg-hearth-chip">
          <div
            className="h-full transition-all duration-base ease-hearth"
            style={{
              width: `${(doneCount / total) * 100}%`,
              background: 'var(--hearth-accent-grad)',
            }}
          />
        </div>

        {/* Steps */}
        <ul className="divide-y divide-hearth-border">
          {ONBOARDING_STEPS.map((step) => {
            const meta = STEP_META[step];
            const isDone = completed.has(step);
            const isNext = status.nextStep === step;
            const isPlaceholder = meta.action.kind === 'placeholder';

            return (
              <li
                key={step}
                className="flex items-start gap-3 px-4 py-3"
                style={isNext ? { background: 'var(--hearth-accent-soft)' } : undefined}
              >
                {/* Tick / icon */}
                <div
                  className="mt-0.5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-full"
                  style={{
                    background: isDone
                      ? 'color-mix(in srgb, var(--hearth-ok) 16%, transparent)'
                      : 'var(--hearth-chip)',
                  }}
                >
                  {isDone ? (
                    <HIcon name="check" size={15} color="var(--hearth-ok)" />
                  ) : (
                    <HIcon
                      name={meta.icon}
                      size={14}
                      color={isNext ? 'var(--hearth-accent)' : 'var(--hearth-text-muted)'}
                    />
                  )}
                </div>

                {/* Copy + CTA */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[13.5px] font-semibold ${
                        isDone ? 'text-hearth-text-muted line-through' : 'text-hearth-text'
                      }`}
                    >
                      {meta.title}
                    </span>
                  </div>
                  {!isDone && (
                    <p className="mt-0.5 text-[12px] leading-snug text-hearth-text-muted">
                      {meta.description}
                    </p>
                  )}
                  {!isDone && (
                    <div className="mt-2">
                      <HButton
                        variant={isNext ? 'accent' : 'secondary'}
                        size="sm"
                        disabled={isPlaceholder}
                        iconRight={isPlaceholder ? undefined : 'arrow-right'}
                        onClick={() => handleStepClick(step)}
                      >
                        {meta.cta}
                      </HButton>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-hearth-border px-4 py-2.5">
          <button
            type="button"
            onClick={onDismiss}
            className="text-[12px] font-medium text-hearth-text-faint transition-colors hover:text-hearth-text-muted"
          >
            {allDone ? 'Done' : 'Skip for now'}
          </button>
          <span className="text-[11px] text-hearth-text-faint">
            Reopen anytime from the sidebar
          </span>
        </div>
      </div>
    </FadeIn>
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
