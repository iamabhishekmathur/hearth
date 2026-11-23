import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import {
  EMPTY_ONBOARDING_STATE,
  type OnboardingPatchRequest,
  type OnboardingStatus,
} from '@hearth/shared';

/**
 * Client-side hook over GET/PATCH /api/v1/onboarding (the P0 foundation).
 *
 * It owns a local copy of the server's onboarding status and re-fetches after
 * every mutation so completions driven server-side (Track B marks steps when
 * the user actually does the thing) reflect live in the checklist. The hook
 * never derives completion locally — the server is the source of truth.
 */

const EMPTY_STATUS: OnboardingStatus = {
  state: EMPTY_ONBOARDING_STATE,
  nextStep: null,
  needsOnboarding: false,
};

interface UseOnboarding {
  status: OnboardingStatus | null;
  loading: boolean;
  /** Capture the welcome goal; implicitly starts onboarding server-side. */
  submitWelcome: (goal: string) => Promise<void>;
  /** Mark a step complete (most steps are completed server-side; this is a fallback). */
  completeStep: (step: OnboardingPatchRequest['step']) => Promise<void>;
  /** Dismiss onboarding entirely. */
  dismiss: () => Promise<void>;
  /** Re-pull status from the server. */
  refresh: () => Promise<void>;
}

async function patchOnboarding(
  body: OnboardingPatchRequest,
): Promise<OnboardingStatus> {
  const res = await api.patch<{ data: OnboardingStatus }>('/onboarding', body);
  return res.data;
}

export function useOnboarding(enabled: boolean): UseOnboarding {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(enabled);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ data: OnboardingStatus }>('/onboarding');
      if (mounted.current) setStatus(res.data);
    } catch {
      // Treat a failed fetch as "nothing to show" rather than blocking the app.
      if (mounted.current) setStatus(EMPTY_STATUS);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
  }, [enabled, refresh]);

  const submitWelcome = useCallback(async (goal: string) => {
    const next = await patchOnboarding({ action: 'welcome', goal });
    if (mounted.current) setStatus(next);
  }, []);

  const completeStep = useCallback(
    async (step: OnboardingPatchRequest['step']) => {
      if (!step) return;
      const next = await patchOnboarding({ action: 'complete', step });
      if (mounted.current) setStatus(next);
    },
    [],
  );

  const dismiss = useCallback(async () => {
    const next = await patchOnboarding({ action: 'dismiss' });
    if (mounted.current) setStatus(next);
  }, []);

  return { status, loading, submitWelcome, completeStep, dismiss, refresh };
}
