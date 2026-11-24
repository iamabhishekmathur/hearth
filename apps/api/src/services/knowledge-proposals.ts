/**
 * Knowledge loop, Phase 2 — the owners' Review inbox.
 *
 * Reads, approves and rejects curator proposals. Ownership is computed at
 * read time from the LIVE target (D9): an owner who moves team or loses a role
 * stops seeing the card, and the new owner starts seeing it. Anyone who is not
 * an owner gets "not found" — they cannot tell a card exists.
 *
 * Evidence privacy: a quote from a signal is shown only when the viewer can
 * open where it came from (their own signal, a chat session they can open, a
 * routine they can view). Otherwise the card says what happened ("A member
 * corrected an answer") with no quote and no link.
 */
import type { KnowledgeProposal as ProposalRow, KnowledgeSignal } from '@prisma/client';
import type {
  KnowledgeEvidenceItem,
  KnowledgeProposal,
  KnowledgeProposalAffected,
  KnowledgeProposalEvidence,
  KnowledgeProposalStatus,
} from '@hearth/shared';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { withTenantTx } from '../lib/tenant-context.js';
import type { KnowledgeActor } from './knowledge-owner.js';
import {
  isTargetOwner,
  loadTarget,
  type CuratorTarget,
  type TargetType,
} from './knowledge-curator.js';
import {
  VersionConflictError,
  updateMemoryVersioned,
  updateRoutineVersioned,
} from './knowledge-versions.js';
import { checkRoutinePermission } from './routine-service.js';
import { redactSignalText } from './knowledge-signals.js';
import { generateEmbedding } from './embedding-service.js';

export const PROPOSAL_STATUSES: KnowledgeProposalStatus[] = [
  'pending',
  'approved',
  'edited',
  'rejected',
  'superseded',
  'dropped',
];

// ── Ownership ─────────────────────────────────────────────────────────────

/** The live target when it exists; else the proposal's snapshot of it. */
function ownershipTarget(p: ProposalRow, live: CuratorTarget | null) {
  if (live) return live;
  return {
    type: p.targetType as TargetType,
    orgId: p.orgId,
    scope: p.targetScope,
    teamId: p.targetTeamId,
    userId: p.targetUserId,
    ownerId: null,
  };
}

export function canReview(
  actor: KnowledgeActor,
  p: ProposalRow,
  live: CuratorTarget | null,
): boolean {
  if (!actor.orgId || p.orgId !== actor.orgId) return false;
  return isTargetOwner(actor, ownershipTarget(p, live));
}

// ── Evidence ──────────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  empty_search: 'An agent searched and found nothing.',
  correction: 'A member corrected an answer.',
  thumbs_down: 'Someone marked an answer as unhelpful.',
  regenerate: 'Someone asked for a new answer.',
  edited_output: "An owner edited the routine's output before approving it.",
  run_failed: 'A routine run failed.',
};

export function evidenceLabel(kind: string, source: string): string {
  if (kind === 'empty_search' && source === 'routine') {
    return 'A routine run searched and found nothing.';
  }
  return KIND_LABEL[kind] ?? 'Something pointed to a gap.';
}

export interface EvidenceAccess {
  /** Session ids the viewer can open. */
  sessions: Set<string>;
  /** Routine ids the viewer can view. */
  routines: Set<string>;
}

type EvidenceSignal = Pick<
  KnowledgeSignal,
  'kind' | 'source' | 'createdAt' | 'text' | 'userId' | 'sessionId' | 'routineId' | 'routineRunId'
>;

