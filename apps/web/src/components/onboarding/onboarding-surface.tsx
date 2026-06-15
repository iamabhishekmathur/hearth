import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { FadeIn } from '@/components/ui/motion';
import { HIcon } from '@/components/ui/icon';
import { useOnboarding } from './use-onboarding';
import { OnboardingWelcome } from './onboarding-welcome';
import {
  OnboardingChecklist,
  emitStepCompletedAnalytics,
} from './onboarding-checklist';
import { DailyBriefOffer } from './daily-brief-offer';

/**
 * The mounted onboarding surface.
 *
 * Gated by `needsOnboarding` (from useAuth's user). When the user has not yet
 * started (no welcome.startedAt), it takes over as a full welcome screen. Once
 * started, it renders as a persistent, collapsible checklist anchored bottom
 * -right. Collapsing leaves a small "Get started" launcher; dismissing hides it
 * for good (server-side). Nothing renders once needsOnboarding is false.
 *
 * It also fires ONBOARDING_STEP_COMPLETED / AHA_REACHED when it observes the
 * server's completedSteps grow — keeping emission tied to real completion.
 */
export function OnboardingSurface() {
  const { user, refresh: refreshAuth } = useAuth();
  // Drive the whole surface off needsOnboarding from the live session user.
  const enabled = Boolean(user?.needsOnboarding);
  const { status, loading, submitWelcome, dismiss, refresh } =
    useOnboarding(enabled);

  const [collapsed, setCollapsed] = useState(false);
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
  const allDone = status.state.completedSteps.length >= 5;

  // ---- Welcome (full-screen takeover before onboarding has started) --------
  if (!started) {
    return (
      <div className="absolute inset-0 z-30 bg-hearth-bg">
        <OnboardingWelcome onSubmit={handleWelcome} onSkip={() => void handleDismiss()} />
      </div>
    );
  }

  // ---- Checklist (persistent, collapsible, bottom-right) -------------------
  if (collapsed) {
    return (
      <div className="pointer-events-none absolute bottom-4 right-4 z-30">
        <FadeIn>
          <button
            type="button"
            onClick={() => {
              setCollapsed(false);
              void refresh();
            }}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-pill border border-hearth-border bg-hearth-card px-3.5 py-2 text-[13px] font-semibold text-hearth-text shadow-hearth-2 transition-all duration-fast ease-hearth hover:border-hearth-accent"
          >
            <HIcon name="sparkle" size={14} color="var(--hearth-accent)" />
            Get started
            <span
              className="ml-0.5 rounded-pill px-1.5 py-[1px] text-[11px] font-bold text-white"
              style={{ background: 'var(--hearth-accent)' }}
            >
              {status.state.completedSteps.length}/5
            </span>
          </button>
        </FadeIn>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-30 flex flex-col items-end gap-3">
      {/* Once the activation checklist is complete, plant the retention habit:
          a one-click daily-brief offer. Self-suppresses if they already have
          routines or dismissed it. */}
      {allDone && (
        <div className="pointer-events-auto">
          <DailyBriefOffer />
        </div>
      )}
      <div className="pointer-events-auto">
        <OnboardingChecklist
          status={status}
          onCollapse={() => setCollapsed(true)}
          onDismiss={() => void handleDismiss()}
          onRefresh={refresh}
        />
      </div>
    </div>
  );
}
