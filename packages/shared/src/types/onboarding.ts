// ──────────────────────────────────────────────
// Per-user onboarding state (growth-loop activation foundation)
//
// Persisted on User.onboardingState (Json @default("{}")). The shape is
// intentionally additive/sparse: every field is optional except the
// completedSteps array, so an empty `{}` is a valid "not started" state.
// All writes MERGE into the existing JSON — never wholesale-replace — so two
// concurrent step completions don't clobber each other's progress.
// ──────────────────────────────────────────────

/**
 * The onboarding step taxonomy. Order is meaningful: `nextStep` is computed as
 * the first step in this list that is NOT in `completedSteps`. P1's UI renders
 * a checklist in this order. Adding a step here automatically adds it to the
 * activation funnel; do not reorder casually (it changes the suggested path).
 */
export const ONBOARDING_STEPS = [
  'configure_llm',
  'connect_integration',
  'first_chat',
  'first_task',
  'invite_teammate',
  'set_preferences',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value);
}

/**
 * Steps that only make sense for an org admin. The LLM provider key is set once,
 * per-org, by an admin (see admin/llm-config) — members can neither perform it
 * nor should they be nagged by it, so it is filtered out of their funnel. It
 * leads the taxonomy because chat/tasks cannot work until a provider is
 * configured, so the admin who bootstraps the org is prompted for it first.
 */
export const ADMIN_ONLY_STEPS: readonly OnboardingStep[] = ['configure_llm'];

/**
 * The onboarding steps applicable to a given user role. Non-admins never see
 * admin-only steps; `nextStep`/`needsOnboarding` are computed over this subset
 * both server-side (source of truth) and in the checklist UI so the two agree.
 */
export function stepsForRole(role: string | null | undefined): OnboardingStep[] {
  if (role === 'admin') return [...ONBOARDING_STEPS];
  return ONBOARDING_STEPS.filter((s) => !ADMIN_ONLY_STEPS.includes(s));
}

/**
 * Stored shape of User.onboardingState.
 *
 * - `startedAt`     — ISO timestamp set when the user begins onboarding.
 * - `welcome.goal`  — the free-text/selected goal captured in the welcome step.
 * - `completedSteps`— OnboardingStep values the user has finished (deduped).
 * - `dismissedAt`   — ISO timestamp set if the user dismisses onboarding; once
 *                     set, `needsOnboarding` is false regardless of progress.
 */
export interface OnboardingState {
  startedAt?: string;
  welcome?: {
    goal?: string;
  };
  completedSteps: OnboardingStep[];
  dismissedAt?: string;
}

/**
 * Default/empty onboarding state — what an untouched `{}` deserializes to.
 */
export const EMPTY_ONBOARDING_STATE: OnboardingState = {
  completedSteps: [],
};

/**
 * Actions accepted by PATCH /onboarding.
 */
export type OnboardingAction = 'start' | 'welcome' | 'complete' | 'dismiss';

export interface OnboardingPatchRequest {
  action: OnboardingAction;
  /** Required when action='complete'. */
  step?: OnboardingStep;
  /** Required when action='welcome'. */
  goal?: string;
}

/**
 * Response from GET /onboarding (and embedded in computed form elsewhere).
 * `nextStep` is the first incomplete step, or null when all steps are done.
 */
export interface OnboardingStatus {
  state: OnboardingState;
  nextStep: OnboardingStep | null;
  needsOnboarding: boolean;
}
