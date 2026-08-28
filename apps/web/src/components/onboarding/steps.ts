import { type OnboardingStep } from '@hearth/shared';

/**
 * Presentation metadata for each onboarding step. The step ORDER and the set of
 * steps themselves live in @hearth/shared (ONBOARDING_STEPS); this only layers
 * on UI copy, an icon, and where the CTA goes. Keeping it keyed by step means a
 * new step added to the taxonomy surfaces here as a missing key (compile error
 * via the Record), not a silent gap.
 */
export interface StepMeta {
  /** Short imperative label for the checklist row. */
  title: string;
  /**
   * Benefit-led headline for the HERO card — leads with the value the user
   * gets, not the task name. Used when this step is the current/next step.
   */
  headline: string;
  /** One-line value-forward description. */
  description: string;
  /** HIcon name. */
  icon: string;
  /** Button label. */
  cta: string;
  /**
   * What activating the CTA does. Hash routes drive navigation; `event` fires a
   * window CustomEvent the target page may optionally react to; `placeholder`
   * steps are rendered but not yet wired (P2).
   */
  action:
    | { kind: 'navigate'; hash: string; event?: string }
    | { kind: 'placeholder'; note: string };
}

export const STEP_META: Record<OnboardingStep, StepMeta> = {
  configure_llm: {
    title: 'Add your AI provider key',
    headline: 'Power Hearth with your team’s AI provider',
    description:
      'Add an Anthropic, OpenAI, or local model key once for the whole org — this is what makes chat, tasks, and routines actually think.',
    icon: 'key',
    cta: 'Add API key',
    // Admin-only org LLM setup lives under Settings → LLM Config. Saving a key
    // there completes this step server-side and dispatches
    // `hearth:onboarding-refresh` so the checklist ticks without a focus event.
    action: { kind: 'navigate', hash: '/settings/llm' },
  },
  connect_integration: {
    title: 'Connect a tool',
    headline: 'Connect a tool and watch Hearth pull your work in',
    description:
      'Connect Slack, Gmail, or Granola and Hearth pulls your tasks and context into memory automatically — this is where it clicks.',
    icon: 'link',
    cta: 'Connect a tool',
    // Member-usable per-user connect surface (any member, requireAuth) — NOT the
    // admin-only /settings/integrations page, which 403s for members.
    action: { kind: 'navigate', hash: '/integrations' },
  },
  first_chat: {
    title: 'Ask your first question',
    headline: 'Get answers from everything Hearth has pulled in',
    description:
      'Ask Hearth anything about your work — it answers using the tools and context you just connected.',
    icon: 'chat',
    cta: 'Ask a question',
    action: { kind: 'navigate', hash: '/chat', event: 'hearth:focus-composer' },
  },
  first_task: {
    title: 'Delegate your first task',
    headline: 'Hand off real work and let Hearth run with it',
    description:
      'Delegate a multi-step job and the agent runs it in the background while you move on.',
    icon: 'board',
    cta: 'Delegate a task',
    action: { kind: 'navigate', hash: '/tasks', event: 'hearth:open-task-composer' },
  },
  invite_teammate: {
    title: 'Invite a teammate',
    headline: 'Bring your team into shared memory and tasks',
    description:
      'Hearth gets better with your team — shared context and tasks so everyone stays in sync.',
    icon: 'team',
    cta: 'Invite a teammate',
    // The invite surface lives under Settings and is reachable by any member.
    // Sending an invite completes this step server-side; the surface dispatches
    // `hearth:onboarding-refresh` so the checklist ticks without a focus event.
    action: { kind: 'navigate', hash: '/settings/invite' },
  },
  set_preferences: {
    title: 'Set your preferences',
    headline: 'Make Hearth sound and work like you',
    description: 'Tune how Hearth thinks, writes, and shows up for you.',
    icon: 'settings',
    cta: 'Set preferences',
    action: { kind: 'navigate', hash: '/settings/profile' },
  },
};

/**
 * Navigate to a step's CTA target. Centralized so the checklist and the
 * empty-state nudges behave identically. Returns true if it actually navigated
 * (i.e. not a placeholder), so callers can decide whether to also collapse UI.
 */
export function runStepAction(step: OnboardingStep): boolean {
  const action = STEP_META[step].action;
  if (action.kind === 'placeholder') return false;
  if (action.event) {
    // Fire after the hash change so the target page is mounted/listening.
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(action.event!));
    }, 80);
  }
  window.location.hash = action.hash;
  return true;
}
