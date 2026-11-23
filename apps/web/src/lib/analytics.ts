/**
 * Product funnel analytics (client-side).
 *
 * Thin, dev-safe wrapper around posthog-js. PostHog is initialized **only**
 * when `VITE_POSTHOG_KEY` is present at build/run time. With no key — which is
 * the case in local dev, CI, and unit tests — every export here is a clean
 * no-op, so nothing breaks and no network calls are made.
 *
 * This is intentionally provider-thin: call sites import the typed helpers in
 * `analytics-events.ts`, never posthog-js directly, so we can swap providers
 * without touching the funnel instrumentation.
 */
import type { PostHog } from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ||
  'https://us.i.posthog.com';

/** Resolved lazily; stays null forever when no key is configured. */
let client: PostHog | null = null;
let initialized = false;

/** True when a PostHog key is configured. Cheap guard for call sites/tests. */
export const analyticsEnabled = Boolean(POSTHOG_KEY);

/**
 * Initialize PostHog. Safe to call repeatedly (idempotent). No-ops without a
 * key. Call this once near app startup (e.g. in main.tsx) — but it is not
 * required for `track`/`identify`/`reset` to be safe to call.
 */
export async function initAnalytics(): Promise<void> {
  if (initialized || !POSTHOG_KEY) {
    initialized = true;
    return;
  }
  initialized = true;
  try {
    // Dynamic import so posthog-js is never pulled into the bundle path when
    // analytics is disabled, and so a missing optional dep never hard-crashes.
    const { default: posthog } = await import('posthog-js');
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      capture_pageview: false, // funnel events are explicit; no auto pageviews
      autocapture: false,
      persistence: 'localStorage+cookie',
    });
    client = posthog;
  } catch {
    // posthog-js not installed or failed to load — stay a no-op.
    client = null;
  }
}

/**
 * Record a funnel event. No-op without a configured key. Prefer the typed
 * `track*` helpers in `analytics-events.ts` over calling this with raw strings.
 */
export function track(event: string, props?: Record<string, unknown>): void {
  if (!POSTHOG_KEY) return;
  if (!initialized) void initAnalytics();
  client?.capture(event, props);
}

/**
 * Associate subsequent events with a known user. No-op without a key.
 * `traits` map to PostHog person properties (set once via $set_once-style
 * semantics is left to the caller; we use plain $set here).
 */
export function identify(
  userId: string,
  traits?: Record<string, unknown>,
): void {
  if (!POSTHOG_KEY) return;
  if (!initialized) void initAnalytics();
  client?.identify(userId, traits);
}

/**
 * Clear the current identity (call on logout) so a shared device doesn't
 * attribute the next user's events to the previous one. No-op without a key.
 */
export function reset(): void {
  if (!POSTHOG_KEY) return;
  client?.reset();
}
