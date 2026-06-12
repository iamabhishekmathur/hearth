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
