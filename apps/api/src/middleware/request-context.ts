import type { Request, Response, NextFunction } from 'express';
import { runWithContext } from '../lib/request-context.js';

/**
 * Express middleware that wraps request handlers in AsyncLocalStorage context.
 * Must run after auth middleware so req.user is populated.
 */
export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const orgId = req.user?.orgId;
  if (!orgId) {
    // No auth context — skip context wrapping
    next();
    return;
  }

  runWithContext(
    {
      orgId,
      userId: req.user?.id,
      sessionId: req.sessionID,
    },
    () => next(),
  );
}
