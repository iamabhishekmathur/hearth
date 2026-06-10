// @vitest-environment node
// (jsdom is configured in vitest.config.ts but not installed; these are pure functions.)
import { describe, it, expect } from 'vitest';
import { authorColor, authorInitials } from '../author-color';

const PALETTE_FILLS = [
  '#E76F51',
  '#2A9D8F',
  '#264653',
  '#8E44AD',
  '#3D5A80',
  '#B5651D',
  '#1B998B',
  '#6A4C93',
];

describe('authorColor', () => {
  it('is deterministic for the same user id', () => {
    const a = authorColor('user_abc123');
    const b = authorColor('user_abc123');
    expect(a).toEqual(b);
  });

  it('always returns a color from the curated palette', () => {
    const ids = [
      'user_1',
      'user_2',
      'usr_cmb9b2xkw0001',
      'a',
      '',
      'Ωμέγα-user',
      'a-very-long-user-identifier-with-lots-of-entropy-0123456789',
    ];
    for (const id of ids) {
      const color = authorColor(id);
      expect(PALETTE_FILLS).toContain(color.fill);
      expect(color.text).toBe('#FFFFFF');
    }
  });

  it('handles the empty string without throwing', () => {
    expect(() => authorColor('')).not.toThrow();
    expect(authorColor('')).toEqual(authorColor(''));
  });

  it('distributes a realistic id set across more than one palette slot', () => {
    const fills = new Set(Array.from({ length: 50 }, (_, i) => authorColor(`user_${i}`).fill));
    expect(fills.size).toBeGreaterThan(1);
  });
});

describe('authorInitials', () => {
  it('returns ? for empty or whitespace-only names', () => {
    expect(authorInitials('')).toBe('?');
    expect(authorInitials('   ')).toBe('?');
  });

  it('returns a single uppercase initial for one-word names', () => {
    expect(authorInitials('alice')).toBe('A');
    expect(authorInitials('Bob')).toBe('B');
  });

  it('returns first + last initials for two-word names', () => {
    expect(authorInitials('Alice Smith')).toBe('AS');
  });

  it('uses first and LAST word for multi-part names', () => {
    expect(authorInitials('Alice van der Berg')).toBe('AB');
  });

  it('uppercases lowercase input', () => {
    expect(authorInitials('alice smith')).toBe('AS');
  });

  it('handles surrounding and internal extra whitespace', () => {
    expect(authorInitials('  Alice   Smith  ')).toBe('AS');
  });
});
