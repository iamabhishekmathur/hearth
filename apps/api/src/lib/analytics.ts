/**
 * Product funnel analytics (server-side).
 *
 * Gated wrapper around posthog-node. The client is initialized **only** when
 * `POSTHOG_API_KEY` is set in the environment. With no key — local dev, CI,
 * tests — every export is a clean no-op: no client, no network, no flush.
 *
 * Read directly from `process.env` (not the zod config) so this util is fully
 * self-contained and adding it never forces a config-schema change. Server-side
 * funnel events (e.g. INVITE_ACCEPTED, AHA_REACHED from a tool call) are wired
 * in later phases; this lays the dependable foundation.
 */
import type { PostHog } from 'posthog-node';
import { logger } from './logger.js';

const POSTHOG_KEY = process.env.POSTHOG_API_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';

/** True when a key is configured. Cheap guard for call sites/tests. */
export const analyticsEnabled = Boolean(POSTHOG_KEY);

let client: PostHog | null = null;
let initStarted = false;

async function getClient(): Promise<PostHog | null> {
  if (!POSTHOG_KEY) return null;
  if (client || initStarted) return client;
  initStarted = true;
  try {
    const { PostHog: PostHogCtor } = await import('posthog-node');
    client = new PostHogCtor(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      // Server-side: flush eagerly so short-lived requests don't drop events.
      flushAt: 1,
      flushInterval: 0,
    });
  } catch (err) {
    logger.warn({ err }, 'posthog-node unavailable; server analytics disabled');
    client = null;
  }
  return client;
}

/**
 * Capture a server-side funnel event for a known user. No-op without a key.
 * `distinctId` MUST match the client-side `identify` id (the user id) so
 * client and server events stitch onto the same person.
 */
export async function capture(
  distinctId: string,
  event: string,
  props?: Record<string, unknown>,
): Promise<void> {
  if (!POSTHOG_KEY) return;
  const c = await getClient();
  c?.capture({ distinctId, event, properties: props });
}

/**
 * Flush any buffered events and release the client. Call on graceful shutdown.
 * No-op without a key.
 */
export async function shutdownAnalytics(): Promise<void> {
  if (!client) return;
  try {
    await client.shutdown();
  } finally {
    client = null;
    initStarted = false;
  }
}
