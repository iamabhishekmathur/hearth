import type { RequestHandler } from 'express';
import type { UserRole } from '@hearth/shared';
import { prisma } from '../lib/prisma.js';
import { enterTenant } from '../lib/tenant-context.js';

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
    const passportUserId = (req.session as { passport?: { user?: string } } | undefined)?.passport?.user;
    const userId = req.session?.userId ?? passportUserId;
    if (!userId) {
      return next();
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { team: { select: { orgId: true } } },
    });

    if (user) {
      req.session.userId = user.id;
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as UserRole,
        teamId: user.teamId,
        orgId: user.team?.orgId ?? null,
      };
    } else if (userId) {
      delete req.session.userId;
      delete req.user;
    }
  } catch {
    // If session lookup fails, continue unauthenticated
  }

  // Enter the tenant context for the rest of this request. RLS-aware Prisma
  // calls (via withTenantTx) will scope queries to this org. If the user is
  // unauthenticated or has no org, the context is entered with null orgId —
  // withTenantTx will throw if a tenant query is attempted without bypass.
  enterTenant({
    orgId: req.user?.orgId ?? null,
    userId: req.user?.id ?? null,
  });

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
 * Requires the authenticated user to be a member of an org (i.e. have a team).
 * Use this on routes that create or read tenant-owned data — guarantees
 * req.user.orgId is non-null for downstream handlers and services.
 *
 * Must be used after requireAuth.
 */
export const requireOrg: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (!req.user.orgId) {
    res.status(400).json({
      error: 'No organization',
      message: 'Your account is not associated with an organization. Ask an admin to add you to a team.',
    });
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
