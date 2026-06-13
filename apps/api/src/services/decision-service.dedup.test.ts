import { describe, it, expect, vi, beforeEach } from 'vitest';

// Focused on the dedup-transparency behavior of createDecision: a near-duplicate
// (>0.90 similarity) is merged into the existing decision and the return carries
// `deduped: true`, so the route can answer 200 instead of a silent 201.

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    decision: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    decisionLink: { create: vi.fn() },
  },
}));
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('./embedding-service.js', () => ({ generateEmbedding: vi.fn() }));
vi.mock('./audit-service.js', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../ws/socket-manager.js', () => ({ emitToOrg: vi.fn() }));
vi.mock('./decision-conflict-service.js', () => ({ detectConflicts: vi.fn().mockResolvedValue([]) }));

import { prisma } from '../lib/prisma.js';
import { generateEmbedding } from './embedding-service.js';
import { createDecision } from './decision-service.js';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const SCOPE = { orgId: 'org-1', userId: 'u-1', teamId: null, role: 'member' as const };

function existingRow() {
  return {
    id: 'd-existing', orgId: 'org-1', teamId: null, createdById: 'u-1', sessionId: null,
    title: 'Adopt Postgres', description: null, reasoning: 'r', alternatives: [], domain: 'infra',
    tags: [], scope: 'org', status: 'active', confidence: 'high', source: 'manual', sourceRef: null,
    sensitivity: 'normal', participants: [], contextSnapshot: null, quality: 0.5, importance: 0.5,
    supersededById: null, createdAt: new Date('2026-06-01'), updatedAt: new Date('2026-06-01'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);
});

describe('createDecision — transparent dedup', () => {
  it('a near-duplicate (>0.90) returns the existing decision with deduped:true', async () => {
    asMock(prisma.$queryRawUnsafe).mockResolvedValue([
      { id: 'd-existing', similarity: 0.95, domain: 'infra', participants: [] },
    ]);
    asMock(prisma.decision.findUnique).mockResolvedValue(existingRow());

    const result = await createDecision(SCOPE, { title: 'Adopt PostgreSQL', reasoning: 'same call', domain: 'infra' });

    expect(result.id).toBe('d-existing');
    expect(result.deduped).toBe(true);
    // It must NOT have created a new row when merging.
    expect(asMock(prisma.decision.create)).not.toHaveBeenCalled();
  });

  it('a novel decision is created fresh (no deduped flag)', async () => {
    asMock(prisma.$queryRawUnsafe).mockResolvedValue([]); // nothing similar
    asMock(prisma.decision.findFirst).mockResolvedValue(null); // no session/race collision
    asMock(prisma.decision.create).mockResolvedValue({ ...existingRow(), id: 'd-new', title: 'Brand new' });

    const result = await createDecision(SCOPE, { title: 'Brand new', reasoning: 'novel', domain: 'infra' });

    expect(result.id).toBe('d-new');
    expect(result.deduped).toBeUndefined();
    expect(asMock(prisma.decision.create)).toHaveBeenCalled();
  });
});

// The real onboarding bug: two producers (agent capture_decision tool + the
// background chat→decision-extraction worker) fire for ONE real decision in a
// session and create two rows. Both pass `sessionId`. createDecision must
// converge to one — deterministically, even when phrasings differ and the
// embedding-similarity path can't see the racing row (NULL embedding window).
describe('createDecision — session-scoped dedup (the duplicate-capture bug)', () => {
  const SESSION = 'sess-abc';

  it('skips inserting when the session already produced a decision (pre-insert)', async () => {
    // Pre-insert session check finds an existing decision for this session.
    asMock(prisma.decision.findFirst).mockResolvedValue({ ...existingRow(), sessionId: SESSION });

    const result = await createDecision(SCOPE, {
      title: 'Adopted Postgres for the new events store',
      reasoning: 'second producer, same session',
      domain: 'infra',
      sourceRef: { sessionId: SESSION },
      sessionId: SESSION,
    });

    expect(result.deduped).toBe(true);
    expect(result.id).toBe('d-existing');
    // The second producer must NOT insert a duplicate row.
    expect(asMock(prisma.decision.create)).not.toHaveBeenCalled();
    // It also short-circuits before the embedding-similarity query.
    expect(asMock(prisma.$queryRawUnsafe)).not.toHaveBeenCalled();
  });

  it('archives its own insert if it loses the race (post-insert reconcile)', async () => {
    // Pre-insert check: clear (both producers raced past it).
    // Post-insert reconcile: an OLDER row for the session now exists → we lost.
    asMock(prisma.decision.findFirst)
      .mockResolvedValueOnce(null) // pre-insert: nothing yet
      .mockResolvedValueOnce({ ...existingRow(), id: 'd-winner', sessionId: SESSION }); // reconcile: winner exists
    asMock(prisma.$queryRawUnsafe).mockResolvedValue([]); // no embedding dup
    asMock(prisma.decision.create).mockResolvedValue({
      ...existingRow(), id: 'd-loser', sessionId: SESSION, createdAt: new Date('2026-06-02'),
    });
    asMock(prisma.decision.updateMany).mockResolvedValue({ count: 1 });

    const result = await createDecision(SCOPE, {
      title: 'Adopted Postgres for the new events store',
      reasoning: 'racing producer',
      domain: 'infra',
      sourceRef: { sessionId: SESSION },
      sessionId: SESSION,
    });

    // Converges to the winner, flagged deduped, and archives the loser row.
    expect(result.id).toBe('d-winner');
    expect(result.deduped).toBe(true);
    expect(asMock(prisma.decision.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'archived' } }),
    );
  });

  it('a genuinely first decision in a session is created normally', async () => {
    asMock(prisma.decision.findFirst).mockResolvedValue(null); // pre-insert + reconcile both clear
    asMock(prisma.$queryRawUnsafe).mockResolvedValue([]);
    asMock(prisma.decision.create).mockResolvedValue({ ...existingRow(), id: 'd-first', sessionId: SESSION });

    const result = await createDecision(SCOPE, {
      title: 'Adopted Postgres for the new events store',
      reasoning: 'first and only producer so far',
      domain: 'infra',
      sourceRef: { sessionId: SESSION },
      sessionId: SESSION,
    });

    expect(result.id).toBe('d-first');
    expect(result.deduped).toBeUndefined();
    expect(asMock(prisma.decision.create)).toHaveBeenCalled();
  });
});
