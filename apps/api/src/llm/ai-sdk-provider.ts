import {
  streamText,
  embedMany,
  type ModelMessage,
  type LanguageModel,
  type EmbeddingModel,
  type ToolSet,
  tool,
  jsonSchema,
  type TextStreamPart,
} from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type {
  ChatParams,
  ChatEvent,
  LLMMessage,
  ToolDefinition,
  ContentPart,
} from '@hearth/shared';
import { getTextContent } from '@hearth/shared';
import type { LLMProvider } from './types.js';

/**
 * The provider families the AI SDK path covers. `openai-compatible` is the
 * catch-all for local/self-host endpoints (Ollama, LM Studio, vLLM, Groq, …).
 */
export type AiSdkProviderKind =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'bedrock'
  | 'openai-compatible';

export interface AiSdkProviderConfig {
  /** Stable registry id, e.g. `anthropic`, `openai`, `ollama`, `groq`. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Which AI SDK family drives this provider. */
  kind: AiSdkProviderKind;
  apiKey?: string;
  /** For openai-compatible / custom endpoints. */
  baseURL?: string;
  /** For Bedrock (SigV4). */
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /** Embedding model id for `embed()`. Defaults per-family. */
  embeddingModel?: string;
  /** Embedding dimensions (pgvector column is 1536). */
  embeddingDimensions?: number;
}

type ProviderFactory = {
  languageModel(modelId: string): LanguageModel;
  textEmbeddingModel?(modelId: string): EmbeddingModel;
};

/**
 * `AiSdkProvider` — the W1 replacement for the four hand-rolled providers.
 *
 * Maps Hearth's `LLMProvider` contract onto the Vercel AI SDK:
 *   `chat()`  → `streamText().fullStream`, re-emitting AI SDK parts as Hearth
 *               `ChatEvent`s in the exact legacy shape/order
 *               (`thinking` → `text_delta`* → `tool_call_start`/`delta`/`end`
 *                → `done{usage}`), honoring `params.signal`.
 *   `embed()` → `embedMany`.
 *
 * One `AiSdkProvider` instance is created per configured provider; the
 * underlying AI SDK provider family is selected by `config.kind`. The model id
 * flows straight through (resolved/validated upstream by the model catalog, so
 * there is no silent fallback here).
 */
