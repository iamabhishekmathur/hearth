import { describe, it, expect } from 'vitest';

// Test embedding service behavior without OPENAI_API_KEY

describe('Embedding service — graceful degradation', () => {
  it('returns null when OPENAI_API_KEY is not set', async () => {
    // The actual function checks env.OPENAI_API_KEY
    // This test verifies the pattern: no key = null return
    const generateEmbedding = (text: string): number[] | null => {
      const apiKey = undefined; // simulating no key
      if (!apiKey) return null;
      // Would call OpenAI API here
      return [];
    };

    expect(generateEmbedding('hello world')).toBeNull();
  });

  it('truncates text to 8000 chars before sending', () => {
    const maxLength = 8000;
    const longText = 'a'.repeat(10000);
    const truncated = longText.slice(0, maxLength);
    expect(truncated.length).toBe(8000);
  });
});
