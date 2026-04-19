import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../llm/provider-registry.js', () => ({
  providerRegistry: {
    getEmbeddingProvider: vi.fn(),
  },
}));

import { providerRegistry } from '../llm/provider-registry.js';

describe('Embedding service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns null when no embedding provider is available', async () => {
    vi.mocked(providerRegistry.getEmbeddingProvider).mockReturnValue(undefined);

    const { generateEmbedding } = await import('./embedding-service.js');
    const result = await generateEmbedding('hello world');
    expect(result).toBeNull();
  });

  it('calls provider.embed with truncated text', async () => {
    const mockEmbed = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);
    vi.mocked(providerRegistry.getEmbeddingProvider).mockReturnValue({
      id: 'openai',
      name: 'OpenAI',
      embed: mockEmbed,
      chat: vi.fn() as any,
      listModels: vi.fn(),
    });

    const { generateEmbedding } = await import('./embedding-service.js');
    const result = await generateEmbedding('hello world');

    expect(mockEmbed).toHaveBeenCalledWith(['hello world']);
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it('truncates text to 8000 chars', async () => {
    const mockEmbed = vi.fn().mockResolvedValue([[0.1]]);
    vi.mocked(providerRegistry.getEmbeddingProvider).mockReturnValue({
      id: 'openai',
      name: 'OpenAI',
      embed: mockEmbed,
      chat: vi.fn() as any,
      listModels: vi.fn(),
    });

    const { generateEmbedding } = await import('./embedding-service.js');
    const longText = 'a'.repeat(10000);
    await generateEmbedding(longText);

    const calledWith = mockEmbed.mock.calls[0][0][0] as string;
    expect(calledWith.length).toBe(8000);
  });
});
