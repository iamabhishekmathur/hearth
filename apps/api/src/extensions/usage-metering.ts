/**
 * Usage metering hook.
 *
 * OSS exposes a recorder slot; cloud (or any other operator) registers a
 * callback that persists per-org counters wherever it likes (Redis, a
 * billing system, etc.). When no recorder is registered, OSS short-circuits
 * — self-hosters get zero overhead and zero external dependencies.
 *
 * Pattern mirrors `oauth-provisioner.ts` and `register.ts`: OSS owns the
 * registry, cloud calls the setter at boot.
 *
 * The set of events here intentionally mirrors what cloud's
 * `rate-limits/usage.ts` understands — keep them in sync if you add more.
 */

export type UsageEvent = 'agent_runs' | 'artifact_creates' | 'llm_tokens';

export type UsageRecorder = (
  orgId: string,
  event: UsageEvent,
  delta?: number,
) => Promise<void>;

let recorder: UsageRecorder | null = null;

/** Register a usage recorder. Replaces any previously registered one. */
export function setUsageRecorder(r: UsageRecorder): void {
  recorder = r;
}

/** Read the currently registered recorder (or null if none). */
export function getUsageRecorder(): UsageRecorder | null {
  return recorder;
}
