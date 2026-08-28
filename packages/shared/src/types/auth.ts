export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface AuthResponse {
  data?: {
    id: string;
    email?: string;
    name?: string;
    role?: string;
  };
  error?: string;
  message?: string;
}

import type { OnboardingState } from './onboarding.js';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  teamId: string | null;
  orgId: string | null;
  /** Per-user onboarding progress. Empty object means "not started". */
  onboardingState: OnboardingState;
  /**
   * Computed gate the web uses to decide whether to surface onboarding UI.
   * True when the user has not dismissed onboarding AND still has at least one
   * incomplete step.
   */
  needsOnboarding: boolean;
}
