import type { RequestHandler } from 'express';
import type { UserRole } from '@hearth/shared';
import { prisma } from '../lib/prisma.js';

// Extend express-session to include userId
declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  teamId: string | null;
  orgId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends AuthenticatedUser {}
  }
}

/**
 * Attaches user to the request if a valid session exists.
 * Does not require authentication — use `requireAuth` for that.
 */
export const attachUser: RequestHandler = async (req, _res, next) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return next();
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { team: { select: { orgId: true } } },
    });

    if (user) {
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as UserRole,
        teamId: user.teamId,
        orgId: user.team?.orgId ?? null,
      };
    }
  } catch {
    // If session lookup fails, continue unauthenticated
  }

  next();
};

/**
 * Requires a valid authenticated session. Returns 401 if no session.
 */
export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
};

/**
 * Requires the authenticated user to have one of the specified roles.
 * Must be used after `requireAuth`.
 */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
