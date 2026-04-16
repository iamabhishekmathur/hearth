import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    task: { findMany: vi.fn() },
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./embedding-service.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(null), // Default: no embeddings
}));

import { prisma } from '../lib/prisma.js';
import { generateEmbedding } from './embedding-service.js';
import { checkDuplicate } from './intake-deduplicator.js';

const mockGenerateEmbedding = generateEmbedding as ReturnType<typeof vi.fn>;

describe('intake-deduplicator', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns true when a similar task exists (Jaccard fallback)', async () => {
    mockGenerateEmbedding.mockResolvedValue(null);
    (prisma.task.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 't1',
        title: 'Fix the authentication bug in the login page',
        description: null,
      },
    ]);

    // Same words, slightly different phrasing
    const result = await checkDuplicate(
      'u1',
      'Fix the authentication bug on the login page',
    );
    expect(result).toBe(true);
  });

  it('returns true when embeddings detect similarity', async () => {
    // Two nearly identical vectors
    const vec = Array.from({ length: 10 }, () => Math.random());
    const similar = vec.map((v) => v + 0.001); // tiny perturbation → cosine ~1.0
    mockGenerateEmbedding
      .mockResolvedValueOnce(vec)     // incoming text
      .mockResolvedValueOnce(similar); // existing task

    (prisma.task.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 't1', title: 'Deploy to production', description: null },
    ]);

    const result = await checkDuplicate('u1', 'Completely different text');
    expect(result).toBe(true);
  });

  it('returns false when no similar task exists', async () => {
    mockGenerateEmbedding.mockResolvedValue(null);
    (prisma.task.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 't1', title: 'Deploy to production', description: null },
    ]);

    const result = await checkDuplicate(
      'u1',
      'Fix the authentication bug in login page',
    );
    expect(result).toBe(false);
  });

  it('returns false when no tasks exist', async () => {
    (prisma.task.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await checkDuplicate('u1', 'Any message');
    expect(result).toBe(false);
  });
});
