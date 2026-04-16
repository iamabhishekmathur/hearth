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

/** Auth rate limiter: 5 requests per minute per IP */
export const authRateLimit: RequestHandler = rateLimit({
  windowMs: 60_000,
  max: 5,
  message: 'Too many authentication attempts. Please try again later.',
});

/** Public endpoint rate limiter: 30 requests per minute per IP */
export const publicRateLimit: RequestHandler = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: 'Too many requests. Please try again later.',
});
