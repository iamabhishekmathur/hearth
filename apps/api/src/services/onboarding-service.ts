import { Prisma } from '@prisma/client';
import {
  ONBOARDING_STEPS,
  EMPTY_ONBOARDING_STATE,
  isOnboardingStep,
  stepsForRole,
  type OnboardingState,
  type OnboardingStep,
  type OnboardingStatus,
} from '@hearth/shared';
import { prisma } from '../lib/prisma.js';
import { env } from '../config.js';

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
 * First applicable step (in ONBOARDING_STEPS order) the user has not yet
 * completed, or null when every applicable step is done. `steps` defaults to the
 * full taxonomy; callers pass a role-scoped subset (see stepsForRole) so members
 * are never routed to admin-only steps.
 */
export function computeNextStep(
  state: OnboardingState,
  steps: readonly OnboardingStep[] = ONBOARDING_STEPS,
): OnboardingStep | null {
  return steps.find((s) => !state.completedSteps.includes(s)) ?? null;
}

/**
 * The activation gate. The user needs onboarding when they have NOT dismissed
 * it AND there is still at least one incomplete applicable step.
 */
export function computeNeedsOnboarding(
  state: OnboardingState,
  steps: readonly OnboardingStep[] = ONBOARDING_STEPS,
): boolean {
  if (state.dismissedAt) return false;
  return computeNextStep(state, steps) !== null;
}

/**
 * Build the full status object (state + computed fields) from a raw stored value.
 * Pure — the `steps` subset lets callers scope the computation to a role.
 */
export function toStatus(
  raw: unknown,
  steps: readonly OnboardingStep[] = ONBOARDING_STEPS,
): OnboardingStatus {
  const state = normalizeState(raw);
  return {
    state,
    nextStep: computeNextStep(state, steps),
    needsOnboarding: computeNeedsOnboarding(state, steps),
  };
}

/**
 * True when the user's org already has a usable LLM provider — either a
 * system-wide env key or an admin-saved encrypted key on the org. When so, the
 * admin's `configure_llm` step is treated as already satisfied (no nagging),
 * mirroring how admin/llm-config decides a provider is `configured`.
 */
function orgHasLlmProvider(orgSettings: unknown): boolean {
  if (env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || env.OLLAMA_BASE_URL) return true;
  const settings = (orgSettings ?? {}) as Record<string, unknown>;
  const llm = (settings.llm ?? {}) as Record<string, unknown>;
  const encryptedKeys = (llm.encryptedKeys ?? {}) as Record<string, string>;
  return Object.keys(encryptedKeys).length > 0;
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
 * Read the full computed status (state + nextStep + needsOnboarding), scoped to
 * the user's role. Admin-only steps (the LLM key) are excluded for members, and
 * for admins whose org already has a provider the `configure_llm` step is folded
 * out so a configured org is never nagged to reconfigure.
 */
export async function getStatus(userId: string): Promise<OnboardingStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      onboardingState: true,
      role: true,
      team: { select: { org: { select: { settings: true } } } },
    },
  });
  if (!user) throw new Error('User not found');

  const state = normalizeState(user.onboardingState);
  let steps = stepsForRole(user.role);

  if (
    user.role === 'admin' &&
    steps.includes('configure_llm') &&
    orgHasLlmProvider(user.team?.org?.settings)
  ) {
    steps = steps.filter((s) => s !== 'configure_llm');
  }

  return {
    state,
    nextStep: computeNextStep(state, steps),
    needsOnboarding: computeNeedsOnboarding(state, steps),
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
