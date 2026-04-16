import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateMessageTokens, willExceedLimit } from './token-counter.js';

describe('estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates tokens for short text', () => {
    // "hello" = 5 chars → ceil(5/4) = 2
    expect(estimateTokens('hello')).toBe(2);
  });

  it('estimates tokens for longer text', () => {
    const text = 'The quick brown fox jumps over the lazy dog'; // 43 chars
    expect(estimateTokens(text)).toBe(Math.ceil(43 / 4)); // 11
  });

  it('estimates tokens for single character', () => {
    expect(estimateTokens('a')).toBe(1);
  });

  it('estimates tokens for exactly 4 characters', () => {
    expect(estimateTokens('abcd')).toBe(1);
  });

  it('estimates tokens for 5 characters (rounds up)', () => {
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('handles unicode characters', () => {
    const unicode = '你好世界'; // 4 chars
    expect(estimateTokens(unicode)).toBe(Math.ceil(unicode.length / 4));
  });

  it('handles emoji characters', () => {
    const emoji = '😀😁😂🤣'; // each emoji is 2 JS chars (surrogate pairs)
    expect(estimateTokens(emoji)).toBe(Math.ceil(emoji.length / 4));
  });
});

describe('estimateMessageTokens', () => {
  it('returns 0 for an empty array', () => {
    expect(estimateMessageTokens([])).toBe(0);
  });

  it('estimates tokens for a single message with 4-token overhead', () => {
    // "hi" = 2 chars → ceil(2/4) = 1 token, plus 4 overhead = 5
    const messages = [{ role: 'user', content: 'hi' }];
    expect(estimateMessageTokens(messages)).toBe(5);
  });

  it('estimates tokens for multiple messages', () => {
    const messages = [
      { role: 'user', content: 'hello' },       // 4 + ceil(5/4) = 4 + 2 = 6
      { role: 'assistant', content: 'hi there' }, // 4 + ceil(8/4) = 4 + 2 = 6
    ];
    expect(estimateMessageTokens(messages)).toBe(12);
  });

  it('handles messages with empty content', () => {
    const messages = [{ role: 'user', content: '' }];
    // 4 overhead + 0 tokens = 4
    expect(estimateMessageTokens(messages)).toBe(4);
  });
});

describe('willExceedLimit', () => {
  it('returns false when under the limit', () => {
    const messages = [{ role: 'user', content: 'hi' }]; // 5 tokens
    expect(willExceedLimit(messages, 100)).toBe(false);
  });

  it('returns true when over the limit', () => {
    const messages = [{ role: 'user', content: 'hi' }]; // 5 tokens
    expect(willExceedLimit(messages, 3)).toBe(true);
  });

  it('returns false at exact limit (not exceeded)', () => {
    // "hi" → 5 tokens total
    const messages = [{ role: 'user', content: 'hi' }];
    expect(willExceedLimit(messages, 5)).toBe(false);
  });

  it('returns true when one over the limit', () => {
    const messages = [{ role: 'user', content: 'hi' }]; // 5 tokens
    expect(willExceedLimit(messages, 4)).toBe(true);
  });
});
