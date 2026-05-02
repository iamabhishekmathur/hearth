import type { User } from '@prisma/client';

/**
 * OAuth-first signup hook.
 *
 * When a new user (no existing user with their email) signs in via OAuth,
 * `findOrCreateOAuthUser` consults this provisioner before falling back
 * to OSS default behavior (the first-user-becomes-admin setup pattern).
 *
 * Cloud uses this to auto-create a new org per signup, with a welcome
 * chat session, the user as admin, etc. Self-hosters don't register a
 * provisioner — OSS default kicks in.
 *
 * The provisioner returns the newly-created User row, or `null` to
 * decline (in which case OSS default behavior runs).
 */

export interface OAuthProvisionerProfile {
  provider: 'google' | 'github';
  email: string;
  name: string;
}

export type OAuthProvisioner = (
  profile: OAuthProvisionerProfile,
) => Promise<User | null>;

let provisioner: OAuthProvisioner | null = null;

/** Register a provisioner. Replaces any previously registered one. */
export function setOAuthProvisioner(p: OAuthProvisioner): void {
  provisioner = p;
}

/** Read the currently registered provisioner (or null if none). */
export function getOAuthProvisioner(): OAuthProvisioner | null {
  return provisioner;
}
