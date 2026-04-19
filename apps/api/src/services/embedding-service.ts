import { providerRegistry } from '../llm/provider-registry.js';
import { logger } from '../lib/logger.js';

/**
 * Generates an embedding vector for the given text using the best available provider.
 * Routes through the provider registry (OpenAI, Ollama, etc.) rather than hardcoding.
 * Returns null if no provider supports embeddings (graceful degradation to FTS-only).
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const provider = providerRegistry.getEmbeddingProvider();
  if (!provider?.embed) {
    logger.debug('No embedding provider available — skipping embedding generation');
    return null;
  }

  try {
    const results = await provider.embed([text.slice(0, 8000)]);
    return results[0] ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Embedding generation failed';
    logger.error({ provider: provider.id, err }, message);
    throw new Error(`Embedding via ${provider.id} failed: ${message}`);
  }
}

/**
 * Returns the dimension of embeddings from the current provider, or null if unavailable.
 */
export async function getEmbeddingDimension(): Promise<number | null> {
  const provider = providerRegistry.getEmbeddingProvider();
  if (!provider?.embed) return null;

  try {
    // Generate a test embedding to detect dimension
    const results = await provider.embed(['dimension probe']);
    return results[0]?.length ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns info about the current embedding provider for display in settings.
 */
export function getEmbeddingStatus(): { available: boolean; providerId: string | null } {
  const provider = providerRegistry.getEmbeddingProvider();
  return {
    available: !!provider,
    providerId: provider?.id ?? null,
  };
}
