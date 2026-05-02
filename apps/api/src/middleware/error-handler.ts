import type { ErrorRequestHandler } from 'express';
import { logger } from '../lib/logger.js';
import { captureError } from '../extensions/error-reporter.js';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  logger.error({ err }, 'Unhandled error');

  // Forward to the registered error reporter (cloud wires Sentry here).
  // No-op when self-hosting without a reporter registered.
  captureError(err instanceof Error ? err : new Error(String(err)), {
    url: req.originalUrl,
    method: req.method,
    userId: req.user?.id,
    orgId: req.user?.orgId,
  });

  const status = err.status || err.statusCode || 500;
  const message =
    process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message || 'Unknown error';

  res.status(status).json({ error: message });
};
