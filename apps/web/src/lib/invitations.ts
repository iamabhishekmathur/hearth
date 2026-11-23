/**
 * Client-side contract + API helpers for the referral / invite loop (Track C).
 *
 * These mirror the SHARED CONTRACT Track A implements on the backend. They live
 * in web rather than @hearth/shared because this track owns only the frontend;
 * if/when Track A publishes canonical shared types we can re-point these to the
 * shared package without touching call sites.
 *
 * Endpoints (all under /api/v1):
 *   POST   /invitations                         (auth)   create
 *   GET    /invitations                         (auth)   list org's pending
 *   DELETE /invitations/:id                     (auth)   revoke
 *   GET    /invitations/token/:token            (PUBLIC) preview
 *   POST   /invitations/token/:token/accept     (PUBLIC) accept -> session set
 */
import { api } from './api-client';

export type InviteRole = 'member' | 'admin';
export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export type InviteContextType = 'decision' | 'chat_session' | 'task';

/** The artifact an invitee should land in once they accept a contextual invite. */
export interface InviteContext {
  type: InviteContextType;
  id: string;
  /** Optional human label for the artifact (e.g. decision title), if the API supplies it. */
  label?: string | null;
}

/** A pending/sent invitation as returned by GET /invitations. */
export interface Invitation {
  id: string;
  email: string;
  role: InviteRole;
  status: InviteStatus;
  contextType: InviteContextType | null;
  contextId: string | null;
  createdAt: string;
  expiresAt: string | null;
  /** The full accept URL (WEB_URL + '#/invite/' + token). Present on create. */
  acceptUrl?: string;
}

/** Public preview shown on the accept page before the invitee has an account. */
export interface InvitePreview {
  orgName: string;
  invitedByName: string;
  email: string;
  context: InviteContext | null;
}

/** Result of accepting an invite — session is established server-side. */
export interface AcceptInviteResult {
  user: { id: string; email: string; name: string };
  context: InviteContext | null;
}

export interface CreateInviteInput {
  email: string;
  role?: InviteRole;
  context?: { type: InviteContextType; id: string };
}

/** POST /invitations — create (or idempotently refresh) a pending invite. */
export async function createInvite(
  input: CreateInviteInput,
): Promise<Invitation> {
  const res = await api.post<{ data: Invitation }>('/invitations', input);
  return res.data;
}

/** GET /invitations — list the org's pending invitations. */
export async function listInvites(): Promise<Invitation[]> {
  const res = await api.get<{ data: Invitation[] }>('/invitations');
  return res.data;
}

/** DELETE /invitations/:id — revoke a pending invite. */
export async function revokeInvite(id: string): Promise<void> {
  await api.delete(`/invitations/${id}`);
}

const PUBLIC_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

/**
 * GET /invitations/token/:token — PUBLIC preview. Uses raw fetch (not the api
 * client) because the viewer is unauthenticated; a 404 means the token is bad,
 * revoked, or expired.
 */
export async function getInvitePreview(token: string): Promise<InvitePreview> {
  const res = await fetch(`${PUBLIC_BASE}/invitations/token/${token}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'This invitation is no longer valid.'
        : 'Could not load this invitation.',
    );
  }
  const json = (await res.json()) as { data: InvitePreview };
  return json.data;
}

/**
 * POST /invitations/token/:token/accept — PUBLIC, CSRF-exempt (like register).
 * Creates the member user, establishes the session + CSRF cookie server-side,
 * and returns the new user + any contextual landing target. We use raw fetch so
 * we don't attach the (nonexistent) CSRF token the api client would look for.
 */
export async function acceptInvite(
  token: string,
  body: { name: string; password: string },
): Promise<AcceptInviteResult> {
  const res = await fetch(`${PUBLIC_BASE}/invitations/token/${token}/accept`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = 'Could not accept this invitation.';
    try {
      const json = (await res.json()) as { error?: string; message?: string };
      message = json.error ?? json.message ?? message;
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }
  const json = (await res.json()) as { data: AcceptInviteResult };
  return json.data;
}

/**
 * Resolve a contextual invite's artifact into the hash route the invitee should
 * land on. Falls back to /chat when there is no context (a plain invite).
 */
export function contextLandingHash(context: InviteContext | null): string {
  if (!context) return '/chat';
  switch (context.type) {
    case 'decision':
      return `/decisions?id=${context.id}`;
    case 'chat_session':
      return `/chat/${context.id}`;
    case 'task':
      return `/tasks?taskId=${context.id}`;
    default:
      return '/chat';
  }
}