/** Pure: what one viewer may see of a card's signals. */
export function buildEvidence(
  signals: EvidenceSignal[],
  viewerId: string,
  access: EvidenceAccess,
): KnowledgeProposalEvidence {
  const counts: Record<string, number> = {};
  const people = new Set<string>();
  const items: KnowledgeEvidenceItem[] = [];
  for (const s of signals) {
    counts[s.kind] = (counts[s.kind] ?? 0) + 1;
    if (s.userId) people.add(s.userId);

    let link: KnowledgeEvidenceItem['link'] = null;
    if (s.routineId && access.routines.has(s.routineId)) {
      link = { type: 'routine_run', routineId: s.routineId, runId: s.routineRunId ?? null };
    } else if (s.sessionId && access.sessions.has(s.sessionId)) {
      link = { type: 'session', sessionId: s.sessionId };
    }
    // A quote needs a source the viewer can open, or the viewer's own signal.
    const mayQuote = link !== null || (!!s.userId && s.userId === viewerId);
    items.push({
      kind: s.kind,
      source: s.source,
      createdAt: s.createdAt.toISOString(),
      label: evidenceLabel(s.kind, s.source),
      quote: mayQuote ? s.text : null,
      link,
    });
  }
  return { counts, people: people.size, items };
}

async function evidenceAccess(
  actor: KnowledgeActor,
  signals: EvidenceSignal[],
): Promise<EvidenceAccess> {
  const sessionIds = Array.from(
    new Set(signals.map((s) => s.sessionId).filter((x): x is string => !!x)),
  );
  const routineIds = Array.from(
    new Set(signals.map((s) => s.routineId).filter((x): x is string => !!x)),
  );
  const access: EvidenceAccess = { sessions: new Set(), routines: new Set() };
  if (sessionIds.length > 0) {
    const sessions = await prisma.chatSession.findMany({
      where: { id: { in: sessionIds }, orgId: actor.orgId ?? '' },
      select: {
        id: true,
        userId: true,
        visibility: true,
        collaborators: { select: { userId: true } },
      },
    });
    for (const s of sessions) {
      const open =
        s.userId === actor.userId ||
        s.visibility === 'org' ||
        s.collaborators.some((c) => c.userId === actor.userId);
      if (open) access.sessions.add(s.id);
    }
  }
  if (routineIds.length > 0) {
    const routines = await prisma.routine.findMany({
      where: { id: { in: routineIds } },
      select: { id: true, userId: true, scope: true, teamId: true, orgId: true },
    });
    for (const r of routines) {
      if (r.orgId && r.orgId !== actor.orgId) continue;
      if (checkRoutinePermission(r, actor, 'view')) access.routines.add(r.id);
    }
  }
  return access;
}

// ── Serialization ─────────────────────────────────────────────────────────

async function ownerLabel(p: ProposalRow, live: CuratorTarget | null): Promise<string> {
  const t = ownershipTarget(p, live);
  let base: string;
  if (t.scope === 'org') base = 'Admins';
  else if (t.scope === 'team') {
    const team = t.teamId
      ? await prisma.team.findUnique({ where: { id: t.teamId }, select: { name: true } })
      : null;
    base = `${team?.name ?? 'Team'} leads and admins`;
  } else {
    const u = t.userId
      ? await prisma.user.findUnique({ where: { id: t.userId }, select: { name: true } })
      : null;
    base = u?.name ?? 'Its owner';
  }
  if (t.ownerId && t.ownerId !== t.userId) {
    const o = await prisma.user.findUnique({ where: { id: t.ownerId }, select: { name: true } });
    if (o?.name) base = `${o.name} · ${base}`;
  }
  return base;
}

async function serialize(
  actor: KnowledgeActor,
  p: ProposalRow,
  live: CuratorTarget | null,
): Promise<KnowledgeProposal> {
  const signals = await prisma.knowledgeSignal.findMany({
    where: { proposalId: p.id, orgId: p.orgId },
    orderBy: { createdAt: 'asc' },
    select: {
      kind: true,
      source: true,
      createdAt: true,
      text: true,
      userId: true,
      sessionId: true,
      routineId: true,
      routineRunId: true,
    },
  });
  const access = await evidenceAccess(actor, signals);
  return {
    id: p.id,
    targetType: p.targetType as TargetType,
    targetId: p.targetId,
    targetName: live?.name ?? p.targetName,
    ownerLabel: await ownerLabel(p, live),
    targetVersion: p.targetVersion,
    before: p.before,
    after: p.after,
    reason: p.reason,
    affected: (p.affected ?? { audience: 'org' }) as unknown as KnowledgeProposalAffected,
    status: p.status as KnowledgeProposalStatus,
    availableAt: p.availableAt.toISOString(),
    reviewedById: p.reviewedById,
    reviewedAt: p.reviewedAt?.toISOString() ?? null,
    rejectReason: p.rejectReason,
    editedAfter: p.editedAfter,
    resultVersion: p.resultVersion,
    createdAt: p.createdAt.toISOString(),
    evidence: buildEvidence(signals, actor.userId, access),
  };
}

