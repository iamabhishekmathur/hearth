import { describe, it, expect, vi, beforeEach } from 'vitest';

// Focused on the dedup-transparency behavior of createDecision: a near-duplicate
// (>0.90 similarity) is merged into the existing decision and the return carries
// `deduped: true`, so the route can answer 200 instead of a silent 201.

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    decision: { findUnique: vi.fn(), create: vi.fn() },
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
    asMock(prisma.decision.create).mockResolvedValue({ ...existingRow(), id: 'd-new', title: 'Brand new' });

    const result = await createDecision(SCOPE, { title: 'Brand new', reasoning: 'novel', domain: 'infra' });

    expect(result.id).toBe('d-new');
    expect(result.deduped).toBeUndefined();
    expect(asMock(prisma.decision.create)).toHaveBeenCalled();
  });
});
