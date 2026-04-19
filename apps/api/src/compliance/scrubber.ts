import type { ChatParams, ChatEvent, LLMMessage, ContentPart } from '@hearth/shared';
import type {
  EntityDetector,
  DetectedEntity,
  TokenMap,
  ScrubResult,
  ChatScrubResult,
} from './types.js';
import { resolveDetectors } from './packs/index.js';
import type { OrgComplianceConfig } from './types.js';

/** Maximum buffer size for stream descrubbing (longest possible token ~30 chars) */
const MAX_BUFFER_SIZE = 30;

/** Pattern matching placeholders like [ENTITY_TYPE_N] */
const PLACEHOLDER_PATTERN = /\[[A-Z_]+_\d+\]/g;

// ─── Token Map ────────────────────────────────────────────────

/** Create a fresh session-scoped token map */
export function createTokenMap(): TokenMap {
  return {
    toOriginal: new Map(),
    toPlaceholder: new Map(),
    counters: new Map(),
  };
}

/** Get or create a placeholder for a value in the token map */
function getPlaceholder(
  tokenMap: TokenMap,
  entityType: string,
  originalValue: string,
): string {
  const existing = tokenMap.toPlaceholder.get(originalValue);
  if (existing) return existing;

  const counter = (tokenMap.counters.get(entityType) ?? 0) + 1;
  tokenMap.counters.set(entityType, counter);

  const placeholder = `[${entityType}_${counter}]`;
  tokenMap.toOriginal.set(placeholder, originalValue);
  tokenMap.toPlaceholder.set(originalValue, placeholder);
  return placeholder;
}

// ─── Detection ────────────────────────────────────────────────

/** Detect entities in text using active detectors */
export function detectEntities(
  text: string,
  detectors: EntityDetector[],
): DetectedEntity[] {
  const entities: DetectedEntity[] = [];

  for (const detector of detectors) {
    for (const pattern of detector.patterns) {
      // Reset lastIndex for global regex reuse
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        let matchedText = match[0];

        // For context-dependent patterns, strip the context prefix to get the actual value
        // The placeholder should only cover the sensitive value, not the context keyword
        if (detector.contextPatterns) {
          // Only accept this match if context is present nearby
          const surroundStart = Math.max(0, match.index - 50);
          const surrounding = text.substring(surroundStart, match.index + matchedText.length + 50);
          const hasContext = detector.contextPatterns.some((cp) => cp.test(surrounding));
          if (!hasContext) continue;
        }

        // Run validation if present
        if (detector.validate && !detector.validate(matchedText)) {
          continue;
        }

        entities.push({
          detectorId: detector.id,
          entityType: detector.entityType,
          originalValue: matchedText,
          placeholder: '', // filled during scrubbing
          startIndex: match.index,
          endIndex: match.index + matchedText.length,
        });
      }
    }
  }

  // Sort by start index, then by length (longer matches first for overlap resolution)
  entities.sort((a, b) => a.startIndex - b.startIndex || (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex));

  // Remove overlapping entities (keep the first/higher-priority one)
  const deduplicated: DetectedEntity[] = [];
  let lastEnd = -1;
  for (const entity of entities) {
    if (entity.startIndex >= lastEnd) {
      deduplicated.push(entity);
      lastEnd = entity.endIndex;
    }
  }

  return deduplicated;
}

// ─── Text Scrubbing ───────────────────────────────────────────

/** Scrub a single text string, returning scrubbed text and detected entities */
export function scrubText(
  text: string,
  detectors: EntityDetector[],
  tokenMap: TokenMap,
): ScrubResult {
  const entities = detectEntities(text, detectors);

  if (entities.length === 0) {
    return { scrubbedText: text, entities, tokenMap };
  }

  // Build scrubbed text by replacing entities from end to start
  let scrubbedText = text;
  for (let i = entities.length - 1; i >= 0; i--) {
    const entity = entities[i];
    entity.placeholder = getPlaceholder(tokenMap, entity.entityType, entity.originalValue);
    scrubbedText =
      scrubbedText.substring(0, entity.startIndex) +
      entity.placeholder +
      scrubbedText.substring(entity.endIndex);
  }

  return { scrubbedText, entities, tokenMap };
}

// ─── Chat Params Scrubbing ────────────────────────────────────

/** Scrub a content part (text or image) */
function scrubContentPart(
  part: ContentPart,
  detectors: EntityDetector[],
  tokenMap: TokenMap,
): ContentPart {
  if (part.type === 'text') {
    const result = scrubText(part.text, detectors, tokenMap);
    return { type: 'text', text: result.scrubbedText };
  }
  return part; // images pass through
}

/** Scrub message content (string or ContentPart[]) */
function scrubMessageContent(
  content: string | ContentPart[],
  detectors: EntityDetector[],
  tokenMap: TokenMap,
): string | ContentPart[] {
  if (typeof content === 'string') {
    return scrubText(content, detectors, tokenMap).scrubbedText;
  }
  return content.map((part) => scrubContentPart(part, detectors, tokenMap));
}

