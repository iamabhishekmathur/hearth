import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useOnboarding } from './use-onboarding';
import { OnboardingWelcome } from './onboarding-welcome';
import {
  OnboardingChecklist,
  emitStepCompletedAnalytics,
} from './onboarding-checklist';

/**
 * The prominent onboarding surface.
 *
 * Gated by `needsOnboarding` (from useAuth's user). While the user is
 * onboarding, this is NOT a corner widget — it occupies and dominates the main
 * content area as a centered, focused guided flow: a welcome on-ramp (step 0)
 * that captures the user's goal (PATCH welcome), then a guided checklist with a
 * benefit-led hero card, progress, and a folded-in daily-brief finale. Once
 * the user finishes or skips (PATCH dismiss), `needsOnboarding` flips false and
 * nothing renders.
 *
 * It fires ONBOARDING_STEP_COMPLETED / AHA_REACHED when it observes the
 * server's completedSteps grow — keeping emission tied to real completion.
 */
export function OnboardingSurface() {
  const { user, refresh: refreshAuth } = useAuth();
  // Drive the whole surface off needsOnboarding from the live session user.
  const enabled = Boolean(user?.needsOnboarding);
  const { status, loading, submitWelcome, dismiss, refresh } =
    useOnboarding(enabled);

  const prevCompleted = useRef<Set<string> | null>(null);

  // Re-pull onboarding state when the tab regains focus — step completions
  // happen on other pages (Track B) and we want the tick to appear on return.
  // Also listen for an in-app refresh event: same-tab SPA actions (e.g. a
  // member connecting a tool on the /integrations surface) complete steps
  // server-side without ever firing a window focus, so the connect surface
  // dispatches `hearth:onboarding-refresh` to make the tick appear live.
  useEffect(() => {
    if (!enabled) return;
    const onRefresh = () => void refresh();
    window.addEventListener('focus', onRefresh);
    window.addEventListener('hearth:onboarding-refresh', onRefresh);
    return () => {
      window.removeEventListener('focus', onRefresh);
      window.removeEventListener('hearth:onboarding-refresh', onRefresh);
    };
  }, [enabled, refresh]);

  // Detect newly-completed steps and emit analytics exactly once per step.
  useEffect(() => {
    if (!status) return;
    const current = new Set(status.state.completedSteps);
    const prev = prevCompleted.current;
    if (prev) {
      for (const step of status.state.completedSteps) {
        if (!prev.has(step)) emitStepCompletedAnalytics(step);
      }
    }
    prevCompleted.current = current;
  }, [status]);

  const handleWelcome = useCallback(
    async (goal: string) => {
      await submitWelcome(goal);
      // welcome.goal is captured + onboarding started; surface now shows the
      // checklist. No auth refresh needed (needsOnboarding stays true).
    },
    [submitWelcome],
  );

  const handleDismiss = useCallback(async () => {
    await dismiss();
    // needsOnboarding flips false server-side; refresh the session user so the
    // surface unmounts everywhere it's gated.
    await refreshAuth();
  }, [dismiss, refreshAuth]);

  if (!enabled || loading || !status) return null;

  const started = Boolean(status.state.startedAt);

  // Full takeover of the main content area for the whole flow — front and
  // centre on first login. Scrollable in case the viewport is short.
  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-hearth-bg">
      <div className="flex min-h-full items-center justify-center px-6 py-12">
        {!started ? (
          <OnboardingWelcome onSubmit={handleWelcome} />
        ) : (
          <OnboardingChecklist
            status={status}
            role={user?.role}
            onDismiss={() => void handleDismiss()}
            onRefresh={refresh}
            onFinish={() => void handleDismiss()}
          />
        )}
      </div>
    </div>
  );
}
