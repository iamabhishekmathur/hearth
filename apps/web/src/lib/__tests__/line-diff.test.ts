import { describe, it, expect } from 'vitest';
import { diffSummary, lineDiff } from '../line-diff';

describe('lineDiff', () => {
  it('marks added, removed and kept lines in order', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'B' },
      { type: 'same', text: 'c' },
      { type: 'add', text: 'd' },
    ]);
  });

  it('equal texts are all "same"', () => {
    expect(lineDiff('x\ny', 'x\ny').every((l) => l.type === 'same')).toBe(true);
  });

  it('very long texts fall back to removed-then-added', () => {
    const a = Array.from({ length: 600 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 600 }, (_, i) => `b${i}`).join('\n');
    const d = lineDiff(a, b);
    expect(d).toHaveLength(1200);
    expect(d[0].type).toBe('del');
    expect(d[1199].type).toBe('add');
  });
});

describe('diffSummary', () => {
  it('says what changed in plain words', () => {
    expect(diffSummary(lineDiff('a', 'a\nb\nc'))).toBe('2 lines added');
    expect(diffSummary(lineDiff('a\nb', 'a'))).toBe('1 removed');
    expect(diffSummary(lineDiff('a', 'b'))).toBe('1 line added, 1 removed');
    expect(diffSummary(lineDiff('a', 'a'))).toBe('No change to the text');
  });
});