/** Scrub all ChatParams before sending to LLM */
export function scrubChatParams(
  params: ChatParams,
  config: OrgComplianceConfig,
): ChatScrubResult {
  const tokenMap = createTokenMap();
  const detectors = resolveDetectors(config.enabledPacks, config.detectorOverrides);

  if (detectors.length === 0) {
    return {
      scrubbedParams: params,
      tokenMap,
      totalEntities: 0,
      entityCounts: {},
    };
  }

  const scrubbedMessages: LLMMessage[] = params.messages.map((msg) => ({
    ...msg,
    content: scrubMessageContent(msg.content, detectors, tokenMap),
  }));

  let scrubbedSystemPrompt = params.systemPrompt;
  if (scrubbedSystemPrompt) {
    scrubbedSystemPrompt = scrubText(scrubbedSystemPrompt, detectors, tokenMap).scrubbedText;
  }

  // Add compliance notice to system prompt when scrubbing is active
  if (tokenMap.toOriginal.size > 0 && scrubbedSystemPrompt) {
    scrubbedSystemPrompt =
      'Note: Some personal information in this conversation has been replaced with placeholders (e.g., [PERSON_NAME_1]) for privacy compliance. Use these placeholders as-is in your responses.\n\n' +
      scrubbedSystemPrompt;
  }

  // Build entity counts
  const entityCounts: Record<string, number> = {};
  for (const [, counter] of tokenMap.counters) {
    // counters map has entityType -> count
  }
  for (const [entityType, count] of tokenMap.counters) {
    entityCounts[entityType] = count;
  }

  return {
    scrubbedParams: {
      ...params,
      messages: scrubbedMessages,
      systemPrompt: scrubbedSystemPrompt,
    },
    tokenMap,
    totalEntities: tokenMap.toOriginal.size,
    entityCounts,
  };
}

// ─── Stream Descrubbing ───────────────────────────────────────

/** Descrub a single text string using a token map */
export function descrubText(text: string, tokenMap: TokenMap): string {
  if (tokenMap.toOriginal.size === 0) return text;

  return text.replace(PLACEHOLDER_PATTERN, (match) => {
    return tokenMap.toOriginal.get(match) ?? match;
  });
}

/**
 * Descrub a chat event stream, handling tokens split across chunks.
 * Buffers text_delta events to reassemble split placeholders.
 */
export async function* descrubStream(
  stream: AsyncIterable<ChatEvent>,
  tokenMap: TokenMap,
): AsyncGenerator<ChatEvent> {
  if (tokenMap.toOriginal.size === 0) {
    yield* stream;
    return;
  }

  let buffer = '';

  for await (const event of stream) {
    if (event.type === 'text_delta') {
      buffer += event.content;

      // Check if buffer might contain an incomplete placeholder
      const lastBracket = buffer.lastIndexOf('[');
      if (lastBracket >= 0 && !buffer.substring(lastBracket).includes(']')) {
        // Potential incomplete placeholder — flush everything before the bracket
        if (lastBracket > 0) {
          const flushable = buffer.substring(0, lastBracket);
          const descrubbed = descrubText(flushable, tokenMap);
          if (descrubbed) {
            yield { type: 'text_delta', content: descrubbed };
          }
          buffer = buffer.substring(lastBracket);
        }

        // If buffer is getting too long, it's not a placeholder — flush it
        if (buffer.length > MAX_BUFFER_SIZE) {
          const descrubbed = descrubText(buffer, tokenMap);
          yield { type: 'text_delta', content: descrubbed };
          buffer = '';
        }
        continue;
      }

      // No incomplete placeholder — descrub and flush entire buffer
      const descrubbed = descrubText(buffer, tokenMap);
      yield { type: 'text_delta', content: descrubbed };
      buffer = '';
    } else if (event.type === 'tool_call_start') {
      // Flush buffer before tool calls
      if (buffer) {
        yield { type: 'text_delta', content: descrubText(buffer, tokenMap) };
        buffer = '';
      }
      // Descrub tool call arguments
      yield {
        ...event,
        input: descrubObject(event.input, tokenMap),
      };
    } else if (event.type === 'done') {
      // Flush remaining buffer
      if (buffer) {
        yield { type: 'text_delta', content: descrubText(buffer, tokenMap) };
        buffer = '';
      }
      yield event;
    } else {
      // Flush buffer for any non-text event
      if (buffer) {
        yield { type: 'text_delta', content: descrubText(buffer, tokenMap) };
        buffer = '';
      }
      yield event;
    }
  }

  // Flush any remaining buffer
  if (buffer) {
    yield { type: 'text_delta', content: descrubText(buffer, tokenMap) };
  }
}

/** Recursively descrub string values in an object (for tool call arguments) */
function descrubObject(
  obj: Record<string, unknown>,
  tokenMap: TokenMap,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = descrubText(value, tokenMap);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'string'
          ? descrubText(item, tokenMap)
          : item && typeof item === 'object'
            ? descrubObject(item as Record<string, unknown>, tokenMap)
            : item,
      );
    } else if (value && typeof value === 'object') {
      result[key] = descrubObject(value as Record<string, unknown>, tokenMap);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ─── Embed Scrubbing ──────────────────────────────────────────

/** Scrub text array for embedding, using a temporary token map (not session-scoped) */
export function scrubTextsForEmbed(
  texts: string[],
  config: OrgComplianceConfig,
): string[] {
  const tokenMap = createTokenMap();
  const detectors = resolveDetectors(config.enabledPacks, config.detectorOverrides);

  if (detectors.length === 0) return texts;

  return texts.map((text) => scrubText(text, detectors, tokenMap).scrubbedText);
}

// ─── Safe Content Escape ──────────────────────────────────────

/** Strip <safe>...</safe> blocks if allowUserOverride is true, returning the raw content */
export function processSafeBlocks(
  text: string,
  allowUserOverride: boolean,
): { processedText: string; safeBlocks: string[] } {
  if (!allowUserOverride) {
    return { processedText: text, safeBlocks: [] };
  }

  const safeBlocks: string[] = [];
  const processedText = text.replace(
    /<safe>([\s\S]*?)<\/safe>/g,
    (_match, content: string) => {
      safeBlocks.push(content);
      return content; // Leave the content as-is, but track it
    },
  );

  return { processedText, safeBlocks };
}
