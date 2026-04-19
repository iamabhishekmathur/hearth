import type { ChatParams, ChatEvent } from '@hearth/shared';
import { logger } from '../lib/logger.js';
import { getRequestContext } from '../lib/request-context.js';
import { getComplianceConfig } from './config-cache.js';
import { scrubChatParams, descrubStream, scrubTextsForEmbed } from './scrubber.js';
import { logComplianceScrub } from '../services/audit-service.js';
import type { ChatInterceptor, EmbedInterceptor } from './types.js';

/**
 * Chat interceptor: scrubs outbound params, descrubs inbound stream.
 */
export const complianceChatInterceptor: ChatInterceptor = (
  params: ChatParams,
  preferredId: string | undefined,
  realChat: (params: ChatParams, preferredId?: string) => AsyncIterable<ChatEvent>,
): AsyncIterable<ChatEvent> => {
  // Return an async iterable that lazily evaluates
  return {
    [Symbol.asyncIterator]() {
      return chatInterceptorGenerator(params, preferredId, realChat)[
        Symbol.asyncIterator
      ]();
    },
  };
};

async function* chatInterceptorGenerator(
  params: ChatParams,
  preferredId: string | undefined,
  realChat: (params: ChatParams, preferredId?: string) => AsyncIterable<ChatEvent>,
): AsyncGenerator<ChatEvent> {
  const ctx = getRequestContext();
  if (!ctx?.orgId) {
    // No context — pass through
    yield* realChat(params, preferredId);
    return;
  }

  const config = await getComplianceConfig(ctx.orgId);
  if (config.enabledPacks.length === 0) {
    // No packs enabled — pass through
    yield* realChat(params, preferredId);
    return;
  }

  // Scrub outbound
  const scrubResult = scrubChatParams(params, config);

  if (scrubResult.totalEntities === 0) {
    // Nothing scrubbed — pass through
    yield* realChat(params, preferredId);
    return;
  }

  logger.debug(
    { orgId: ctx.orgId, entities: scrubResult.totalEntities, counts: scrubResult.entityCounts },
    'Compliance scrub applied to chat params',
  );

  // Call real provider with scrubbed params
  const rawStream = realChat(scrubResult.scrubbedParams, preferredId);

  // Descrub the response stream
  yield* descrubStream(rawStream, scrubResult.tokenMap);

  // Audit log (fire-and-forget)
  logComplianceScrub({
    orgId: ctx.orgId,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    packs: config.enabledPacks,
    entityCounts: scrubResult.entityCounts,
    direction: 'outbound',
    auditLevel: config.auditLevel ?? 'summary',
  }).catch(() => {});
}

/**
 * Embed interceptor: scrubs texts before embedding (no descrub needed for embeddings).
 */
export const complianceEmbedInterceptor: EmbedInterceptor = async (
  texts: string[],
  preferredId: string | undefined,
  realEmbed: (texts: string[], preferredId?: string) => Promise<number[][] | null>,
): Promise<number[][] | null> => {
  const ctx = getRequestContext();
  if (!ctx?.orgId) {
    return realEmbed(texts, preferredId);
  }

  const config = await getComplianceConfig(ctx.orgId);
  if (config.enabledPacks.length === 0) {
    return realEmbed(texts, preferredId);
  }

  const scrubbedTexts = scrubTextsForEmbed(texts, config);
  return realEmbed(scrubbedTexts, preferredId);
};
