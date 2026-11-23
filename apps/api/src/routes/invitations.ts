import { Router } from 'express';
import type {
  AcceptInvitationRequest,
  CreateInvitationRequest,
  InvitationContextType,
} from '@hearth/shared';
import { env } from '../config.js';
import { requireAuth, requireOrg } from '../middleware/auth.js';
import { setCsrfCookie } from '../middleware/csrf.js';
import { sanitizeUser } from '../services/user-service.js';
import * as invitationService from '../services/invitation-service.js';
import { logger } from '../lib/logger.js';

const router: ReturnType<typeof Router> = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = new Set(['admin', 'team_lead', 'member', 'viewer']);
const VALID_CONTEXT_TYPES = new Set<InvitationContextType>([
  'decision',
  'chat_session',
  'task',
]);

// ──────────────────────────────────────────────
// Authed endpoints (org-scoped)
// ──────────────────────────────────────────────

/**
 * POST /api/v1/invitations — create (or idempotently refresh) an invite.
 * Body: { email, role?, context? }
 */
router.post('/', requireAuth, requireOrg, async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as CreateInvitationRequest;
    const email = typeof body.email === 'string' ? body.email.trim() : '';

    if (!EMAIL_REGEX.test(email) || email.length > 254) {
      res.status(400).json({ error: 'A valid email is required' });
      return;
    }
    if (body.role && !VALID_ROLES.has(body.role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }
    if (body.context) {
      if (
        !VALID_CONTEXT_TYPES.has(body.context.type) ||
        typeof body.context.id !== 'string' ||
        !body.context.id
      ) {
        res.status(400).json({ error: 'Invalid context' });
        return;
      }
    }

    const { invite, acceptUrl } = await invitationService.createInvite({
      orgId: req.user!.orgId!,
      email,
      invitedByUserId: req.user!.id,
      role: body.role,
      context: body.context,
    });

    res.status(201).json({
      data: { invitation: invitationService.serializeInvitation(invite), acceptUrl },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/invitations — list the caller's org's invitations.
 */
router.get('/', requireAuth, requireOrg, async (req, res, next) => {
  try {
    const invites = await invitationService.listInvites(req.user!.orgId!);
    res.json({ data: invites.map(invitationService.serializeInvitation) });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/invitations/:id — revoke a pending invite (org-scoped).
 */
router.delete('/:id', requireAuth, requireOrg, async (req, res, next) => {
  try {
    const ok = await invitationService.revokeInvite(
      req.params.id as string,
      req.user!.orgId!,
    );
    if (!ok) {
      res.status(404).json({ error: 'Invitation not found or not pending' });
      return;
    }
    res.json({ message: 'Invitation revoked' });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────
// Public endpoints (no session) — token-gated
// ──────────────────────────────────────────────

/**
 * GET /api/v1/invitations/token/:token — PUBLIC preview for the accept screen.
 * Returns { orgName, invitedByName, email, context } or 404 for an
 * unknown/expired/non-pending token.
 */
router.get('/token/:token', async (req, res, next) => {
  try {
    const preview = await invitationService.getPreviewByToken(
      req.params.token as string,
    );
    if (!preview) {
      res.status(404).json({ error: 'Invitation not found or no longer valid' });
      return;
    }
    res.json({ data: preview });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/invitations/token/:token/accept — PUBLIC accept.
 *
 * CSRF-exempt (no prior session/cookie — see EXEMPT_PATHS in csrf.ts) and,
 * exactly like /auth/register, establishes the session + sets the CSRF cookie
 * so the freshly-created invitee is logged in immediately. Returns
 * { user, context } — context lands the invitee in the referenced artifact.
 */
router.post('/token/:token/accept', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as AcceptInvitationRequest;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!name || name.length > 200) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!password || password.length < 8) {
      res.status(400).json({ error: 'password must be at least 8 characters' });
      return;
    }

    const { user, context } = await invitationService.acceptInvite(
      req.params.token as string,
      { name, password },
    );

    // Establish the session + CSRF cookie — mirror /auth/register so the
    // invitee is authenticated on the very next request.
    req.session.userId = user.id;
    const isSecure = env.NODE_ENV === 'production';
    setCsrfCookie(res, isSecure);

    res.status(201).json({ data: { user: sanitizeUser(user), context } });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'Invitation not found') {
      res.status(404).json({ error: msg });
      return;
    }
    if (msg === 'Invitation is no longer valid') {
      res.status(410).json({ error: msg });
      return;
    }
    if (msg === 'Email already registered') {
      res.status(409).json({ error: msg });
      return;
    }
    logger.error({ err }, 'accept invitation failed');
    next(err);
  }
});

export default router;
