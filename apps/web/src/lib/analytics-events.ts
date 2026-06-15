/**
 * Funnel event taxonomy.
 *
 * Single source of truth for product-funnel event names and their payload
 * shapes, spanning the whole growth loop (activation -> retention -> referral).
 * Every event in the funnel is DEFINED here; only the subset with live call
 * sites today actually emits (see docs/growth/EVENTS.md for phase mapping).
 *
 * Call sites import the typed `track*` helpers below — never raw strings and
 * never posthog-js directly — so the taxonomy stays enforceable by the compiler.
 */
import { track } from './analytics';

/** Canonical event names. Stringly-keyed in PostHog; keep these stable. */
export const AnalyticsEvent = {
  /** Activation */
  USER_SIGNED_UP: 'user_signed_up',
  ONBOARDING_STEP_COMPLETED: 'onboarding_step_completed',
  FIRST_MESSAGE_SENT: 'first_message_sent',
  INTEGRATION_CONNECTED: 'integration_connected',
  /** Aha moment — integration-pull: user pulls real work context via an integration. */
  AHA_REACHED: 'aha_reached',
  FIRST_TASK_CREATED: 'first_task_created',
  /** Retention */
  ROUTINE_CREATED: 'routine_created',
  /** Referral — contextual-first invites */
  INVITE_SENT: 'invite_sent',
  INVITE_ACCEPTED: 'invite_accepted',
} as const;

export type AnalyticsEventName =
  (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

/** Per-event payload contracts. Keep optional unless the value is always known. */
export interface AnalyticsEventProps {
  [AnalyticsEvent.USER_SIGNED_UP]: {
    /** 'register' = self-serve register form; 'setup' = first-admin setup wizard. */
    method: 'register' | 'setup';
    orgName?: string;
  };
  [AnalyticsEvent.ONBOARDING_STEP_COMPLETED]: {
    step: string;
    stepIndex?: number;
  };
  [AnalyticsEvent.FIRST_MESSAGE_SENT]: {
    sessionId: string;
    /** Length in chars — coarse signal, never the message body. */
    length: number;
    hasAttachments?: boolean;
  };
  [AnalyticsEvent.INTEGRATION_CONNECTED]: {
    provider: string;
    /** 'builtin' = catalog connector; 'custom' = user-supplied MCP server URL. */
    kind: 'builtin' | 'custom';
  };
  [AnalyticsEvent.AHA_REACHED]: {
    /** What produced the aha (e.g. 'integration_pull'). */
    via: string;
    provider?: string;
  };
  [AnalyticsEvent.FIRST_TASK_CREATED]: {
    taskId?: string;
    source: string;
  };
  [AnalyticsEvent.ROUTINE_CREATED]: {
    routineId?: string;
    triggerType?: string;
    scope?: string;
  };
  [AnalyticsEvent.INVITE_SENT]: {
    /** How many invites this action sent. */
    count: number;
    /** Where the invite originated (e.g. 'contextual', 'settings'). */
    context?: string;
  };
  [AnalyticsEvent.INVITE_ACCEPTED]: {
    inviteId?: string;
  };
}

/**
 * Typed event emitter. The compiler enforces that `props` matches the event.
 * No-ops without a configured PostHog key (delegates to `track`).
 */
export function trackEvent<E extends AnalyticsEventName>(
  event: E,
  ...args: E extends keyof AnalyticsEventProps
    ? [props: AnalyticsEventProps[E]]
    : [props?: Record<string, unknown>]
): void {
  track(event, args[0] as Record<string, unknown> | undefined);
}
