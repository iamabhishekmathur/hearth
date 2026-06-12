import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

export interface PersonHandle {
  email?: string;
  slackUserId?: string;
  notionUserId?: string;
  googleId?: string;
  displayName?: string;
}

type HandleKey = 'email' | 'slackUserId' | 'notionUserId' | 'googleId';
const HANDLE_KEYS: HandleKey[] = ['email', 'slackUserId', 'notionUserId', 'googleId'];

/**
 * Upsert a Person by integration handle.
 *
 * Behavior:
 *   - If no Person matches any provided handle, create a new one.
 *   - If a Person matches by any handle, return it; backfill any *null* handle
 *     fields from the new payload, but never overwrite a non-null field.
 *   - Conflicts (existing handle != provided handle) are preserved on the
 *     existing record. The caller can detect this via the returned Person.
 */
export async function upsertPersonFromHandle(orgId: string, handle: PersonHandle) {
  const providedHandles = HANDLE_KEYS.filter((k) => handle[k]);
  if (providedHandles.length === 0) {
    throw new Error('upsertPersonFromHandle requires at least one handle (email, slackUserId, notionUserId, or googleId)');
  }

  const or = providedHandles.map((k) => ({ [k]: handle[k]! }));
  const existing = await prisma.person.findFirst({
    where: { orgId, OR: or },
  });

  if (!existing) {
    return prisma.person.create({
      data: {
        orgId,
        email: handle.email ?? null,
        slackUserId: handle.slackUserId ?? null,
        notionUserId: handle.notionUserId ?? null,
        googleId: handle.googleId ?? null,
        displayName: handle.displayName ?? null,
      },
    });
  }

  // Backfill: only fill nulls, never overwrite non-null values.
  const updates: Record<string, string> = {};
  for (const key of HANDLE_KEYS) {
    const incoming = handle[key];
    if (incoming && existing[key] === null) {
      updates[key] = incoming;
    }
  }
  if (handle.displayName && existing.displayName === null) {
    updates.displayName = handle.displayName;
  }

  if (Object.keys(updates).length === 0) {
    return existing;
  }

  return prisma.person.update({
    where: { id: existing.id },
    data: updates,
  });
}

/**
 * Link a Person to a Hearth User. Throws if the user does not exist.
 * Useful for identity resolution flows (e.g. user confirms "this Slack user is me").
 */
export async function linkPersonToUser(personId: string, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error(`Cannot link Person ${personId}: user ${userId} does not exist`);
  }

  logger.debug({ personId, userId }, 'Linking Person to User');
  return prisma.person.update({
    where: { id: personId },
    data: { userId },
  });
}
