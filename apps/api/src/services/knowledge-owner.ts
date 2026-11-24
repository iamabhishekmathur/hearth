/**
 * Knowledge loop — who owns a memory entry or a routine.
 *
 * An owner may roll back the item and (from Phase 2) approve proposed changes
 * to it. Hearth adds no new user roles: ownership follows the scope the item
 * already has, and an admin may name an explicit owner to override it.
 *
 *   memory layer / routine scope   default owner(s)
 *   ─────────────────────────────  ─────────────────────────────────────────
 *   org                            every admin in the org
 *   team                           admins and that team's team leads
 *   user / personal (and session)  the person
 *
 * An explicit `ownerId` is ADDED to the default owners; it never removes them.
 */
import { prisma } from '../lib/prisma.js';

export interface KnowledgeActor {
  userId: string;
  orgId: string | null;
  teamId: string | null;
  role: string;
}

export interface MemoryOwnershipTarget {
  layer: string;
  orgId: string;
  teamId: string | null;
  userId: string | null;
  ownerId: string | null;
}

export interface RoutineOwnershipTarget {
  scope: string;
  orgId: string | null;
  teamId: string | null;
  userId: string;
  ownerId: string | null;
}

export function isMemoryOwner(actor: KnowledgeActor, m: MemoryOwnershipTarget): boolean {
  if (!actor.orgId || m.orgId !== actor.orgId) return false;
  if (m.ownerId && m.ownerId === actor.userId) return true;
  switch (m.layer) {
    case 'org':
      return actor.role === 'admin';
    case 'team':
      return actor.role === 'admin' || (actor.role === 'team_lead' && actor.teamId === m.teamId);
    case 'user':
    case 'session':
      return m.userId === actor.userId;
    default:
      return false;
  }
}

/**
 * Mirrors the edit rule in routine-service.checkRoutinePermission so an owner
 * is never someone who could not otherwise edit the routine.
 */
export function isRoutineOwner(actor: KnowledgeActor, r: RoutineOwnershipTarget): boolean {
  if (r.orgId && actor.orgId && r.orgId !== actor.orgId) return false;
  if (r.ownerId && r.ownerId === actor.userId) return true;
  switch (r.scope) {
    case 'team':
      return r.teamId === actor.teamId && ['admin', 'team_lead'].includes(actor.role);
    case 'org':
      return r.orgId === actor.orgId && actor.role === 'admin';
    case 'personal':
    default:
      return r.userId === actor.userId;
  }
}

/** Org id of a user (users belong to an org through their team). */
async function orgOfUser(
  userId: string,
): Promise<{ orgId: string | null; teamId: string | null; role: string } | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, teamId: true, team: { select: { orgId: true } } },
  });
  if (!u) return null;
  return { orgId: u.team?.orgId ?? null, teamId: u.teamId, role: u.role };
}

export type OwnerCheck = { ok: true } | { ok: false; reason: string };

/**
 * May `ownerId` own an item with this visibility? The owner must be in the
 * same org and must be able to see the item (a team item needs someone in
 * that team; a personal item can only be owned by its person).
 */
export async function validateOwner(
  ownerId: string,
  item: {
    orgId: string | null;
    kind: 'org' | 'team' | 'personal';
    teamId: string | null;
    userId: string | null;
  },
): Promise<OwnerCheck> {
  const target = await orgOfUser(ownerId);
  if (!target || !item.orgId || target.orgId !== item.orgId) {
    return { ok: false, reason: 'Owner must be a user in the same organization' };
  }
  if (target.role === 'viewer') {
    return { ok: false, reason: 'A viewer cannot own knowledge' };
  }
  // Team items are only visible inside their team (memory + routine read rules),
  // so an owner from another team — even an admin — could not open them.
  if (item.kind === 'team' && target.teamId !== item.teamId) {
    return { ok: false, reason: 'Owner of a team item must be on that team' };
  }
  if (item.kind === 'personal' && ownerId !== item.userId) {
    return { ok: false, reason: 'Personal items are owned by their person' };
  }
  return { ok: true };
}
