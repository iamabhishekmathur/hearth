import { Prisma } from '@prisma/client';
import {
  ONBOARDING_STEPS,
  EMPTY_ONBOARDING_STATE,
  isOnboardingStep,
  type OnboardingState,
  type OnboardingStep,
  type OnboardingStatus,
} from '@hearth/shared';
import { prisma } from '../lib/prisma.js';

// ──────────────────────────────────────────────
// Onboarding service (growth-loop activation foundation, TRACK 1).
//
// All mutations read the current User.onboardingState, MERGE the change in
// memory, and write the whole object back. We never do a partial JSON path
// update — Prisma's Json column is opaque — but because every helper preserves
// untouched fields, concurrent step completions are additive (last-writer-wins
// only on the field actually being written; `completedSteps` is deduped/union).
// ──────────────────────────────────────────────

/**
 * Coerce arbitrary stored JSON into a well-formed OnboardingState. Defends
 * against legacy/empty `{}` rows and any hand-edited garbage: unknown steps are
 * dropped, missing arrays default to empty.
 */
export function normalizeState(raw: unknown): OnboardingState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...EMPTY_ONBOARDING_STATE };
  }
  const obj = raw as Record<string, unknown>;

  const completedSteps = Array.isArray(obj.completedSteps)
    ? Array.from(new Set(obj.completedSteps.filter(isOnboardingStep)))
    : [];

  const state: OnboardingState = { completedSteps };

  if (typeof obj.startedAt === 'string') state.startedAt = obj.startedAt;
  if (typeof obj.dismissedAt === 'string') state.dismissedAt = obj.dismissedAt;

  if (obj.welcome && typeof obj.welcome === 'object' && !Array.isArray(obj.welcome)) {
    const goal = (obj.welcome as Record<string, unknown>).goal;
    state.welcome = typeof goal === 'string' ? { goal } : {};
  }

  return state;
}

/**
 * First step (in ONBOARDING_STEPS order) the user has not yet completed, or
 * null when every step is done.
 */
export function computeNextStep(state: OnboardingState): OnboardingStep | null {
  return ONBOARDING_STEPS.find((s) => !state.completedSteps.includes(s)) ?? null;
}

/**
 * The activation gate. The user needs onboarding when they have NOT dismissed
 * it AND there is still at least one incomplete step.
 */
export function computeNeedsOnboarding(state: OnboardingState): boolean {
  if (state.dismissedAt) return false;
  return computeNextStep(state) !== null;
}

/**
 * Build the full status object (state + computed fields) from a raw stored value.
 * Pure — used by both the route and by GET /auth/me without an extra DB round-trip.
 */
export function toStatus(raw: unknown): OnboardingStatus {
  const state = normalizeState(raw);
  return {
    state,
    nextStep: computeNextStep(state),
    needsOnboarding: computeNeedsOnboarding(state),
  };
}

async function loadState(userId: string): Promise<OnboardingState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { onboardingState: true },
  });
  if (!user) throw new Error('User not found');
  return normalizeState(user.onboardingState);
}

async function persist(userId: string, state: OnboardingState): Promise<OnboardingState> {
  await prisma.user.update({
    where: { id: userId },
    data: { onboardingState: state as unknown as Prisma.InputJsonValue },
  });
  return state;
}

/**
 * Read the current onboarding state for a user (normalized).
 */
export async function getState(userId: string): Promise<OnboardingState> {
  return loadState(userId);
}

/**
 * Read the full computed status (state + nextStep + needsOnboarding).
 */
export async function getStatus(userId: string): Promise<OnboardingStatus> {
  const state = await loadState(userId);
  return {
    state,
    nextStep: computeNextStep(state),
    needsOnboarding: computeNeedsOnboarding(state),
  };
}

/**
 * Mark onboarding as started. Idempotent — keeps the original `startedAt` so we
 * don't reset the activation clock if called twice.
 */
export async function startOnboarding(userId: string): Promise<OnboardingState> {
  const state = await loadState(userId);
  if (!state.startedAt) state.startedAt = new Date().toISOString();
  return persist(userId, state);
}

/**
 * Capture the welcome-step goal. Implicitly starts onboarding if not already.
 */
export async function setWelcome(
  userId: string,
  input: { goal?: string },
): Promise<OnboardingState> {
  const state = await loadState(userId);
  if (!state.startedAt) state.startedAt = new Date().toISOString();
  state.welcome = { ...state.welcome, goal: input.goal };
  return persist(userId, state);
}

/**
 * Mark a step complete. Idempotent (union into completedSteps) and starts
 * onboarding implicitly so a user who completes a step before ever hitting the
 * welcome screen still has a startedAt.
 */
export async function markStepComplete(
  userId: string,
  step: OnboardingStep,
): Promise<OnboardingState> {
  if (!isOnboardingStep(step)) {
    throw new Error(`Invalid onboarding step: ${String(step)}`);
  }
  const state = await loadState(userId);
  if (!state.startedAt) state.startedAt = new Date().toISOString();
  if (!state.completedSteps.includes(step)) {
    state.completedSteps = [...state.completedSteps, step];
  }
  return persist(userId, state);
}

/**
 * Dismiss onboarding. Sets dismissedAt; preserves all progress so the user can
 * still see what they completed. Idempotent — does not overwrite an existing
 * dismissal timestamp.
 */
export async function dismiss(userId: string): Promise<OnboardingState> {
  const state = await loadState(userId);
  if (!state.dismissedAt) state.dismissedAt = new Date().toISOString();
  return persist(userId, state);
}
