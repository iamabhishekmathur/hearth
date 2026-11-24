/**
 * Knowledge loop, Phase 3 — closing the loop, quietly.
 *
 * Nothing here pings anyone per event. Approving or rejecting a card notifies
 * no one. What people get instead:
 *
 *   - owners: ONE line in their existing daily digest when cards wait
 *     ("3 proposals wait in Review"), plus ONE reminder per card once it has
 *     waited 7 days (never a second one);
 *   - members: one line on the Activity page when their input fed an
 *     approved fix this week (in-app only, no bell, no email);
 *   - admins: a weekly summary on the Activity page (what changed, what
 *     waits, which areas have no owner), and one line in Monday's digest;
 *   - everyone: an "updated" marker on chat sources whose memory changed in
 *     the last 7 days.
 *
 * Everything is behind the org flag `knowledgeLoop` and each piece has a
 * switch in the person's notification preferences.
 */
import type { KnowledgeProposal as ProposalRow } from '@prisma/client';
import type {
  KnowledgeAdminSummary,
  KnowledgeMyImpact,
  KnowledgeUnownedArea,
  KnowledgeChangeSource,
} from '@hearth/shared';
import { prisma } from '../lib/prisma.js';
import type { KnowledgeActor } from './knowledge-owner.js';
import {
  loadTarget,
  memoryTargetName,
  type CuratorTarget,
  type TargetType,
} from './knowledge-curator.js';
import { canReview } from './knowledge-proposals.js';

export const DAY_MS = 86_400_000;
/** A card that has waited this long gets its one reminder. */
export const REMINDER_AFTER_DAYS = 7;
/** A source whose current version is this recent shows "updated". */
export const UPDATED_WINDOW_DAYS = 7;

// ── Pure text ─────────────────────────────────────────────────────────────

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export interface WaitingCard {
  id: string;
  targetType: string;
  targetId: string;
  targetName: string;
  availableAt: Date;
  remindedAt: Date | null;
}

/**
 * The owner's one digest line. One target → "3 proposals for <name>";
 * several → "5 proposals wait in Review". Nothing waiting → null.
 */
export function ownerSummaryLine(cards: WaitingCard[]): string | null {
  if (cards.length === 0) return null;
  const targets = new Set(cards.map((c) => `${c.targetType}:${c.targetId}`));
  const n = cards.length;
  if (targets.size === 1) {
    return `${n} ${plural(n, 'proposal', 'proposals')} for ${cards[0].targetName}`;
  }
  return `${n} proposals wait in Review`;
}

/** Cards that have waited ≥ 7 days and never had their reminder. */
export function cardsDueForReminder(cards: WaitingCard[], now: Date): WaitingCard[] {
  const cutoff = now.getTime() - REMINDER_AFTER_DAYS * DAY_MS;
  return cards.filter((c) => !c.remindedAt && c.availableAt.getTime() <= cutoff);
}

export function reminderLine(due: WaitingCard[]): string | null {
  if (due.length === 0) return null;
  if (due.length === 1) return `Waiting a week: ${due[0].targetName}`;
  return `${due.length} proposals have waited a week`;
}

export function impactLine(count: number): string | null {
  if (count < 1) return null;
  return `Your input improved ${count} ${plural(count, 'thing', 'things')} this week.`;
}

export function adminWeeklyLine(s: KnowledgeAdminSummary): string | null {
  const changed = s.changed.approved + s.changed.edited;
  const unowned = s.unowned.length;
  if (changed === 0 && s.waiting.pending === 0 && unowned === 0) return null;
  const parts: string[] = [];
  parts.push(`${changed} changed`);
  if (s.waiting.pending > 0) {
    const oldest = s.waiting.oldestDays ?? 0;
    parts.push(
      `${s.waiting.pending} ${plural(s.waiting.pending, 'waits', 'wait')} (oldest ${oldest} ${plural(oldest, 'day', 'days')})`,
    );
  } else {
    parts.push('none wait');
  }
  if (unowned > 0) {
    parts.push(`${unowned} ${plural(unowned, 'area has', 'areas have')} no owner`);
  }
  return `Knowledge this week: ${parts.join(' · ')}`;
}

/**
 * Pure: is a source "recently updated"? Its CURRENT version must be a change
 * (version > 1 — the first version is creation, not an update) saved within
 * the last 7 days.
 */
