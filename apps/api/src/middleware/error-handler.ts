import type { ErrorRequestHandler } from 'express';
import { logger } from '../lib/logger.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  logger.error({ err }, 'Unhandled error');

  const status = err.status || err.statusCode || 500;
  const message =
    process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message || 'Unknown error';

  res.status(status).json({ error: message });
};
