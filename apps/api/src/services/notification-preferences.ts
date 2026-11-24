/**
 * Per-person notification switches, stored in `NotificationPreference.prefs`.
 *
 * Only the keys a person has set are stored; everything else comes from the
 * defaults below, so a new switch never needs a backfill. Unknown keys in the
 * stored JSON are ignored.
 *
 *   knowledgeSummary    on   owner daily item + the one 7-day reminder
 *   knowledgeEmail      off  email the knowledge summary too
 *   adminWeeklySummary  on for admins, off for everyone else
 *   knowledgeImpact     on   "Your input improved N things this week"
 */
import { z } from 'zod';
import type { NotificationPreferences } from '@hearth/shared';
import { prisma } from '../lib/prisma.js';

export const PREFERENCE_KEYS = [
  'knowledgeSummary',
  'knowledgeEmail',
  'adminWeeklySummary',
  'knowledgeImpact',
] as const satisfies ReadonlyArray<keyof NotificationPreferences>;

/** PUT body: any subset of the switches, booleans only, nothing else. */
export const preferencesPatchSchema = z
  .object({
    knowledgeSummary: z.boolean(),
    knowledgeEmail: z.boolean(),
    adminWeeklySummary: z.boolean(),
    knowledgeImpact: z.boolean(),
  })
  .partial()
  .strict();

export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;

export function defaultPreferences(role: string): NotificationPreferences {
  return {
    knowledgeSummary: true,
    knowledgeEmail: false,
    adminWeeklySummary: role === 'admin',
    knowledgeImpact: true,
  };
}

/** Pure: stored JSON (any shape) + role → the effective switches. */
export function resolvePreferences(stored: unknown, role: string): NotificationPreferences {
  const out = defaultPreferences(role);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return out;
  const raw = stored as Record<string, unknown>;
  for (const key of PREFERENCE_KEYS) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key] as boolean;
  }
  return out;
}

export async function getPreferences(
  userId: string,
  role: string,
): Promise<NotificationPreferences> {
  const row = await prisma.notificationPreference.findUnique({ where: { userId } });
  return resolvePreferences(row?.prefs, role);
}

/** Many people at once (the digest job). Missing rows → defaults. */
export async function getPreferencesFor(
  users: Array<{ id: string; role: string }>,
): Promise<Map<string, NotificationPreferences>> {
  const rows = users.length
    ? await prisma.notificationPreference.findMany({
        where: { userId: { in: users.map((u) => u.id) } },
      })
    : [];
  const stored = new Map(rows.map((r) => [r.userId, r.prefs]));
  return new Map(users.map((u) => [u.id, resolvePreferences(stored.get(u.id), u.role)]));
}

/** Merges the patch into what the person already stored. */
export async function updatePreferences(
  userId: string,
  role: string,
  patch: PreferencesPatch,
): Promise<NotificationPreferences> {
  const row = await prisma.notificationPreference.findUnique({ where: { userId } });
  const current =
    row?.prefs && typeof row.prefs === 'object' && !Array.isArray(row.prefs)
      ? (row.prefs as Record<string, unknown>)
      : {};
  const next = { ...current, ...patch };
  await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, prefs: next },
    update: { prefs: next },
  });
  return resolvePreferences(next, role);
}
