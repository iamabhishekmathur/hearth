import { env } from '../config.js';
import { logger } from '../lib/logger.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

/**
 * Generates an embedding vector for the given text using OpenAI's API.
 * Returns null if OPENAI_API_KEY is not configured (graceful degradation).
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!env.OPENAI_API_KEY) {
    logger.debug('OPENAI_API_KEY not set — skipping embedding generation');
    return null;
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000), // Truncate to stay within token limits
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error({ status: response.status, body }, 'OpenAI embedding request failed');
    throw new Error(`Embedding API returned ${response.status}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };

  return data.data[0].embedding;
}

export { EMBEDDING_DIM };