// ── Reads ─────────────────────────────────────────────────────────────────

/** The caller's cards: they own the target and the card is due. */
export async function listProposals(
  actor: KnowledgeActor,
  opts: { status?: KnowledgeProposalStatus | 'all'; now?: Date } = {},
): Promise<KnowledgeProposal[]> {
  if (!actor.orgId) return [];
  const now = opts.now ?? new Date();
  const status = opts.status ?? 'pending';
  const rows = await prisma.knowledgeProposal.findMany({
    where: {
      orgId: actor.orgId,
      availableAt: { lte: now },
      ...(status === 'all' ? {} : { status }),
    },
    orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
    take: 200,
  });
  const out: KnowledgeProposal[] = [];
  for (const p of rows) {
    const live = await loadTarget(prisma, p.targetType as TargetType, p.targetId, p.orgId);
    // A pending card whose target is gone is not actionable.
    if (!live && p.status === 'pending') continue;
    if (!canReview(actor, p, live)) continue;
    out.push(await serialize(actor, p, live));
  }
  return out;
}

/** One card the caller may review, or null (not found, other org, not an owner, not due). */
export async function getProposalForActor(
  actor: KnowledgeActor,
  id: string,
  now = new Date(),
): Promise<{ row: ProposalRow; live: CuratorTarget | null } | null> {
  if (!actor.orgId) return null;
  const row = await prisma.knowledgeProposal.findFirst({ where: { id, orgId: actor.orgId } });
  if (!row || row.availableAt.getTime() > now.getTime()) return null;
  const live = await loadTarget(prisma, row.targetType as TargetType, row.targetId, row.orgId);
  if (!canReview(actor, row, live)) return null;
  return { row, live };
}

export async function getProposal(
  actor: KnowledgeActor,
  id: string,
): Promise<KnowledgeProposal | null> {
  const found = await getProposalForActor(actor, id);
  return found ? serialize(actor, found.row, found.live) : null;
}

// ── Decisions ─────────────────────────────────────────────────────────────

export type DecisionResult =
  | { status: 'ok'; proposal: KnowledgeProposal; resultVersion: number | null }
  | { status: 'not_found' }
  | { status: 'already_decided'; current: KnowledgeProposalStatus }
  | { status: 'target_gone' }
  | { status: 'conflict'; currentVersion: number; currentContent: string | null };

class AlreadyDecided extends Error {}
class TargetGone extends Error {}

/** Re-embed a memory entry after its content changed. Fire-and-forget. */
function reembed(entryId: string, content: string): void {
  generateEmbedding(content)
    .then(async (embedding) => {
      if (!embedding) return;
      await withTenantTx((tx) =>
        tx.$executeRawUnsafe(
          `UPDATE memory_entries SET embedding = $1::vector WHERE id = $2`,
          `[${embedding.join(',')}]`,
          entryId,
        ),
      );
    })
    .catch((err) =>
      logger.warn({ errName: (err as Error)?.name }, 'Re-embed after approval failed'),
    );
}

/**
 * Approves a card (optionally with the owner's edited text). The claim on the
 * card and the change to the target happen in ONE transaction:
 *   - a card no longer pending → already_decided (D7); two owners at once →
 *     the second waits on the row lock and then sees it decided (D8);
 *   - the target moved past the version the card was made for → conflict
 *     with the current text (D5), and the card stays pending.
 */
