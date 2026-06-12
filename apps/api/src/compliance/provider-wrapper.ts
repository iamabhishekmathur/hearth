import type { ChatParams, ChatEvent } from '@hearth/shared';
import { logger } from '../lib/logger.js';
import { getRequestContext } from '../lib/request-context.js';
import { getComplianceConfig } from './config-cache.js';
import { createTokenMap, scrubChatParams, descrubStream, scrubTextsForEmbed } from './scrubber.js';
import { logComplianceScrub } from '../services/audit-service.js';
import type { ChatInterceptor, EmbedInterceptor, TokenMap } from './types.js';

// One token map per chat session, reused across turns so placeholder numbering
// is stable and any placeholder echoed by the model — even one carried over from
// an earlier turn's transcript — can always be rehydrated. Bounded LRU so a
// long-lived process doesn't accumulate maps unboundedly. (Process-local: a
// restart or the worker process starts fresh; that's an accepted limitation —
// a Redis-backed map would make it fully durable.)
const SESSION_TOKENMAP_LIMIT = 1000;
const sessionTokenMaps = new Map<string, TokenMap>();

function acquireTokenMap(sessionId: string | undefined): TokenMap {
  if (!sessionId) return createTokenMap();
  const existing = sessionTokenMaps.get(sessionId);
  if (existing) {
    sessionTokenMaps.delete(sessionId); // re-insert to mark most-recently-used
    sessionTokenMaps.set(sessionId, existing);
    return existing;
  }
  const created = createTokenMap();
  sessionTokenMaps.set(sessionId, created);
  if (sessionTokenMaps.size > SESSION_TOKENMAP_LIMIT) {
    const oldest = sessionTokenMaps.keys().next().value;
    if (oldest !== undefined) sessionTokenMaps.delete(oldest);
  }
  return created;
}

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

  // Scrub outbound, reusing this chat session's token map across turns (and
  // across participants in a shared session). Falls back to the ambient request
  // session when a call isn't tied to a chat (keeps placeholders stable per
  // request at worst).
  const scrubResult = scrubChatParams(params, config, acquireTokenMap(params.sessionId ?? ctx.sessionId));

  if (scrubResult.totalEntities === 0) {
    // Nothing ever scrubbed in this session — pass through
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