export class AiSdkProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  private readonly kind: AiSdkProviderKind;
  private readonly factory: ProviderFactory;
  private readonly embeddingModelId: string | undefined;
  private readonly embeddingDimensions: number | undefined;

  constructor(config: AiSdkProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.kind = config.kind;
    this.embeddingDimensions = config.embeddingDimensions;

    switch (config.kind) {
      case 'anthropic':
        this.factory = createAnthropic({
          ...(config.apiKey ? { apiKey: config.apiKey } : {}),
          ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        });
        this.embeddingModelId = undefined; // Anthropic has no embeddings API
        break;
      case 'openai':
        this.factory = createOpenAI({
          ...(config.apiKey ? { apiKey: config.apiKey } : {}),
          ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        });
        this.embeddingModelId = config.embeddingModel ?? 'text-embedding-3-small';
        break;
      case 'google':
        this.factory = createGoogleGenerativeAI({
          ...(config.apiKey ? { apiKey: config.apiKey } : {}),
          ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        });
        this.embeddingModelId = config.embeddingModel ?? 'text-embedding-004';
        break;
      case 'bedrock':
        this.factory = createAmazonBedrock({
          ...(config.region ? { region: config.region } : {}),
          ...(config.apiKey ? { apiKey: config.apiKey } : {}),
          ...(config.accessKeyId ? { accessKeyId: config.accessKeyId } : {}),
          ...(config.secretAccessKey ? { secretAccessKey: config.secretAccessKey } : {}),
          ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
        }) as unknown as ProviderFactory;
        this.embeddingModelId = config.embeddingModel ?? 'amazon.titan-embed-text-v2:0';
        break;
      case 'openai-compatible': {
        if (!config.baseURL) {
          throw new Error(`openai-compatible provider '${config.id}' requires a baseURL`);
        }
        this.factory = createOpenAICompatible({
          name: config.id,
          baseURL: config.baseURL,
          ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        }) as unknown as ProviderFactory;
        this.embeddingModelId = config.embeddingModel ?? 'nomic-embed-text';
        break;
      }
      default: {
        const _exhaustive: never = config.kind;
        throw new Error(`Unknown AI SDK provider kind: ${String(_exhaustive)}`);
      }
    }
  }

  async *chat(params: ChatParams): AsyncIterable<ChatEvent> {
    const model = this.factory.languageModel(params.model);
    const messages = toModelMessages(params.messages);
    const system = resolveSystemPrompt(params);
    const tools = params.tools?.length ? toAiSdkTools(params.tools) : undefined;

    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const result = streamText({
        model,
        messages,
        ...(system ? { system } : {}),
        ...(tools ? { tools } : {}),
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
        ...(params.maxTokens != null ? { maxOutputTokens: params.maxTokens } : {}),
        // Honor cancellation (W2). The AI SDK aborts the underlying fetch.
        ...(params.signal ? { abortSignal: params.signal } : {}),
      });

      // Track open tool-call ids so a stream `error`/`abort` can still close
      // any dangling tool_call_start (keeps the event grammar balanced).
      const openToolCalls = new Set<string>();

      for await (const part of result.fullStream as AsyncIterable<TextStreamPart<ToolSet>>) {
        switch (part.type) {
          case 'reasoning-delta':
            if (part.text) yield { type: 'thinking', content: part.text };
            break;

          case 'text-delta':
            if (part.text) yield { type: 'text_delta', content: part.text };
            break;

          case 'tool-input-start':
            openToolCalls.add(part.id);
            yield { type: 'tool_call_start', id: part.id, tool: part.toolName, input: {} };
            break;

          case 'tool-input-delta':
            yield { type: 'tool_call_delta', id: part.id, input: part.delta };
            break;

          case 'tool-input-end':
            if (openToolCalls.has(part.id)) {
              openToolCalls.delete(part.id);
              yield { type: 'tool_call_end', id: part.id };
            }
            break;

          case 'tool-call': {
            // Some models emit a single `tool-call` without granular input
            // deltas. Synthesize the start→delta→end sequence so downstream
            // consumers always see the full tool-call grammar.
            if (!openToolCalls.has(part.toolCallId)) {
              yield { type: 'tool_call_start', id: part.toolCallId, tool: part.toolName, input: {} };
              const serialized = JSON.stringify(part.input ?? {});
              if (serialized && serialized !== '{}') {
                yield { type: 'tool_call_delta', id: part.toolCallId, input: serialized };
              }
              yield { type: 'tool_call_end', id: part.toolCallId };
            }
            break;
          }

          case 'finish':
            inputTokens = part.totalUsage.inputTokens ?? inputTokens;
            outputTokens = part.totalUsage.outputTokens ?? outputTokens;
            break;

          case 'error': {
            // Close any dangling tool calls, then surface the error.
            for (const id of openToolCalls) yield { type: 'tool_call_end', id };
            openToolCalls.clear();
            const message =
              part.error instanceof Error
                ? part.error.message
                : typeof part.error === 'string'
                  ? part.error
                  : 'AI SDK streaming error';
            yield { type: 'error', message };
            return;
          }

          case 'abort':
            // Cancelled via signal (W2): close tool calls and finalize as
            // interrupted. The loop/route decides how to persist.
            for (const id of openToolCalls) yield { type: 'tool_call_end', id };
            openToolCalls.clear();
            yield { type: 'done', usage: { inputTokens, outputTokens }, stopReason: 'interrupted' };
            return;

          default:
            // start, start-step, finish-step, text-start/end, reasoning-start/end,
            // source, file, raw, etc. — not part of Hearth's event grammar.
            break;
        }
      }

      yield { type: 'done', usage: { inputTokens, outputTokens } };
    } catch (err) {
      // A thrown abort (signal fired before/at stream creation) finalizes as
      // interrupted; anything else is a real error.
      if (isAbortError(err) || params.signal?.aborted) {
        yield { type: 'done', usage: { inputTokens, outputTokens }, stopReason: 'interrupted' };
        return;
      }
      const message = err instanceof Error ? err.message : `${this.name} API error`;
      yield { type: 'error', message };
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.factory.textEmbeddingModel || !this.embeddingModelId) {
      throw new Error(`Provider '${this.id}' (${this.kind}) does not support embeddings`);
    }
    const model = this.factory.textEmbeddingModel(this.embeddingModelId);
    const { embeddings } = await embedMany({
      model,
      values: texts,
      ...(this.embeddingDimensions != null ? { dimensions: this.embeddingDimensions } : {}),
    });
    return embeddings;
  }

  async listModels(): Promise<string[]> {
    // The catalog (model-catalog.ts) is the source of truth for available
    // models; the AI SDK providers don't expose a uniform list endpoint.
    return [];
  }
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || err.name === 'TimeoutError' || /abort/i.test(err.message))
  );
}

function resolveSystemPrompt(params: ChatParams): string | undefined {
  if (params.systemPrompt) return params.systemPrompt;
  const sysMsg = params.messages.find((m) => m.role === 'system');
  if (!sysMsg) return undefined;
  return getTextContent(sysMsg.content);
}

/** Convert Hearth `LLMMessage[]` → AI SDK `ModelMessage[]`. */
function toModelMessages(messages: LLMMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue; // handled via `system`

    if (msg.role === 'tool') {
      result.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: msg.toolCallId ?? '',
            toolName: '',
            output: { type: 'text', value: getTextContent(msg.content) },
          },
        ],
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = [];
      const text = getTextContent(msg.content);
      if (text) parts.push({ type: 'text', text });
      if (msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
          parts.push({ type: 'tool-call', toolCallId: tc.id, toolName: tc.name, input: tc.input });
        }
      }
      result.push({
        role: 'assistant',
        content: (parts.length ? parts : [{ type: 'text', text: '' }]) as never,
      });
      continue;
    }

    // user
    if (Array.isArray(msg.content)) {
      result.push({
        role: 'user',
        content: msg.content.map((part: ContentPart) => {
          if (part.type === 'image') {
            return {
              type: 'image' as const,
              image: part.data, // base64 (no data: prefix)
              mediaType: part.mimeType,
            };
          }
          return { type: 'text' as const, text: part.text };
        }) as never,
      });
    } else {
      result.push({ role: 'user', content: msg.content });
    }
  }

  return result;
}

/** Convert Hearth tool definitions → an AI SDK `ToolSet` (no executors; the
 *  Hearth agent loop runs tools itself and feeds results back as tool messages). */
function toAiSdkTools(tools: ToolDefinition[]): ToolSet {
  const set: ToolSet = {};
  for (const t of tools) {
    set[t.name] = tool({
      description: t.description,
      inputSchema: jsonSchema(t.inputSchema),
    });
  }
  return set;
}
