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
  connect_integration: {
    title: 'Connect a tool',
    description:
      'Connect Slack, Gmail, or Granola and watch Hearth pull your tasks and context into memory automatically.',
    icon: 'link',
    cta: 'Connect a tool',
    // Member-usable per-user connect surface (any member, requireAuth) — NOT the
    // admin-only /settings/integrations page, which 403s for members.
    action: { kind: 'navigate', hash: '/integrations' },
  },
  first_chat: {
    title: 'Ask your first question',
    description:
      'Chat with Hearth about your work — it answers using everything it has pulled in.',
    icon: 'chat',
    cta: 'Open chat',
    action: { kind: 'navigate', hash: '/chat', event: 'hearth:focus-composer' },
  },
  first_task: {
    title: 'Delegate your first task',
    description:
      'Hand off a multi-step job and let the agent run it in the background.',
    icon: 'board',
    cta: 'New task',
    action: { kind: 'navigate', hash: '/tasks', event: 'hearth:open-task-composer' },
  },
  invite_teammate: {
    title: 'Invite a teammate',
    description:
      'Hearth is better together — shared memory and tasks across your team.',
    icon: 'team',
    cta: 'Coming soon',
    action: { kind: 'placeholder', note: 'Teammate invites land in a follow-up.' },
  },
  set_preferences: {
    title: 'Set your preferences',
    description: 'Tune how Hearth thinks, writes, and shows up for you.',
    icon: 'settings',
    cta: 'Open settings',
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
