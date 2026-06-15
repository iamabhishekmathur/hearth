import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import type { Invitation, User } from '@prisma/client';
import type {
  InvitationContext,
  InvitationContextType,
} from '@hearth/shared';
import { prisma } from '../lib/prisma.js';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { capture } from '../lib/analytics.js';
import { isEmailConfigured, sendEmail } from './email-service.js';
import { markStepComplete } from './onboarding-service.js';

const BCRYPT_ROUNDS = 12;

/** Invites are valid for 14 days from (re)issue. */
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Resolve email gating identically to the contract: send if SMTP (or RESEND)
 * is configured, otherwise skip the send. Either way the caller still gets the
 * acceptUrl back, so dev/CI is fully self-serve without a mail server.
 *
 * RESEND is read straight from process.env (like lib/analytics) so honoring it
 * never forces a config-schema change. The actual transport is SMTP via
 * email-service; RESEND_API_KEY simply flips the "configured" gate on.
 */
function emailConfigured(): boolean {
  return isEmailConfigured() || Boolean(process.env.RESEND_API_KEY);
}

function buildAcceptUrl(token: string): string {
  return `${env.WEB_URL}#/invite/${token}`;
}

function contextFromRow(inv: Invitation): InvitationContext | null {
  if (!inv.contextType || !inv.contextId) return null;
  return { type: inv.contextType as InvitationContextType, id: inv.contextId };
}

export interface CreateInviteInput {
  orgId: string;
  email: string;
  invitedByUserId: string;
  role?: 'admin' | 'team_lead' | 'member' | 'viewer';
  context?: InvitationContext;
}

export interface CreateInviteResult {
  invite: Invitation;
  acceptUrl: string;
}

/**
 * Create (or idempotently refresh) a pending invite for (orgId, email).
 *
 * Idempotency: if a PENDING invite already exists for the pair, we REUSE its
 * row — refreshing token/expiry/role/context and keeping the same id. This
 * matches the DB partial-unique constraint (one pending per org+email) and
 * means "invite again" is a no-surprise refresh rather than an error.
 *
 * Emits INVITE_SENT analytics for the inviter. Sends the email if configured;
 * otherwise logs and still returns the acceptUrl.
 */
export async function createInvite(
  input: CreateInviteInput,
): Promise<CreateInviteResult> {
  const email = input.email.trim().toLowerCase();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const existing = await prisma.invitation.findFirst({
    where: { orgId: input.orgId, email, status: 'pending' },
  });

  const data = {
    token,
    role: input.role ?? 'member',
    contextType: (input.context?.type ?? null) as InvitationContextType | null,
    contextId: input.context?.id ?? null,
    expiresAt,
    invitedByUserId: input.invitedByUserId,
  };

  const invite = existing
    ? await prisma.invitation.update({ where: { id: existing.id }, data })
    : await prisma.invitation.create({
        data: { orgId: input.orgId, email, status: 'pending', ...data },
      });

  const acceptUrl = buildAcceptUrl(invite.token);

  // INVITE_SENT — funnel referral event, keyed to the inviter.
  await capture(input.invitedByUserId, 'invite_sent', {
    count: 1,
    context: invite.contextType ?? 'plain',
    inviteId: invite.id,
  });

  // Any invite (direct or contextual) completes the inviter's invite_teammate
  // onboarding step. Best-effort; never blocks the invite.
  void markStepComplete(input.invitedByUserId, 'invite_teammate').catch(() => {});

  await deliverInviteEmail(invite, acceptUrl);

  return { invite, acceptUrl };
}

async function deliverInviteEmail(
  invite: Invitation,
  acceptUrl: string,
): Promise<void> {
  if (!emailConfigured()) {
    logger.info(
      { inviteId: invite.id, email: invite.email, acceptUrl },
      'Invite email skipped (no SMTP/RESEND configured); acceptUrl returned to caller',
    );
    return;
  }

  try {
    const org = await prisma.org.findUnique({
      where: { id: invite.orgId },
      select: { name: true },
    });
    const orgName = org?.name ?? 'your team';
    await sendEmail({
      to: invite.email,
      subject: `You're invited to join ${orgName} on Hearth`,
      text: `You've been invited to join ${orgName} on Hearth.\n\nAccept your invite:\n${acceptUrl}\n\nThis link expires on ${invite.expiresAt.toISOString()}.`,
      html: `<p>You've been invited to join <strong>${orgName}</strong> on Hearth.</p><p><a href="${acceptUrl}">Accept your invite</a></p><p>This link expires on ${invite.expiresAt.toISOString()}.</p>`,
    });
  } catch (err) {
    // Email is best-effort — never fail invite creation on a send error.
    logger.error({ err, inviteId: invite.id }, 'Invite email send failed');
  }
}

