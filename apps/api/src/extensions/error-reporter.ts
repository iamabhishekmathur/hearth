/**
 * Error reporter hook.
 *
 * OSS exposes a reporter slot; cloud (or any other operator) registers a
 * callback that forwards errors to a tracking backend (Sentry, Bugsnag,
 * Datadog, etc.). When no reporter is registered, OSS short-circuits —
 * self-hosters get zero overhead and zero external dependencies.
 *
 * Pattern mirrors `oauth-provisioner.ts` and `usage-metering.ts`: OSS owns
 * the registry, cloud calls the setter at boot.
 *
 * App code (e.g. the Express error-handler middleware) calls `captureError`
 * — the dispatcher swallows reporter exceptions so a misbehaving reporter
 * never breaks request paths.
 */

export type ErrorReporter = (
  error: Error,
  context?: Record<string, unknown>,
) => void;

let reporter: ErrorReporter | null = null;

/** Register an error reporter. Replaces any previously registered one. */
export function setErrorReporter(r: ErrorReporter): void {
  reporter = r;
}

/** Read the currently registered reporter (or null if none). */
export function getErrorReporter(): ErrorReporter | null {
  return reporter;
}

/**
 * Dispatch an error to the registered reporter. No-op if none is registered.
 *
 * Reporter exceptions are swallowed: if Sentry is down or the reporter
 * throws, the request path that called captureError must continue
 * undisturbed.
 */
export function captureError(
  error: Error,
  context?: Record<string, unknown>,
): void {
  if (!reporter) return;
  try {
    reporter(error, context);
  } catch {
    // Intentionally swallowed — see docstring.
  }
}
