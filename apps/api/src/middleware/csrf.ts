import type { RequestHandler, Response } from 'express';
import crypto from 'node:crypto';

const CSRF_COOKIE_NAME = 'hearth.csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Paths that don't require CSRF validation — because they either:
 *  - set the CSRF cookie (login/register/oauth callback)
 *  - run before any session exists (first-run setup)
 *
 * Matched against `req.originalUrl` with startsWith, so both root-mounted
 * and router-mounted invocations work.
 */
const EXEMPT_PATHS: readonly string[] = [
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/oauth/',
  '/api/v1/admin/setup/',
  '/api/v1/webhooks/slack',
];

/**
 * Generate a CSRF token and set it as a cookie.
 * Call this after successful login / registration.
 */
export function setCsrfCookie(res: Response, isSecure: boolean): string {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // must be readable by JS to send in header
    secure: isSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
  return token;
}

function isExempt(originalUrl: string | undefined): boolean {
  if (!originalUrl) return false;
  // Strip query string before matching
  const pathOnly = originalUrl.split('?')[0];
  return EXEMPT_PATHS.some((prefix) => pathOnly.startsWith(prefix));
}

/**
 * CSRF protection via double-submit cookie pattern.
 * For state-changing requests, validates that the X-CSRF-Token header
 * matches the csrf cookie value using timing-safe comparison.
 */
export const csrfProtection: RequestHandler = (req, res, next) => {
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    return next();
  }

  if (isExempt(req.originalUrl || req.url)) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME] as string | undefined;
  const headerToken = req.headers[CSRF_HEADER_NAME] as string | undefined;

  if (!cookieToken || !headerToken) {
    res.status(403).json({ error: 'CSRF token missing' });
    return;
  }

  // Timing-safe comparison to prevent token leakage via timing attacks
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(403).json({ error: 'CSRF token mismatch' });
    return;
  }

  next();
};
