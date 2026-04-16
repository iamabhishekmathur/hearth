import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { generateEmbedding } from './embedding-service.js';
import { chunkText } from '../lib/chunker.js';
import { logger } from '../lib/logger.js';

/** Max concurrent embedding API calls to avoid rate limits. */
const EMBEDDING_CONCURRENCY = 5;

/**
 * Runs a batch of async functions with bounded concurrency.
 */
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

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runNext());
  await Promise.all(workers);
}

/**
 * Runs the synthesis pipeline for a single user:
 * 1. Queries connected integrations via MCP gateway (stub for now)
 * 2. Chunks and embeds new content with bounded concurrency
 * 3. Deduplicates against existing memory (cosine > 0.95 = skip)
 * 4. Creates new entries in the user's personal memory layer
 */
export async function synthesizeForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { team: { select: { orgId: true } } },
  });

  if (!user || !user.team?.orgId) {
    logger.warn({ userId }, 'Synthesis: user not found or no org');
    return { created: 0, skipped: 0 };
  }

  const orgId = user.team.orgId;

  // Fetch integration data — this is a stub that will be wired to MCP gateway
  const rawContent = await fetchIntegrationData(userId, orgId);
  if (!rawContent || rawContent.length === 0) {
    logger.info({ userId }, 'Synthesis: no new content from integrations');
    return { created: 0, skipped: 0 };
  }

  // Flatten all chunks with their source metadata
  const allChunks: Array<{
    text: string;
    source: string;
    sourceRef?: Record<string, unknown>;
  }> = [];

  for (const item of rawContent) {
    const chunks = chunkText(item.text);
    for (const chunk of chunks) {
      allChunks.push({
        text: chunk.text,
        source: item.source,
        sourceRef: item.sourceRef,
      });
    }
  }

  let created = 0;
  let skipped = 0;

  // Process chunks with bounded concurrency
  await batchWithConcurrency(
    allChunks,
    async (chunk) => {
      try {
        const embedding = await generateEmbedding(chunk.text);
        if (!embedding) {
          // No embedding service — skip dedup, just create
          await prisma.memoryEntry.create({
            data: {
              orgId,
              userId,
              layer: 'user',
              content: chunk.text,
              source: chunk.source,
              sourceRef: chunk.sourceRef
                ? (chunk.sourceRef as Prisma.InputJsonValue)
                : Prisma.DbNull,
            },
          });
          created++;
          return;
        }

        // Dedup: check if similar content exists (cosine > 0.95)
        const embeddingStr = `[${embedding.join(',')}]`;
        const similar = await prisma.$queryRawUnsafe<
          Array<{ id: string; similarity: number }>
        >(
          `SELECT id, 1 - (embedding <=> $1::vector) AS similarity
           FROM memory_entries
           WHERE org_id = $2 AND user_id = $3 AND layer = 'user'
             AND embedding IS NOT NULL
           ORDER BY embedding <=> $1::vector
           LIMIT 1`,
          embeddingStr,
          orgId,
          userId,
        );

        if (similar.length > 0 && similar[0].similarity > 0.95) {
          skipped++;
          return;
        }

        // Create new memory entry with embedding
        const entry = await prisma.memoryEntry.create({
          data: {
            orgId,
            userId,
            layer: 'user',
            content: chunk.text,
            source: chunk.source,
            sourceRef: chunk.sourceRef
              ? (chunk.sourceRef as Prisma.InputJsonValue)
              : Prisma.DbNull,
          },
        });

        // Store embedding
        await prisma.$executeRawUnsafe(
          `UPDATE memory_entries SET embedding = $1::vector WHERE id = $2`,
          embeddingStr,
          entry.id,
        );

        created++;
      } catch (err) {
        logger.error(
          { err, userId, source: chunk.source },
          'Synthesis: failed to process chunk',
        );
      }
    },
    EMBEDDING_CONCURRENCY,
  );

  logger.info({ userId, created, skipped }, 'Synthesis: completed');
  return { created, skipped };
}

/**
 * Stub: fetches content from connected integrations via MCP gateway.
 * In a full implementation this would query each active integration.
 */
async function fetchIntegrationData(
  userId: string,
  orgId: string,
): Promise<
  Array<{ text: string; source: string; sourceRef?: Record<string, unknown> }>
> {
  // Query active integrations for this org
  const integrations = await prisma.integration.findMany({
    where: { orgId, status: 'active', enabled: true },
  });

  if (integrations.length === 0) return [];

  // TODO: Wire up to MCP gateway to actually fetch data from integrations
  // For now, return empty — the pipeline infrastructure is ready
  logger.info(
    { userId, integrationCount: integrations.length },
    'Synthesis: would query integrations (stub)',
  );

  return [];
}
