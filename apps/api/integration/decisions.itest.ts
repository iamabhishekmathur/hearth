/**
 * Decision search integration tests.
 *
 * Regression guard for the pgvector deserialization bug: searchDecisions built
 * its raw SQL with `SELECT d.*`, which includes the `embedding vector` column.
 * prisma.$queryRawUnsafe cannot deserialize the `vector` type, so the query
 * threw "Failed to deserialize column of type 'vector'" the moment any matched
 * row had a non-null embedding. Seed-only data has NULL embeddings (which
 * deserialize fine), so the bug stayed hidden until real, embedded decisions
 * existed — at which point "what did we decide about X?" started erroring.
 *
 * These tests seed a decision WITH an embedding and assert the search returns
 * it instead of throwing. A NULL-embedding decision is included too, to prove
 * mixed result sets still work.
 */
import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import {
  prisma,
  seedAuthFixture,
  loginAgent,
  truncateAll,
  disconnect,
  type AuthFixture,
} from './setup.js';
import { searchDecisions } from '../src/services/decision-service.js';

let fx: AuthFixture;

// pgvector column is unbounded here, but a real OpenAI embedding (if a provider
// is registered) is 1536-d and the `<=>` operator requires matching dimensions —
// so seed at 1536 so the test is robust whether the vector or FTS branch runs.
const seededEmbedding = `[${Array(1536).fill(0.1).join(',')}]`;

async function seedDecision(opts: {
  title: string;
  reasoning: string;
  withEmbedding: boolean;
}): Promise<string> {
  const d = await prisma.decision.create({
    data: {
      orgId: fx.primary.orgId,
      teamId: fx.primary.teamId,
      createdById: fx.users.admin.id,
      title: opts.title,
      reasoning: opts.reasoning,
      scope: 'org',
      status: 'active',
      sensitivity: 'normal',
    },
  });
  if (opts.withEmbedding) {
    await prisma.$executeRawUnsafe(
      `UPDATE decisions SET embedding = $1::vector WHERE id = $2`,
      seededEmbedding,
      d.id,
    );
  }
  return d.id;
}

beforeEach(async () => {
  await truncateAll();
  fx = await seedAuthFixture();
});

afterAll(disconnect);

describe('searchDecisions — pgvector deserialization regression', () => {
  const scope = () => ({
    orgId: fx.primary.orgId,
    userId: fx.users.admin.id,
    teamId: fx.primary.teamId,
    role: 'admin' as const,
  });

  it('returns a decision that has a non-null embedding (does not throw on the vector column)', async () => {
    const id = await seedDecision({
      title: 'Adopt PostgreSQL for the event store',
      reasoning: 'Strong consistency and the team is already deep in SQL.',
      withEmbedding: true,
    });

    const result = await searchDecisions(scope(), { query: 'PostgreSQL event store', limit: 5 });

    expect(result.decisions.map((d) => d.id)).toContain(id);
    // The embedding column must never leak into the formatted result.
    expect(result.decisions[0]).not.toHaveProperty('embedding');
  });

  it('handles a mixed result set of embedded and non-embedded decisions', async () => {
    const withEmb = await seedDecision({
      title: 'Move the nightly export to a queue-backed job',
      reasoning: 'Repeated paging on the nightly export job; add retries.',
      withEmbedding: true,
    });
    const noEmb = await seedDecision({
      title: 'Move the nightly export off cron',
      reasoning: 'Cron-based nightly export keeps failing silently.',
      withEmbedding: false,
    });

    const result = await searchDecisions(scope(), { query: 'nightly export', limit: 10 });

    const ids = result.decisions.map((d) => d.id);
    expect(ids).toContain(withEmb);
    expect(ids).toContain(noEmb);
  });
});

describe('decision conflicts — GET /:id/conflicts', () => {
  /** Seed two decisions and a `contradicts` link between them (new → old). */
  async function seedConflict(): Promise<{ newId: string; oldId: string }> {
    const oldId = await seedDecision({
      title: 'Move the datastore to DynamoDB',
      reasoning: 'Single-digit-ms reads at scale.',
      withEmbedding: false,
    });
    const newId = await seedDecision({
      title: 'Standardize on PostgreSQL everywhere',
      reasoning: 'One datastore to operate; strong consistency.',
      withEmbedding: false,
    });
    await prisma.decisionLink.create({
      data: {
        fromDecisionId: newId,
        toDecisionId: oldId,
        relationship: 'contradicts',
        description: 'Both choose the primary datastore; Postgres vs DynamoDB cannot both hold.',
      },
    });
    return { newId, oldId };
  }

  it('lists the contradicting decision from the new side (outgoing) with rationale', async () => {
    const { newId, oldId } = await seedConflict();
    const admin = await loginAgent('admin');
    const res = await admin.get(`/api/v1/decisions/${newId}/conflicts`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].decision.id).toBe(oldId);
    expect(res.body.data[0].direction).toBe('outgoing');
    expect(res.body.data[0].rationale).toContain('cannot both hold');
  });

  it('lists the conflict from the old side too (incoming)', async () => {
    const { newId, oldId } = await seedConflict();
    const admin = await loginAgent('admin');
    const res = await admin.get(`/api/v1/decisions/${oldId}/conflicts`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].decision.id).toBe(newId);
    expect(res.body.data[0].direction).toBe('incoming');
  });

  it('a rival-org user cannot read another org\'s decision conflicts (404)', async () => {
    const { newId } = await seedConflict();
    const rival = await loginAgent('rival');
    const res = await rival.get(`/api/v1/decisions/${newId}/conflicts`);
    expect(res.status).toBe(404);
  });

  it('returns an empty list for a decision with no conflicts', async () => {
    const id = await seedDecision({ title: 'Pick a logo font', reasoning: 'brand', withEmbedding: false });
    const admin = await loginAgent('admin');
    const res = await admin.get(`/api/v1/decisions/${id}/conflicts`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
