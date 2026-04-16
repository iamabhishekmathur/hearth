import { describe, it, expect } from 'vitest';
import { mergeRRF } from './rrf.js';

describe('mergeRRF', () => {
  it('returns empty array when both lists are empty', () => {
    expect(mergeRRF([], [], 10)).toEqual([]);
  });

  it('returns items from a single list', () => {
    const listA = [
      { id: 'a', rank: 1.0 },
      { id: 'b', rank: 0.8 },
    ];
    const result = mergeRRF(listA, [], 10);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('b');
  });

  it('boosts items that appear in both lists', () => {
    const listA = [
      { id: 'a', rank: 1.0 },
      { id: 'b', rank: 0.8 },
    ];
    const listB = [
      { id: 'b', rank: 1.0 },
      { id: 'c', rank: 0.8 },
    ];
    const result = mergeRRF(listA, listB, 10);
    // 'b' appears in both lists so should have the highest combined RRF score
    expect(result[0].id).toBe('b');
  });

  it('respects the limit parameter', () => {
    const listA = [
      { id: 'a', rank: 1.0 },
      { id: 'b', rank: 0.9 },
      { id: 'c', rank: 0.8 },
    ];
    const result = mergeRRF(listA, [], 2);
    expect(result).toHaveLength(2);
  });

  it('assigns higher score to earlier items', () => {
    const listA = [
      { id: 'first', rank: 1.0 },
      { id: 'second', rank: 0.5 },
    ];
    const result = mergeRRF(listA, [], 10);
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it('handles duplicate IDs within a single list by keeping the first occurrence', () => {
    const listA = [
      { id: 'a', rank: 1.0 },
      { id: 'a', rank: 0.5 },
    ];
    const result = mergeRRF(listA, [], 10);
    // Both positions contribute to the same ID's score
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });
});