export async function approveProposal(
  actor: KnowledgeActor,
  id: string,
  body: { after?: string; baseVersion?: number },
): Promise<DecisionResult> {
  const found = await getProposalForActor(actor, id);
  if (!found) return { status: 'not_found' };
  const { row } = found;
  if (row.status !== 'pending') {
    return { status: 'already_decided', current: row.status as KnowledgeProposalStatus };
  }
  if (!found.live) {
    await prisma.knowledgeProposal.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'dropped' },
    });
    return { status: 'target_gone' };
  }

  const after = (body.after ?? row.after).trim();
  const edited = body.after !== undefined && after !== row.after.trim();
  const expectedVersion = body.baseVersion ?? row.targetVersion;
  const meta = { changeSource: 'curator' as const, changedById: actor.userId };

  try {
    const resultVersion = await withTenantTx(async (tx) => {
      const claim = await tx.knowledgeProposal.updateMany({
        where: { id, orgId: actor.orgId!, status: 'pending' },
        data: {
          status: edited ? 'edited' : 'approved',
          reviewedById: actor.userId,
          reviewedAt: new Date(),
          editedAfter: edited ? after : null,
        },
      });
      if (claim.count === 0) throw new AlreadyDecided();
      const updated =
        row.targetType === 'memory'
          ? await updateMemoryVersioned(row.targetId, { content: after }, meta, expectedVersion, tx)
          : await updateRoutineVersioned(
              row.targetId,
              { prompt: after },
              meta,
              expectedVersion,
              tx,
            );
      if (!updated) throw new TargetGone();
      await tx.knowledgeProposal.update({
        where: { id },
        data: { resultVersion: updated.version },
      });
      return updated.version;
    });
    if (row.targetType === 'memory') reembed(row.targetId, after);
    const fresh = await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id } });
    const live = await loadTarget(prisma, row.targetType as TargetType, row.targetId, row.orgId);
    return { status: 'ok', proposal: await serialize(actor, fresh, live), resultVersion };
  } catch (err) {
    if (err instanceof AlreadyDecided) {
      const now = await prisma.knowledgeProposal.findUnique({
        where: { id },
        select: { status: true },
      });
      return {
        status: 'already_decided',
        current: (now?.status ?? 'pending') as KnowledgeProposalStatus,
      };
    }
    if (err instanceof TargetGone) {
      await prisma.knowledgeProposal.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'dropped' },
      });
      return { status: 'target_gone' };
    }
    if (err instanceof VersionConflictError) {
      const live = await loadTarget(prisma, row.targetType as TargetType, row.targetId, row.orgId);
      return {
        status: 'conflict',
        currentVersion: err.currentVersion,
        currentContent: live?.content ?? null,
      };
    }
    throw err;
  }
}

export async function rejectProposal(
  actor: KnowledgeActor,
  id: string,
  reason: string | undefined,
): Promise<DecisionResult> {
  const found = await getProposalForActor(actor, id);
  if (!found) return { status: 'not_found' };
  if (found.row.status !== 'pending') {
    return { status: 'already_decided', current: found.row.status as KnowledgeProposalStatus };
  }
  const res = await prisma.knowledgeProposal.updateMany({
    where: { id, orgId: actor.orgId!, status: 'pending' },
    data: {
      status: 'rejected',
      reviewedById: actor.userId,
      reviewedAt: new Date(),
      // The reason reaches the curator's prompt (fenced as data); strip secrets.
      rejectReason: reason?.trim() ? redactSignalText(reason, 500) : null,
    },
  });
  if (res.count === 0) {
    const now = await prisma.knowledgeProposal.findUnique({
      where: { id },
      select: { status: true },
    });
    return {
      status: 'already_decided',
      current: (now?.status ?? 'pending') as KnowledgeProposalStatus,
    };
  }
  const fresh = await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id } });
  return { status: 'ok', proposal: await serialize(actor, fresh, found.live), resultVersion: null };
}
