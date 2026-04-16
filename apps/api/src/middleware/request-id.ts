import type { RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const requestId: RequestHandler = (req, _res, next) => {
  req.id = (req.headers['x-request-id'] as string) || uuidv4();
  next();
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
    }
  }
}
