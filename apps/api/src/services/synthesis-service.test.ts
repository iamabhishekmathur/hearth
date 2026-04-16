import { describe, it, expect } from 'vitest';

// Unit test for deduplication threshold logic

describe('Synthesis — dedup threshold', () => {
  const DEDUP_THRESHOLD = 0.95;

  it('skips entries with similarity > 0.95', () => {
    const similar = [{ id: '1', similarity: 0.97 }];
    const shouldSkip = similar.length > 0 && similar[0].similarity > DEDUP_THRESHOLD;
    expect(shouldSkip).toBe(true);
  });

  it('allows entries with similarity < 0.95', () => {
    const similar = [{ id: '1', similarity: 0.80 }];
    const shouldSkip = similar.length > 0 && similar[0].similarity > DEDUP_THRESHOLD;
    expect(shouldSkip).toBe(false);
  });

  it('allows entries with similarity exactly 0.95', () => {
    const similar = [{ id: '1', similarity: 0.95 }];
    const shouldSkip = similar.length > 0 && similar[0].similarity > DEDUP_THRESHOLD;
    expect(shouldSkip).toBe(false);
  });

  it('allows when no similar entries found', () => {
    const similar: Array<{ id: string; similarity: number }> = [];
    const shouldSkip = similar.length > 0 && similar[0].similarity > DEDUP_THRESHOLD;
    expect(shouldSkip).toBe(false);
  });
});

describe('Synthesis — batch concurrency limiter', () => {
  async function batchWithConcurrency<T>(
    items: T[],
    fn: (item: T) => Promise<void>,
    concurrency: number,
  ): Promise<void> {
    let index = 0;
    async function runNext(): Promise<void> {
      while (index < items.length) {
        const i = index++;
        await fn(items[i]);
      }
    }
    const workers = Array.from(
      { length: Math.min(concurrency, items.length) },
      () => runNext(),
    );
    await Promise.all(workers);
  }

  it('processes all items', async () => {
    const processed: number[] = [];
    await batchWithConcurrency(
      [1, 2, 3, 4, 5],
      async (n) => { processed.push(n); },
      2,
    );
    expect(processed).toHaveLength(5);
    expect(processed.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('respects concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    await batchWithConcurrency(
      [1, 2, 3, 4, 5, 6],
      async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
      },
      3,
    );

    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  it('handles empty input', async () => {
    const processed: number[] = [];
    await batchWithConcurrency([], async (n: number) => { processed.push(n); }, 5);
    expect(processed).toHaveLength(0);
  });

  it('handles concurrency larger than items', async () => {
    const processed: number[] = [];
    await batchWithConcurrency(
      [1, 2],
      async (n) => { processed.push(n); },
      10,
    );
    expect(processed).toHaveLength(2);
  });
});
