import type { RequestHandler } from 'express';

interface RateLimitStore {
  [key: string]: { count: number; resetAt: number };
}

const store: RateLimitStore = {};

/**
 * Simple in-memory rate limiter. For production, use Redis-backed.
 */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  message?: string;
}): RequestHandler {
  const { windowMs, max, message = 'Too many requests' } = options;

  // Clean up expired entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const key in store) {
      if (store[key].resetAt <= now) {
        delete store[key];
      }
    }
  }, windowMs);

  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = store[key];

    if (!entry || entry.resetAt <= now) {
      store[key] = { count: 1, resetAt: now + windowMs };
      return next();
    }

    entry.count++;

    if (entry.count > max) {
      res.status(429).json({ error: message });
      return;
    }

    next();
  };
}

/** Auth rate limiter: 5 req/min per IP in production, relaxed in dev/test */
const authMax = process.env.NODE_ENV === 'production' ? 5 : 500;
export const authRateLimit: RequestHandler = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || String(authMax), 10),
  message: 'Too many authentication attempts. Please try again later.',
});

/** Public endpoint rate limiter: 30 requests per minute per IP */
export const publicRateLimit: RequestHandler = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: 'Too many requests. Please try again later.',
});

// ── Per-tool rate limiting ───────────────────────────────────────────────

interface ToolLimitConfig {
  windowMs: number;
  maxPerUser: number;
}

/** Per-tool rate limit configuration. Tools not listed here are unlimited. */
export const TOOL_LIMITS: Record<string, ToolLimitConfig> = {
  web_search:      { windowMs: 60_000, maxPerUser: 20 },
  web_fetch:       { windowMs: 60_000, maxPerUser: 15 },
  code_execution:  { windowMs: 60_000, maxPerUser: 10 },
  delegate_task:   { windowMs: 60_000, maxPerUser: 5 },
  create_routine:  { windowMs: 60_000, maxPerUser: 10 },
  create_task:     { windowMs: 60_000, maxPerUser: 30 },
  save_memory:     { windowMs: 60_000, maxPerUser: 20 },
};

const toolStore: Record<string, { count: number; resetAt: number }> = {};

/**
 * Checks per-tool rate limit for a user. Returns null if allowed,
 * or an error message string if the limit is exceeded.
 */
export function checkToolRateLimit(userId: string, toolName: string): string | null {
  const config = TOOL_LIMITS[toolName];
  if (!config) return null; // No limit configured

  const key = `${userId}:${toolName}`;
  const now = Date.now();
  const entry = toolStore[key];

  if (!entry || entry.resetAt <= now) {
    toolStore[key] = { count: 1, resetAt: now + config.windowMs };
    return null;
  }

  entry.count++;
  if (entry.count > config.maxPerUser) {
    const retryInSec = Math.ceil((entry.resetAt - now) / 1000);
    return `Rate limit exceeded for ${toolName}. Try again in ${retryInSec}s.`;
  }

  return null;
}

// Clean up expired tool rate limit entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const key in toolStore) {
    if (toolStore[key].resetAt <= now) {
      delete toolStore[key];
    }
  }
}, 60_000);
