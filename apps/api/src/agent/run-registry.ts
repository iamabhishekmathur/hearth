import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * Run registry + cross-instance stop (W2 of the opencode adaptation).
 *
 * Each chat agent run gets a unique `runId` and an `AbortController`. Stopping a
 * run resolves that controller's signal, which the agent loop and providers
 * honor. Because the API is multi-instance (Fargate), a stop request may land on
 * an instance that does NOT own the run — so we broadcast stops over Redis
 * pub/sub (channel `chat:stop`). Every instance subscribes; the owning instance
 * aborts its local controller.
 *
 * Finalization is idempotent keyed by `runId`: the stop↔natural-done race must
 * persist exactly one `done`. `claimFinalize(runId)` returns true for the first
 * caller only.
 */

const STOP_CHANNEL = 'chat:stop';

interface ActiveRun {
  runId: string;
  sessionId: string;
  /** The user who initiated the run (used for the owner-of-run permission). */
  initiatorUserId: string;
  controller: AbortController;
}

/** runId → active run owned by THIS instance. */
const activeRuns = new Map<string, ActiveRun>();
/** runIds whose finalization has been claimed (local idempotency guard). */
const finalizedRuns = new Set<string>();

// ── Redis pub/sub wiring ────────────────────────────────────────────────────
// A dedicated subscriber connection (ioredis requires a connection in
// subscribe mode to be used only for pub/sub). The publisher uses its own
// connection. Both lazy so test/offline boots don't force a connection.

let subscriber: Redis | null = null;
let publisher: Redis | null = null;
let subscribed = false;

function getPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });
    publisher.on('error', (err) => logger.warn({ err }, 'run-registry publisher redis error'));
  }
  return publisher;
}

/**
 * Begin listening for cross-instance stop broadcasts. Idempotent. Safe to call
 * at boot; if Redis is unreachable the registry still works single-instance
 * (local aborts) — only the cross-instance fan-out degrades.
 */
export function initRunRegistry(): void {
  if (subscribed) return;
  subscribed = true;
  try {
    subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });
    subscriber.on('error', (err) => logger.warn({ err }, 'run-registry subscriber redis error'));
    subscriber.subscribe(STOP_CHANNEL).catch((err) => {
      logger.warn({ err }, 'run-registry failed to subscribe to stop channel');
    });
    subscriber.on('message', (channel, message) => {
      if (channel !== STOP_CHANNEL) return;
      try {
        const { runId } = JSON.parse(message) as { runId: string };
        // Abort locally only if WE own the run. Other instances ignore it.
        abortLocal(runId);
      } catch (err) {
        logger.warn({ err, message }, 'run-registry bad stop message');
      }
    });
  } catch (err) {
    logger.warn({ err }, 'run-registry init failed; cross-instance stop disabled');
  }
}

/** Register a new run owned by this instance. Returns its AbortController. */
export function registerRun(input: {
  runId: string;
  sessionId: string;
  initiatorUserId: string;
}): AbortController {
  const controller = new AbortController();
  activeRuns.set(input.runId, {
    runId: input.runId,
    sessionId: input.sessionId,
    initiatorUserId: input.initiatorUserId,
    controller,
  });
  return controller;
}

/** Remove a run from the local registry (call when the loop fully settles). */
export function unregisterRun(runId: string): void {
  activeRuns.delete(runId);
}

/** Generate a fresh run id. */
export function newRunId(): string {
  return `run_${randomUUID()}`;
}

/** Look up a locally-owned run, if any. */
export function getActiveRun(runId: string): ActiveRun | undefined {
  return activeRuns.get(runId);
}

/** All locally-owned runs for a session (there is normally at most one). */
export function getActiveRunsForSession(sessionId: string): ActiveRun[] {
  return [...activeRuns.values()].filter((r) => r.sessionId === sessionId);
}

/** Abort a run if this instance owns it. Returns true if a local run was aborted. */
export function abortLocal(runId: string): boolean {
  const run = activeRuns.get(runId);
  if (!run) return false;
  if (!run.controller.signal.aborted) run.controller.abort();
  return true;
}

/**
 * Stop a run from anywhere in the fleet. Aborts locally if owned here, and
 * always publishes to Redis so the owning instance (if different) aborts too.
 * Double-stop is harmless: a second abort on an already-aborted controller is a
 * no-op, and idempotent finalization guarantees exactly one persisted `done`.
 */
export async function requestStop(runId: string): Promise<void> {
  abortLocal(runId);
  try {
    await getPublisher().publish(STOP_CHANNEL, JSON.stringify({ runId }));
  } catch (err) {
    logger.warn({ err, runId }, 'run-registry failed to publish stop (local abort still applied)');
  }
}

/**
 * Claim the single finalization for a run. Returns true for the FIRST caller
 * only; subsequent callers (stop↔done race, double-stop) get false and must not
 * persist another `done`. Local to the owning instance, which is where both the
 * natural-done and the abort-triggered finalize run.
 */
export function claimFinalize(runId: string): boolean {
  if (finalizedRuns.has(runId)) return false;
  finalizedRuns.add(runId);
  // Bound memory: forget the claim a minute later. A minute is far longer than
  // any stop↔done race window, so this never re-opens a claim in practice.
  const t = setTimeout(() => finalizedRuns.delete(runId), 60_000);
  t.unref?.();
  return true;
}

/** Test seam: clear all registry state. */
export function __resetRunRegistryForTests(): void {
  for (const run of activeRuns.values()) {
    if (!run.controller.signal.aborted) run.controller.abort();
  }
  activeRuns.clear();
  finalizedRuns.clear();
}
