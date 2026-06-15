// ──────────────────────────────────────────────
// Invitations (growth loop)
//
// Shared contract between the API (Track A: invitation-service + routes) and
// the web (invite UI + accept screen). A nullable context = a plain invite;
// a set context = a CONTEXTUAL invite that lands the invitee directly in the
// referenced artifact after they accept.
// ──────────────────────────────────────────────

import type { UserRole } from './user.js';

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

/** Artifact an invite can be scoped to (contextual invites). */
export type InvitationContextType = 'decision' | 'chat_session' | 'task';

/** The context an invite points at. Passed to createInvite and echoed back on accept. */
export interface InvitationContext {
  type: InvitationContextType;
  id: string;
}

/** Invitation row as returned to authed callers (list/create). No token leak in list. */
export interface Invitation {
  id: string;
  orgId: string;
  email: string;
  role: UserRole;
  status: InvitationStatus;
  contextType: InvitationContextType | null;
  contextId: string | null;
  invitedByUserId: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  acceptedUserId: string | null;
}

/** POST /api/v1/invitations body. */
export interface CreateInvitationRequest {
  email: string;
  role?: UserRole;
  context?: InvitationContext;
}

/**
 * Public preview of an invite, by token (GET /invitations/token/:token).
 * No secrets — just enough for the accept screen to show who invited whom.
 */
export interface InvitationPreview {
  orgName: string;
  invitedByName: string;
  email: string;
  context: InvitationContext | null;
}

/** POST /invitations/token/:token/accept body. */
export interface AcceptInvitationRequest {
  name: string;
  password: string;
}
