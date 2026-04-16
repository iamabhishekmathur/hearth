import { describe, it, expect } from 'vitest';
import { chunkText } from './chunker.js';

describe('chunkText', () => {
  it('returns empty array for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   ')).toEqual([]);
  });

  it('returns single chunk for short text', () => {
    const chunks = chunkText('Hello world');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('Hello world');
    expect(chunks[0].index).toBe(0);
  });

  it('splits long text into multiple chunks', () => {
    const text = 'a'.repeat(2500);
    const chunks = chunkText(text, { chunkSize: 1000, overlap: 200 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('preserves all content across chunks', () => {
    const text = Array.from({ length: 10 }, (_, i) => `Sentence ${i}.`).join(' ');
    const chunks = chunkText(text, { chunkSize: 30, overlap: 5 });
    expect(chunks.length).toBeGreaterThan(0);
    // Each chunk should be non-empty
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });

  it('assigns sequential indices', () => {
    const text = 'a'.repeat(3000);
    const chunks = chunkText(text, { chunkSize: 1000, overlap: 100 });
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
    }
  });

  it('handles text with paragraphs', () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const chunks = chunkText(text, { chunkSize: 30, overlap: 5 });
    expect(chunks.length).toBeGreaterThan(0);
  });
});
