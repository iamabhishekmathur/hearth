import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    decisionLink: { create: vi.fn() },
  },
}));
vi.mock('../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../ws/socket-manager.js', () => ({ emitToOrg: vi.fn() }));
vi.mock('./audit-service.js', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../llm/provider-registry.js', () => ({
  providerRegistry: { chatWithFallback: vi.fn() },
}));

import { prisma } from '../lib/prisma.js';
import { providerRegistry } from '../llm/provider-registry.js';
import { emitToOrg } from '../ws/socket-manager.js';
import { detectConflicts } from './decision-conflict-service.js';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function mockCandidates(rows: Array<{ id: string; title: string; reasoning?: string; similarity: number; domain?: string | null }>) {
  asMock(prisma.$queryRawUnsafe).mockResolvedValue(
    rows.map((r) => ({ reasoning: 'because', domain: null, ...r })),
  );
}

/** Make the LLM judge return the given JSON verbatim. */
function mockJudge(json: string) {
  async function* stream() {
    yield { type: 'text_delta' as const, content: json };
    yield { type: 'done' as const, usage: { input_tokens: 1, output_tokens: 1 } };
  }
  asMock(providerRegistry.chatWithFallback).mockReturnValue(stream());
}

const EMBED = [0.1, 0.2, 0.3];

beforeEach(() => {
  vi.clearAllMocks();
  asMock(prisma.decisionLink.create).mockResolvedValue({ id: 'link-1' });
});

describe('detectConflicts', () => {
  it('records a contradicts link + notifies when the LLM judges a conflict', async () => {
    mockCandidates([{ id: 'd-old', title: 'Move to DynamoDB', similarity: 0.88 }]);
    mockJudge('[{"id":"d-old","rationale":"Both pick a primary datastore; Postgres vs DynamoDB are incompatible."}]');

    const conflicts = await detectConflicts({
      decisionId: 'd-new',
      orgId: 'org-1',
      title: 'Standardize on Postgres',
      reasoning: 'We will use Postgres for all services.',
      domain: 'infra',
      embedding: EMBED,
      userId: 'u-1',
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].decisionId).toBe('d-old');
    expect(asMock(prisma.decisionLink.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromDecisionId: 'd-new',
          toDecisionId: 'd-old',
          relationship: 'contradicts',
        }),
      }),
    );
    expect(asMock(emitToOrg)).toHaveBeenCalledWith('org-1', 'decision:conflict', expect.anything());
  });

  it('does NOT flag merely-related decisions the LLM clears', async () => {
    mockCandidates([{ id: 'd-old', title: 'Add a read replica', similarity: 0.86 }]);
    mockJudge('[]'); // judged not a contradiction

    const conflicts = await detectConflicts({
      decisionId: 'd-new',
      orgId: 'org-1',
      title: 'Standardize on Postgres',
      reasoning: 'We will use Postgres for all services.',
      domain: 'infra',
      embedding: EMBED,
    });

    expect(conflicts).toHaveLength(0);
    expect(asMock(prisma.decisionLink.create)).not.toHaveBeenCalled();
    expect(asMock(emitToOrg)).not.toHaveBeenCalled();
  });

  it('judges a LEXICALLY-dissimilar same-domain contradiction (low embedding sim)', async () => {
    // "gRPC instead of REST" vs "Standardize on REST" embed at ~0.56 — below any
    // high floor, but within the same domain the LLM still gets to judge.
    mockCandidates([{ id: 'd-rest', title: 'Standardize on REST APIs', similarity: 0.56, domain: 'engineering' }]);
    mockJudge('[{"id":"d-rest","rationale":"gRPC explicitly replaces REST — incompatible API standards."}]');

    const conflicts = await detectConflicts({
      decisionId: 'd-grpc', orgId: 'org-1', title: 'Standardize on gRPC instead of REST',
      reasoning: 'Performance + typed contracts; replaces REST.', domain: 'engineering', embedding: EMBED,
    });

    expect(conflicts.map((c) => c.decisionId)).toEqual(['d-rest']);
  });

  it('scopes the candidate query to the decision domain (SQL-level filter)', async () => {
    mockCandidates([]);
    await detectConflicts({
      decisionId: 'd-new', orgId: 'org-1', title: 'x', reasoning: 'r', domain: 'infra', embedding: EMBED,
    });
    const call = asMock(prisma.$queryRawUnsafe).mock.calls[0];
    expect(String(call[0])).toContain('domain = $4');
    expect(call).toContain('infra'); // domain passed as a bound param
  });

  it('skips the LLM when an UNTAGGED decision has nothing in the higher no-domain band', async () => {
    // No domain → higher floor (0.75); a 0.42 look-alike is not a candidate.
    mockCandidates([{ id: 'd-far', title: 'Office snacks', similarity: 0.42 }]);

    const conflicts = await detectConflicts({
      decisionId: 'd-new', orgId: 'org-1', title: 'Standardize on Postgres', reasoning: 'r', embedding: EMBED,
    });

    expect(conflicts).toHaveLength(0);
    expect(asMock(providerRegistry.chatWithFallback)).not.toHaveBeenCalled();
  });

  it('is non-fatal: a provider failure yields no conflicts (never throws)', async () => {
    mockCandidates([{ id: 'd-old', title: 'Move to DynamoDB', similarity: 0.88 }]);
    asMock(providerRegistry.chatWithFallback).mockImplementation(() => {
      throw new Error('provider down');
    });

    const conflicts = await detectConflicts({
      decisionId: 'd-new',
      orgId: 'org-1',
      title: 'Standardize on Postgres',
      reasoning: 'r',
      embedding: EMBED,
    });

    expect(conflicts).toEqual([]);
  });

  it('drops hallucinated ids the LLM returns that were not candidates', async () => {
    mockCandidates([{ id: 'd-real', title: 'Move to DynamoDB', similarity: 0.88 }]);
    mockJudge('[{"id":"d-real","rationale":"ok"},{"id":"d-ghost","rationale":"not a candidate"}]');

    const conflicts = await detectConflicts({
      decisionId: 'd-new', orgId: 'org-1', title: 'Postgres', reasoning: 'r', domain: 'infra', embedding: EMBED,
    });

    expect(conflicts.map((c) => c.decisionId)).toEqual(['d-real']);
  });
});