export function isRecentlyUpdated(
  currentVersion: number,
  versionCreatedAt: Date | null | undefined,
  now: Date,
): boolean {
  if (currentVersion <= 1 || !versionCreatedAt) return false;
  const age = now.getTime() - versionCreatedAt.getTime();
  return age >= -60_000 && age <= UPDATED_WINDOW_DAYS * DAY_MS;
}

// ── Pending cards (one load per org per digest run) ───────────────────────

export interface OrgCard {
  row: ProposalRow;
  live: CuratorTarget;
}

/** The org's due, pending cards whose target still exists. */
export async function loadPendingCards(orgId: string, now: Date): Promise<OrgCard[]> {
  const rows = await prisma.knowledgeProposal.findMany({
    where: { orgId, status: 'pending', availableAt: { lte: now } },
    orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
    take: 500,
  });
  const out: OrgCard[] = [];
  for (const row of rows) {
    const live = await loadTarget(prisma, row.targetType as TargetType, row.targetId, row.orgId);
    if (live) out.push({ row, live });
  }
  return out;
}

/** The cards one person may review, as digest input. */
export function cardsFor(actor: KnowledgeActor, cards: OrgCard[]): WaitingCard[] {
  return cards
    .filter((c) => canReview(actor, c.row, c.live))
    .map((c) => ({
      id: c.row.id,
      targetType: c.row.targetType,
      targetId: c.row.targetId,
      targetName: c.live.name,
      availableAt: c.row.availableAt,
      remindedAt: c.row.remindedAt,
    }));
}

/** Records that the reminder went out. Only un-reminded rows are touched. */
export async function markReminded(ids: string[], now: Date): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await prisma.knowledgeProposal.updateMany({
    where: { id: { in: ids }, remindedAt: null },
    data: { remindedAt: now },
  });
  return res.count;
}

// ── Member impact ─────────────────────────────────────────────────────────

/**
 * How many distinct items the caller's signals helped fix (approved or
 * edited cards) in the last `days` days. Counts only — no names, no links.
 */
export async function getMyImpact(
  actor: KnowledgeActor,
  opts: { days?: number; now?: Date } = {},
): Promise<KnowledgeMyImpact> {
  const days = opts.days ?? 7;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - days * DAY_MS);
  if (!actor.orgId) return { count: 0, days, since: since.toISOString() };
  const rows = await prisma.knowledgeProposal.findMany({
    where: {
      orgId: actor.orgId,
      status: { in: ['approved', 'edited'] },
      reviewedAt: { gte: since, lte: now },
      signals: { some: { userId: actor.userId, orgId: actor.orgId } },
    },
    select: { targetType: true, targetId: true },
  });
  const count = new Set(rows.map((r) => `${r.targetType}:${r.targetId}`)).size;
  return { count, days, since: since.toISOString() };
}

// ── Admin summary ─────────────────────────────────────────────────────────

const MAX_EXAMPLES = 5;

/**
 * Pure: group org/team items into areas with nobody to own them.
 *   - a team item with no explicit owner, in a team with no team lead
 *     (it falls back to admins only) → `team_no_lead`, one area per team;
 *   - an org item with no explicit owner when the org has no admin → `no_admin`;
 *   - any item whose explicit owner is no longer in the org → `owner_left`.
 */
export function findUnownedAreas(input: {
  items: Array<{
    type: TargetType;
    id: string;
    name: string;
    /** org | team */
    scope: string;
    teamId: string | null;
    ownerId: string | null;
  }>;
  orgUserIds: Set<string>;
  teamsWithLead: Set<string>;
  teamNames: Map<string, string>;
  adminCount: number;
}): KnowledgeUnownedArea[] {
  const areas = new Map<string, KnowledgeUnownedArea>();
  const add = (
    key: string,
    base: Omit<KnowledgeUnownedArea, 'memory' | 'routines' | 'items'>,
    item: { type: TargetType; id: string; name: string },
  ) => {
    let a = areas.get(key);
    if (!a) {
      a = { ...base, memory: 0, routines: 0, items: [] };
      areas.set(key, a);
    }
    if (item.type === 'memory') a.memory += 1;
    else a.routines += 1;
    if (a.items.length < MAX_EXAMPLES) a.items.push(item);
  };
  for (const it of input.items) {
    const item = { type: it.type, id: it.id, name: it.name };
    if (it.ownerId) {
      if (!input.orgUserIds.has(it.ownerId)) {
        add('owner_left', { reason: 'owner_left', teamId: null, teamName: null }, item);
      }
      continue;
    }
    if (it.scope === 'team' && it.teamId && !input.teamsWithLead.has(it.teamId)) {
      add(
        `team:${it.teamId}`,
        {
          reason: 'team_no_lead',
          teamId: it.teamId,
          teamName: input.teamNames.get(it.teamId) ?? null,
        },
        item,
      );
    } else if (it.scope === 'org' && input.adminCount === 0) {
      add('no_admin', { reason: 'no_admin', teamId: null, teamName: null }, item);
    }
  }
  const order = { owner_left: 0, team_no_lead: 1, no_admin: 2 } as const;
  return Array.from(areas.values()).sort(
    (a, b) =>
      order[a.reason] - order[b.reason] || (a.teamName ?? '').localeCompare(b.teamName ?? ''),
  );
}