/** Look up an invite by its token. Returns null if not found. */
export async function getByToken(token: string): Promise<Invitation | null> {
  return prisma.invitation.findUnique({ where: { token } });
}

export interface InvitationPreviewResult {
  orgName: string;
  invitedByName: string;
  email: string;
  context: InvitationContext | null;
}

/**
 * Public preview for the accept screen. Returns null when the token is unknown,
 * not pending, or expired (so callers render a single "invalid invite" state).
 */
export async function getPreviewByToken(
  token: string,
): Promise<InvitationPreviewResult | null> {
  const invite = await prisma.invitation.findUnique({
    where: { token },
    include: {
      org: { select: { name: true } },
      invitedBy: { select: { name: true } },
    },
  });
  if (!invite) return null;
  if (invite.status !== 'pending') return null;
  if (invite.expiresAt.getTime() < Date.now()) return null;

  return {
    orgName: invite.org.name,
    invitedByName: invite.invitedBy.name,
    email: invite.email,
    context: contextFromRow(invite),
  };
}

export interface AcceptInviteResult {
  user: User;
  context: InvitationContext | null;
}

/**
 * Accept an invite: create a member User in the invite's org (joining the
 * org's oldest team) and mark the invite accepted — atomically. The created
 * user is a normal email/password account so they can log in again later.
 *
 * Throws:
 *   - 'Invitation not found'
 *   - 'Invitation is no longer valid'  (revoked/accepted/expired)
 *   - 'Email already registered'       (a user with this email already exists)
 */
export async function acceptInvite(
  token: string,
  input: { name: string; password: string },
): Promise<AcceptInviteResult> {
  const invite = await prisma.invitation.findUnique({ where: { token } });
  if (!invite) {
    throw new Error('Invitation not found');
  }
  if (invite.status !== 'pending') {
    throw new Error('Invitation is no longer valid');
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    // Lazily flip to expired so it can't be retried.
    await prisma.invitation.update({
      where: { id: invite.id },
      data: { status: 'expired' },
    });
    throw new Error('Invitation is no longer valid');
  }

  const email = invite.email.trim().toLowerCase();
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new Error('Email already registered');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  // The invitee joins the org's oldest team (the same fallback auth-service
  // uses for self-serve signup). teamId carries the org association.
  const team = await prisma.team.findFirst({
    where: { orgId: invite.orgId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  // Atomic: create the user AND mark the invite accepted together, so a
  // half-accept can't leave a user with a still-pending invite (or vice versa).
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        name: input.name,
        passwordHash,
        authProvider: 'email',
        role: invite.role,
        teamId: team?.id ?? null,
        preferences: {},
      },
    });

    await tx.invitation.update({
      where: { id: invite.id },
      data: {
        status: 'accepted',
        acceptedAt: new Date(),
        acceptedUserId: created.id,
      },
    });

    return created;
  });

  // INVITE_ACCEPTED — keyed to the NEW user so client+server stitch onto them.
  await capture(user.id, 'invite_accepted', { inviteId: invite.id });

  return { user, context: contextFromRow(invite) };
}

/**
 * List an org's invitations (newest first). Always explicitly scoped by orgId
 * because `invitations` is intentionally NOT under RLS (see schema comment).
 */
export async function listInvites(orgId: string): Promise<Invitation[]> {
  return prisma.invitation.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Revoke a pending invite. Org-scoped (id AND orgId) so one org can't revoke
 * another's invite. Returns false if no matching pending invite was found.
 */
export async function revokeInvite(id: string, orgId: string): Promise<boolean> {
  const result = await prisma.invitation.updateMany({
    where: { id, orgId, status: 'pending' },
    data: { status: 'revoked' },
  });
  return result.count > 0;
}

/** Strip internal/secret fields for API responses (no token in list output). */
export function serializeInvitation(inv: Invitation) {
  return {
    id: inv.id,
    orgId: inv.orgId,
    email: inv.email,
    role: inv.role,
    status: inv.status,
    contextType: inv.contextType,
    contextId: inv.contextId,
    invitedByUserId: inv.invitedByUserId,
    expiresAt: inv.expiresAt.toISOString(),
    createdAt: inv.createdAt.toISOString(),
    acceptedAt: inv.acceptedAt ? inv.acceptedAt.toISOString() : null,
    acceptedUserId: inv.acceptedUserId,
  };
}
