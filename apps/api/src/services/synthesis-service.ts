import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { generateEmbedding } from './embedding-service.js';
import { chunkText } from '../lib/chunker.js';
import { logger } from '../lib/logger.js';
import { mcpGateway } from '../mcp/gateway.js';

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
 * 1. Queries connected integrations via MCP gateway for recent content
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

  // Fetch recent content from connected integrations
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
 * Per-provider strategy: which tool to call for recent content,
 * how to build its input, and how to extract text from the output.
 */
interface FetchStrategy {
  toolName: string;
  buildInput: () => Record<string, unknown>;
  extractContent: (
    output: Record<string, unknown>,
  ) => Array<{ text: string; sourceRef?: Record<string, unknown> }>;
}

function yesterdayDateStr(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

const PROVIDER_STRATEGIES: Record<string, FetchStrategy> = {
  slack: {
    toolName: 'slack_search_messages',
    buildInput: () => ({ query: `after:${yesterdayDateStr()}`, limit: 50 }),
    extractContent: (output) => {
      const messages = (output.messages as Array<Record<string, unknown>>) ?? [];
      return messages
        .filter((m) => typeof m.text === 'string' && (m.text as string).length > 0)
        .map((m) => ({
          text: m.text as string,
          sourceRef: { ts: m.ts, channel: m.channel },
        }));
    },
  },

  gmail: {
    toolName: 'gmail_search',
    buildInput: () => ({ query: 'newer_than:1d', maxResults: 20 }),
    extractContent: (output) => {
      const messages = (output.messages as Array<Record<string, unknown>>) ?? [];
      return messages
        .filter((m) => typeof m.snippet === 'string' && (m.snippet as string).length > 0)
        .map((m) => ({
          text: m.snippet as string,
          sourceRef: { messageId: m.id, threadId: m.threadId },
        }));
    },
  },

  notion: {
    toolName: 'notion_search',
    buildInput: () => ({ query: '' }), // empty query returns recently edited pages
    extractContent: (output) => {
      const results = (output.results as Array<Record<string, unknown>>) ?? [];
      return results
        .map((r) => {
          const props = (r.properties as Record<string, unknown>) ?? {};
          // Notion titles live under a "title" or "Name" property
          const titleProp = (props.title ?? props.Name) as Record<string, unknown> | undefined;
          let title = '';
          if (titleProp) {
            const titleArr = (titleProp.title as Array<Record<string, unknown>>) ?? [];
            title = titleArr
              .map((t) => ((t.text as Record<string, unknown>)?.content as string) ?? '')
              .join('');
          }
          return {
            text: title || `Notion page ${r.id}`,
            sourceRef: { pageId: r.id, url: r.url },
          };
        })
        .filter((r) => r.text.length > 0);
    },
  },

  jira: {
    toolName: 'jira_search',
    buildInput: () => ({ jql: 'updated >= -1d ORDER BY updated DESC', maxResults: 20 }),
    extractContent: (output) => {
      const issues = (output.issues as Array<Record<string, unknown>>) ?? [];
      return issues
        .map((i) => {
          const fields = (i.fields as Record<string, unknown>) ?? {};
          const summary = (fields.summary as string) ?? '';
          const description = (fields.description as string) ?? '';
          return {
            text: `${i.key}: ${summary}${description ? '\n' + description : ''}`,
            sourceRef: { issueKey: i.key },
          };
        })
        .filter((r) => r.text.length > 0);
    },
  },

  gcalendar: {
    toolName: 'gcalendar_list_events',
    buildInput: () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      return { timeMin: yesterday.toISOString(), timeMax: now.toISOString(), maxResults: 20 };
    },
    extractContent: (output) => {
      const events = (output.events as Array<Record<string, unknown>>) ?? [];
      return events
        .map((e) => {
          const summary = (e.summary as string) ?? '';
          const description = (e.description as string) ?? '';
          return {
            text: `${summary}${description ? ': ' + description : ''}`,
            sourceRef: { eventId: e.id },
          };
        })
        .filter((r) => r.text.length > 0);
    },
  },
};

/**
 * Fetches recent content from connected integrations via MCP gateway.
 * Iterates active integrations, calls each provider's search/list tool,
 * and normalises the output into a flat array for the synthesis pipeline.
 */
async function fetchIntegrationData(
  userId: string,
  orgId: string,
): Promise<
  Array<{ text: string; source: string; sourceRef?: Record<string, unknown> }>
> {
  const integrations = await prisma.integration.findMany({
    where: { orgId, status: 'active', enabled: true },
  });

  if (integrations.length === 0) return [];

  const connectedIds = new Set(mcpGateway.getConnectedIntegrations());
  const results: Array<{ text: string; source: string; sourceRef?: Record<string, unknown> }> = [];

  for (const integration of integrations) {
    if (!connectedIds.has(integration.id)) {
      logger.debug(
        { integrationId: integration.id, provider: integration.provider },
        'Synthesis: integration not connected to gateway, skipping',
      );
      continue;
    }

    const strategy = PROVIDER_STRATEGIES[integration.provider];
    if (!strategy) {
      logger.debug({ provider: integration.provider }, 'Synthesis: no fetch strategy for provider');
      continue;
    }

    try {
      const result = await mcpGateway.executeTool(
        integration.id,
        strategy.toolName,
        strategy.buildInput(),
      );

      if (result.error) {
        logger.warn(
          { integrationId: integration.id, provider: integration.provider, error: result.error },
          'Synthesis: tool execution returned error',
        );
        continue;
      }

      const items = strategy.extractContent(result.output);
      for (const item of items) {
        results.push({
          text: item.text,
          source: integration.provider,
          sourceRef: item.sourceRef,
        });
      }
    } catch (err) {
      logger.error(
        { err, integrationId: integration.id, provider: integration.provider },
        'Synthesis: failed to fetch from integration',
      );
    }
  }

  logger.info(
    { userId, integrationCount: integrations.length, resultCount: results.length },
    'Synthesis: fetched integration data',
  );
  return results;
}
