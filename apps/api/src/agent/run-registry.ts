import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { ToolPermissionDecision } from '@hearth/shared';
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

// ── Pending tool-permission asks (W3) ──────────────────────────────────────
//
// When a tool call resolves to `ask`, the agent loop emits a `permission_request`
// ChatEvent and PARKS on a promise keyed by `callId`. The client replies out of
// band (WS `permission_response` or REST) which resolves that promise, un-parking
// the loop. These asks are EPHEMERAL (in-memory + WS) — distinct from durable
// routine approvals (`approval_requests`). They do not survive a process restart;
// a restarted instance simply never owns the park, so the ask times out to its
// default (deny), which is the fail-safe.
//
// Concurrency: each `callId` parks independently. Resolving one never resolves
// another. A `permission_response` for an unknown `callId` (run already
// finished/aborted, or a response that lost the timeout race) is ignored.

/** How a parked permission ask settles. `timeout` maps to the timeout action. */
export type PermissionOutcome = ToolPermissionDecision | 'timeout';

interface PendingPermission {
  callId: string;
  runId: string;
  resolve: (outcome: PermissionOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** callId → the parked ask awaiting a client response. */
const pendingPermissions = new Map<string, PendingPermission>();

/** Default time a parked ask waits before resolving to its timeout action. */
export const DEFAULT_PERMISSION_TIMEOUT_MS = 5 * 60_000;

/**
 * Park the loop awaiting a client decision for one tool call. Returns a promise
 * that resolves to the client's `ToolPermissionDecision`, or `'timeout'` if no
 * response arrives within `timeoutMs`. The caller maps `'timeout'` to the
 * configured timeout action (default: treat as deny).
 *
 * If the run is aborted while parked (its AbortController fires), the ask is
 * abandoned and resolves to `'timeout'` so the loop un-parks and finalizes.
 */
export function awaitPermission(input: {
  callId: string;
  runId: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<PermissionOutcome> {
  const { callId, runId, signal } = input;
  const timeoutMs = input.timeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS;

  // Defensive: if a stale ask with the same callId exists, settle it first.
  const existing = pendingPermissions.get(callId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.resolve('timeout');
    pendingPermissions.delete(callId);
  }

  return new Promise<PermissionOutcome>((resolve) => {
    let settled = false;
    const settle = (outcome: PermissionOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      pendingPermissions.delete(callId);
      resolve(outcome);
    };
    const onAbort = () => settle('timeout');

    const timer = setTimeout(() => settle('timeout'), timeoutMs);
    timer.unref?.();

    if (signal) {
      if (signal.aborted) {
        // Already aborted — resolve immediately (next tick, so the map is set).
        queueMicrotask(() => settle('timeout'));
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    pendingPermissions.set(callId, {
      callId,
      runId,
      resolve: (outcome) => settle(outcome),
      timer,
    });
  });
}

/**
 * Resolve a parked ask from a client reply. Returns true if a pending ask for
 * `callId` existed and was resolved; false if none (run already ended/aborted,
 * or a duplicate/late response) — in which case this is a safe no-op (never
 * throws). This is what makes "response after run ended" harmless.
 */
export function resolvePermission(callId: string, decision: ToolPermissionDecision): boolean {
  const pending = pendingPermissions.get(callId);
  if (!pending) return false;
  pending.resolve(decision);
  return true;
}

/** Whether a given callId currently has a parked ask (for tests/diagnostics). */
export function hasPendingPermission(callId: string): boolean {
  return pendingPermissions.has(callId);
}

/** Number of parked asks (diagnostics/tests). */
export function pendingPermissionCount(): number {
  return pendingPermissions.size;
}

/** Test seam: clear all registry state. */
export function __resetRunRegistryForTests(): void {
  for (const run of activeRuns.values()) {
    if (!run.controller.signal.aborted) run.controller.abort();
  }
  activeRuns.clear();
  finalizedRuns.clear();
  for (const pending of pendingPermissions.values()) {
    clearTimeout(pending.timer);
    pending.resolve('timeout');
  }
  pendingPermissions.clear();
}
