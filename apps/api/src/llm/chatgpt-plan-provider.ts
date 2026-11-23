/**
 * LLM provider that spends the signed-in user's ChatGPT plan via the OpenAI
 * Responses API, using the OAuth access token from Sign in with ChatGPT.
 *
 * Constraints from OpenAI's docs (models-and-inference, preview-limitations):
 * - every request: `store: false`, `stream: true`
 * - omit temperature / max_output_tokens / previous_response_id / user / … —
 *   those fields are rejected, so Hearth's maxTokens/temperature are dropped
 * - no `role: "system"` input items → system prompt goes in `instructions`
 * - full history is resent each turn (no server-side conversation state)
 * - success only on `response.completed`; `response.failed` can arrive after
 *   output has started (usage-limit errors)
 *
 * It never throws for provider errors — it yields a coded `error` event — so
 * the registry never silently falls back to the org's API key.
 */
import type { ChatEvent, ChatParams, LLMMessage } from '@hearth/shared';
import { CHATGPT_PLAN_ERROR_CODES, CHATGPT_PLAN_PROVIDER_ID, getTextContent } from '@hearth/shared';
import type { LLMProvider } from './types.js';
import { logger } from '../lib/logger.js';

export interface ChatGPTPlanProviderDeps {
  /** Resolve a fresh access token for the user (refreshing if needed). */
  getAccessToken: () => Promise<string>;
  /** Called when the plan's usage cap is hit (for "Manage usage" UX state). */
  onUsageLimit?: () => void | Promise<void>;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
}

type ResponseInputItem = Record<string, unknown>;

/** Hearth messages → Responses API `input` items (+ collected instructions). */
export function toResponsesInput(
  messages: LLMMessage[],
  systemPrompt?: string,
): { instructions?: string; input: ResponseInputItem[] } {
  const systemParts: string[] = [];
  if (systemPrompt) systemParts.push(systemPrompt);
  const input: ResponseInputItem[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Explicit system items are rejected; fold into instructions.
      if (!systemPrompt) systemParts.push(getTextContent(msg.content));
      continue;
    }

    if (msg.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: msg.toolCallId ?? '',
        output: getTextContent(msg.content),
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const text = getTextContent(msg.content);
      if (text) input.push({ type: 'message', role: 'assistant', content: text });
      for (const tc of msg.toolCalls ?? []) {
        input.push({
          type: 'function_call',
          call_id: tc.id,
          name: tc.name,
          arguments: JSON.stringify(tc.input ?? {}),
        });
      }
      continue;
    }

    // user
    if (Array.isArray(msg.content)) {
      input.push({
        type: 'message',
        role: 'user',
        content: msg.content.map((part) =>
          part.type === 'image'
            ? { type: 'input_image', image_url: `data:${part.mimeType};base64,${part.data}` }
            : { type: 'input_text', text: part.text },
        ),
      });
    } else {
      input.push({ type: 'message', role: 'user', content: msg.content });
    }
  }

  const instructions = systemParts.filter(Boolean).join('\n\n');
  return { ...(instructions ? { instructions } : {}), input };
}

/** Build the request body. Only fields the plan-usage flow accepts. */
export function buildResponsesRequest(params: ChatParams): Record<string, unknown> {
  const { instructions, input } = toResponsesInput(params.messages, params.systemPrompt);
  return {
    model: params.model,
    ...(instructions ? { instructions } : {}),
    input,
    ...(params.tools?.length
      ? {
          tools: params.tools.map((t) => ({
            type: 'function',
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
            strict: false,
          })),
        }
      : {}),
    store: false,
    stream: true,
  };
}

/** Map a Responses error code to Hearth's coded error event. */
export function mapPlanError(code: string | undefined, message: string | undefined): ChatEvent {
  switch (code) {
    case 'subscription_sharing_usage_limit_exceeded':
      return {
        type: 'error',
        code: CHATGPT_PLAN_ERROR_CODES.usageLimit,
        message: 'You’ve reached the usage limit for your ChatGPT plan in Hearth.',
      };
    case 'subscription_sharing_usage_unavailable':
      return {
        type: 'error',
        code: CHATGPT_PLAN_ERROR_CODES.unavailable,
        message: 'ChatGPT plan usage isn’t available for this account right now.',
      };
    default:
      return { type: 'error', message: message || code || 'ChatGPT request failed' };
  }
}