export async function getAdminSummary(
  orgId: string,
  opts: { days?: number; now?: Date } = {},
): Promise<KnowledgeAdminSummary> {
  const days = opts.days ?? 7;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - days * DAY_MS);

  const decided = await prisma.knowledgeProposal.groupBy({
    by: ['status'],
    where: {
      orgId,
      status: { in: ['approved', 'edited', 'rejected'] },
      reviewedAt: { gte: since, lte: now },
    },
    _count: { _all: true },
  });
  const countOf = (s: string) => decided.find((d) => d.status === s)?._count._all ?? 0;

  const pending = await loadPendingCards(orgId, now);
  const oldest = pending.reduce<Date | null>(
    (min, c) => (!min || c.row.availableAt < min ? c.row.availableAt : min),
    null,
  );

  const users = await prisma.user.findMany({
    where: { team: { orgId } },
    select: { id: true, role: true, teamId: true },
  });
  const teams = await prisma.team.findMany({ where: { orgId }, select: { id: true, name: true } });
  const memories = await prisma.memoryEntry.findMany({
    where: {
      orgId,
      layer: { in: ['org', 'team'] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true, layer: true, teamId: true, ownerId: true, content: true },
    take: 5000,
  });
  const routines = await prisma.routine.findMany({
    where: { orgId, scope: { in: ['org', 'team'] } },
    select: { id: true, scope: true, teamId: true, ownerId: true, name: true },
    take: 5000,
  });

  const unowned = findUnownedAreas({
    items: [
      ...memories.map((m) => ({
        type: 'memory' as const,
        id: m.id,
        name: memoryTargetName(m.content, m.layer),
        scope: m.layer,
        teamId: m.teamId,
        ownerId: m.ownerId,
      })),
      ...routines.map((r) => ({
        type: 'routine' as const,
        id: r.id,
        name: r.name,
        scope: r.scope,
        teamId: r.teamId,
        ownerId: r.ownerId,
      })),
    ],
    orgUserIds: new Set(users.map((u) => u.id)),
    teamsWithLead: new Set(
      users.filter((u) => u.role === 'team_lead' && u.teamId).map((u) => u.teamId!),
    ),
    teamNames: new Map(teams.map((t) => [t.id, t.name])),
    adminCount: users.filter((u) => u.role === 'admin').length,
  });

  return {
    days,
    since: since.toISOString(),
    changed: {
      approved: countOf('approved'),
      edited: countOf('edited'),
      rejected: countOf('rejected'),
    },
    waiting: {
      pending: pending.length,
      oldestDays: oldest ? Math.floor((now.getTime() - oldest.getTime()) / DAY_MS) : null,
    },
    unowned,
  };
}

// ── "Updated" marker on chat sources ──────────────────────────────────────

export interface RecentChange {
  lastChangedAt: string;
  changeSource: KnowledgeChangeSource;
}

/**
 * For memory entries about to be cited: which ones changed in the last 7
 * days (their current version row is recent and is not the first version).
 */
export async function recentMemoryChanges(
  orgId: string,
  entries: Array<{ id: string; version: number }>,
  now = new Date(),
): Promise<Map<string, RecentChange>> {
  const out = new Map<string, RecentChange>();
  const candidates = entries.filter((e) => e.version > 1);
  if (candidates.length === 0) return out;
  const rows = await prisma.memoryVersion.findMany({
    where: {
      orgId,
      OR: candidates.map((e) => ({ memoryId: e.id, version: e.version })),
    },
    select: { memoryId: true, version: true, createdAt: true, changeSource: true },
  });
  for (const r of rows) {
    if (!isRecentlyUpdated(r.version, r.createdAt, now)) continue;
    out.set(r.memoryId, {
      lastChangedAt: r.createdAt.toISOString(),
      changeSource: r.changeSource as KnowledgeChangeSource,
    });
  }
  return out;
}
