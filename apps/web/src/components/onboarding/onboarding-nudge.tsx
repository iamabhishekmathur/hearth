import { useAuth } from '@/hooks/use-auth';
import { useOnboarding } from './use-onboarding';
import { STEP_META, runStepAction } from './steps';
import { HIcon } from '@/components/ui/icon';
import { FadeIn } from '@/components/ui/motion';

/**
 * A light, self-gating empty-state nudge that points the user at their NEXT
 * onboarding step. Drop it into a page's empty state; it renders nothing unless
 * the signed-in user still needs onboarding and the server reports a nextStep.
 *
 * `hideForStep` lets a page suppress the nudge when the next step IS that page's
 * own action (e.g. the tasks empty state shouldn't nudge "create a task" — the
 * page already has that CTA), so we steer toward the aha (connect a tool)
 * instead of restating the obvious.
 */
interface OnboardingNudgeProps {
  /** Don't render if the next step equals this (avoids redundant self-nudges). */
  hideForStep?: string;
  className?: string;
}

export function OnboardingNudge({ hideForStep, className = '' }: OnboardingNudgeProps) {
  const { user } = useAuth();
  const enabled = Boolean(user?.needsOnboarding);
  const { status } = useOnboarding(enabled);

  if (!enabled || !status) return null;
  const next = status.nextStep;
  if (!next || next === hideForStep) return null;

  const meta = STEP_META[next];
  const isPlaceholder = meta.action.kind === 'placeholder';
  if (isPlaceholder) return null;

  return (
    <FadeIn className={className}>
      <button
        type="button"
        onClick={() => runStepAction(next)}
        className="inline-flex items-center gap-2.5 rounded-lg border border-hearth-border bg-hearth-card px-3.5 py-2.5 text-left transition-all duration-fast ease-hearth hover:border-hearth-accent"
        style={{ background: 'var(--hearth-accent-soft)' }}
      >
        <span
          className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full"
          style={{ background: 'var(--hearth-card)' }}
        >
          <HIcon name={meta.icon} size={14} color="var(--hearth-accent)" />
        </span>
        <span className="min-w-0">
          <span className="block text-[12.5px] font-semibold text-hearth-text">
            Next: {meta.title}
          </span>
          <span className="block text-[11.5px] text-hearth-text-muted">
            {meta.cta}
          </span>
        </span>
        <HIcon name="arrow-right" size={14} color="var(--hearth-text-muted)" />
      </button>
    </FadeIn>
  );
}