/** Minimal SSE parser over a fetch body. Yields parsed `data:` JSON payloads. */
async function* readSse(body: ReadableStream<Uint8Array>): AsyncIterable<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (!data || data === '[DONE]') continue;
        try {
          yield JSON.parse(data) as Record<string, unknown>;
        } catch {
          // ignore keep-alives / malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class ChatGPTPlanProvider implements LLMProvider {
  readonly id = CHATGPT_PLAN_PROVIDER_ID;
  readonly name = 'ChatGPT plan';

  constructor(private readonly deps: ChatGPTPlanProviderDeps) {}

  async listModels(): Promise<string[]> {
    return [];
  }

  async *chat(params: ChatParams): AsyncIterable<ChatEvent> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    let inputTokens = 0;
    let outputTokens = 0;
    const openToolCalls = new Map<string, string>(); // item_id → call_id

    const closeOpen = function* (): Iterable<ChatEvent> {
      for (const callId of openToolCalls.values()) yield { type: 'tool_call_end', id: callId };
      openToolCalls.clear();
    };

    let token: string;
    try {
      token = await this.deps.getAccessToken();
    } catch (err) {
      const code = (err as { code?: string }).code;
      yield {
        type: 'error',
        code:
          code === 'not_connected'
            ? CHATGPT_PLAN_ERROR_CODES.notConnected
            : CHATGPT_PLAN_ERROR_CODES.reauth,
        message:
          code === 'not_connected'
            ? 'Connect your ChatGPT account to use your ChatGPT plan.'
            : 'Your ChatGPT connection expired. Reconnect to keep using your ChatGPT plan.',
      };
      return;
    }

    try {
      const res = await fetchImpl(`${this.deps.apiBaseUrl.replace(/\/$/, '')}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(buildResponsesRequest(params)),
        ...(params.signal ? { signal: params.signal } : {}),
      });

      if (res.status === 401) {
        yield {
          type: 'error',
          code: CHATGPT_PLAN_ERROR_CODES.reauth,
          message: 'Your ChatGPT connection expired. Reconnect to keep using your ChatGPT plan.',
        };
        return;
      }
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        const ev = mapPlanError(body.error?.code, body.error?.message ?? `HTTP ${res.status}`);
        if (ev.type === 'error' && ev.code === CHATGPT_PLAN_ERROR_CODES.usageLimit)
          await this.deps.onUsageLimit?.();
        yield ev;
        return;
      }

      let completed = false;
      for await (const evt of readSse(res.body)) {
        const type = evt.type as string | undefined;
        switch (type) {
          case 'response.output_text.delta':
            if (typeof evt.delta === 'string' && evt.delta)
              yield { type: 'text_delta', content: evt.delta };
            break;

          case 'response.reasoning_summary_text.delta':
          case 'response.reasoning_text.delta':
            if (typeof evt.delta === 'string' && evt.delta)
              yield { type: 'thinking', content: evt.delta };
            break;

          case 'response.output_item.added': {
            const item = evt.item as
              | { type?: string; id?: string; call_id?: string; name?: string }
              | undefined;
            if (item?.type === 'function_call' && item.id) {
              const callId = item.call_id ?? item.id;
              openToolCalls.set(item.id, callId);
              yield { type: 'tool_call_start', id: callId, tool: item.name ?? '', input: {} };
            }
            break;
          }

          case 'response.function_call_arguments.delta': {
            const callId = openToolCalls.get(evt.item_id as string);
            if (callId && typeof evt.delta === 'string') {
              yield { type: 'tool_call_delta', id: callId, input: evt.delta };
            }
            break;
          }

          case 'response.output_item.done': {
            const item = evt.item as { type?: string; id?: string } | undefined;
            if (item?.type === 'function_call' && item.id && openToolCalls.has(item.id)) {
              yield { type: 'tool_call_end', id: openToolCalls.get(item.id)! };
              openToolCalls.delete(item.id);
            }
            break;
          }

          case 'response.completed': {
            const usage = (
              evt.response as { usage?: { input_tokens?: number; output_tokens?: number } }
            )?.usage;
            inputTokens = usage?.input_tokens ?? inputTokens;
            outputTokens = usage?.output_tokens ?? outputTokens;
            completed = true;
            // No content or tokens: model + usage only, for operating the feature.
            logger.info(
              { provider: this.id, userId: params.userId, model: params.model, inputTokens, outputTokens },
              'ChatGPT plan response completed',
            );
            break;
          }

          case 'response.failed': {
            yield* closeOpen();
            const error = (evt.response as { error?: { code?: string; message?: string } })?.error;
            const ev = mapPlanError(error?.code, error?.message);
            if (ev.type === 'error' && ev.code === CHATGPT_PLAN_ERROR_CODES.usageLimit)
              await this.deps.onUsageLimit?.();
            yield ev;
            return;
          }

          case 'response.incomplete': {
            yield* closeOpen();
            const reason = (evt.response as { incomplete_details?: { reason?: string } })
              ?.incomplete_details?.reason;
            yield {
              type: 'error',
              message: `ChatGPT response was incomplete${reason ? ` (${reason})` : ''}.`,
            };
            return;
          }

          case 'error': {
            yield* closeOpen();
            const ev = mapPlanError(
              evt.code as string | undefined,
              evt.message as string | undefined,
            );
            if (ev.type === 'error' && ev.code === CHATGPT_PLAN_ERROR_CODES.usageLimit)
              await this.deps.onUsageLimit?.();
            yield ev;
            return;
          }

          default:
            break;
        }
      }

      yield* closeOpen();
      if (!completed) {
        if (params.signal?.aborted) {
          yield { type: 'done', usage: { inputTokens, outputTokens }, stopReason: 'interrupted' };
          return;
        }
        // Text may have streamed, but without response.completed it isn't a success.
        yield { type: 'error', message: 'ChatGPT stream ended before the response completed.' };
        return;
      }
      yield { type: 'done', usage: { inputTokens, outputTokens } };
    } catch (err) {
      yield* closeOpen();
      if (params.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        yield { type: 'done', usage: { inputTokens, outputTokens }, stopReason: 'interrupted' };
        return;
      }
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : 'ChatGPT request failed',
      };
    }
  }
}
