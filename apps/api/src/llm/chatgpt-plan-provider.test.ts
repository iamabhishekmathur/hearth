import { describe, it, expect, vi } from 'vitest';
import type { ChatEvent, ChatParams } from '@hearth/shared';
import { CHATGPT_PLAN_ERROR_CODES } from '@hearth/shared';
import {
  ChatGPTPlanProvider,
  buildResponsesRequest,
  toResponsesInput,
  mapPlanError,
} from './chatgpt-plan-provider.js';

const params: ChatParams = {
  model: 'gpt-6.1-sol',
  messages: [{ role: 'user', content: 'hi' }],
  temperature: 0.2,
  maxTokens: 500,
  systemPrompt: 'You are Hearth.',
};

function sse(events: Array<Record<string, unknown>>): Response {
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const enc = new TextEncoder();
  // Split into odd-sized chunks to exercise the SSE buffer.
  const bytes = enc.encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 37) controller.enqueue(bytes.slice(i, i + 37));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function provider(
  fetchImpl: typeof fetch,
  extra: Partial<ConstructorParameters<typeof ChatGPTPlanProvider>[0]> = {},
) {
  return new ChatGPTPlanProvider({
    apiBaseUrl: 'https://api.openai.com/v1',
    getAccessToken: async () => 'tok_123',
    fetchImpl,
    ...extra,
  });
}

describe('buildResponsesRequest', () => {
  it('always sets store:false + stream:true and drops fields the plan flow rejects', () => {
    const body = buildResponsesRequest(params);
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    for (const banned of [
      'temperature',
      'max_output_tokens',
      'previous_response_id',
      'user',
      'metadata',
      'background',
    ]) {
      expect(body).not.toHaveProperty(banned);
    }
    expect(body.instructions).toBe('You are Hearth.');
  });

  it('never sends role:system input items — folds them into instructions', () => {
    const { instructions, input } = toResponsesInput([
      { role: 'system', content: 'sys rules' },
      { role: 'user', content: 'q' },
    ]);
    expect(instructions).toBe('sys rules');
    expect(input.some((i) => i.role === 'system')).toBe(false);
  });

  it('maps tool calls/results and images to Responses items', () => {
    const { input } = toResponsesInput([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'image', mimeType: 'image/png', data: 'AAA' },
        ],
      },
      {
        role: 'assistant',
        content: 'checking',
        toolCalls: [{ id: 'call_1', name: 'search', input: { q: 'x' } }],
      },
      { role: 'tool', content: 'result', toolCallId: 'call_1' },
    ]);
    expect(input[0]).toEqual({
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: 'look' },
        { type: 'input_image', image_url: 'data:image/png;base64,AAA' },
      ],
    });
    expect(input[2]).toEqual({
      type: 'function_call',
      call_id: 'call_1',
      name: 'search',
      arguments: '{"q":"x"}',
    });
    expect(input[3]).toEqual({ type: 'function_call_output', call_id: 'call_1', output: 'result' });
  });

  it('maps tool definitions to function tools', () => {
    const body = buildResponsesRequest({
      ...params,
      tools: [{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }],
    });
    expect(body.tools).toEqual([
      {
        type: 'function',
        name: 'search',
        description: 'Search',
        parameters: { type: 'object' },
        strict: false,
      },
    ]);
  });
});

describe('ChatGPTPlanProvider.chat', () => {
  it('streams text and finishes with usage on response.completed', async () => {
    const fetchImpl = vi.fn(async () =>
      sse([
        { type: 'response.created' },
        { type: 'response.output_text.delta', delta: 'Hello, ' },
        { type: 'response.output_text.delta', delta: 'world!' },
        { type: 'response.completed', response: { usage: { input_tokens: 12, output_tokens: 4 } } },
      ]),
    ) as unknown as typeof fetch;
    const events = await collect(provider(fetchImpl).chat(params));
    expect(events).toEqual([
      { type: 'text_delta', content: 'Hello, ' },
      { type: 'text_delta', content: 'world!' },
      { type: 'done', usage: { inputTokens: 12, outputTokens: 4 } },
    ]);
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_123');
  });

  it('emits a balanced tool-call grammar keyed by call_id', async () => {
    const fetchImpl = (async () =>
      sse([
        {
          type: 'response.output_item.added',
          item: { type: 'function_call', id: 'fc_1', call_id: 'call_9', name: 'search' },
        },
        { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"q":' },
        { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '"x"}' },
        { type: 'response.output_item.done', item: { type: 'function_call', id: 'fc_1' } },
        { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } },
      ])) as unknown as typeof fetch;
    const events = await collect(provider(fetchImpl).chat(params));
    expect(events.slice(0, 4)).toEqual([
      { type: 'tool_call_start', id: 'call_9', tool: 'search', input: {} },
      { type: 'tool_call_delta', id: 'call_9', input: '{"q":' },
      { type: 'tool_call_delta', id: 'call_9', input: '"x"}' },
      { type: 'tool_call_end', id: 'call_9' },
    ]);
  });

  it('surfaces a usage-limit failure that arrives AFTER text started, and records it', async () => {
    const onUsageLimit = vi.fn();
    const fetchImpl = (async () =>
      sse([
        { type: 'response.output_text.delta', delta: 'partial' },
        {
          type: 'response.failed',
          response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } },
        },
      ])) as unknown as typeof fetch;
    const events = await collect(provider(fetchImpl, { onUsageLimit }).chat(params));
    expect(events[0]).toEqual({ type: 'text_delta', content: 'partial' });
    expect(events[1]).toMatchObject({ type: 'error', code: CHATGPT_PLAN_ERROR_CODES.usageLimit });
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(onUsageLimit).toHaveBeenCalledOnce();
  });

  it('treats a stream that ends without response.completed as an error', async () => {
    const fetchImpl = (async () =>
      sse([{ type: 'response.output_text.delta', delta: 'cut off' }])) as unknown as typeof fetch;
    const events = await collect(provider(fetchImpl).chat(params));
    expect(events.at(-1)).toMatchObject({ type: 'error' });
  });

  it('maps 401 to a reconnect error (no fallback)', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    const events = await collect(provider(fetchImpl).chat(params));
    expect(events).toEqual([
      expect.objectContaining({ type: 'error', code: CHATGPT_PLAN_ERROR_CODES.reauth }),
    ]);
  });

  it('maps a non-stream usage-limit HTTP error', async () => {
    const onUsageLimit = vi.fn();
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }),
        { status: 429 },
      )) as unknown as typeof fetch;
    const events = await collect(provider(fetchImpl, { onUsageLimit }).chat(params));
    expect(events[0]).toMatchObject({ code: CHATGPT_PLAN_ERROR_CODES.usageLimit });
    expect(onUsageLimit).toHaveBeenCalled();
  });

  it('reports not-connected when there is no credential', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const p = provider(fetchImpl, {
      getAccessToken: async () => {
        throw Object.assign(new Error('nope'), { code: 'not_connected' });
      },
    });
    const events = await collect(p.chat(params));
    expect(events).toEqual([
      expect.objectContaining({ code: CHATGPT_PLAN_ERROR_CODES.notConnected }),
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('finalizes as interrupted when aborted', async () => {
    const ac = new AbortController();
    const fetchImpl = (async () => {
      ac.abort();
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }) as unknown as typeof fetch;
    const events = await collect(provider(fetchImpl).chat({ ...params, signal: ac.signal }));
    expect(events).toEqual([
      { type: 'done', usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'interrupted' },
    ]);
  });
});

describe('mapPlanError', () => {
  it('maps unavailable', () => {
    expect(mapPlanError('subscription_sharing_usage_unavailable', undefined)).toMatchObject({
      code: CHATGPT_PLAN_ERROR_CODES.unavailable,
    });
  });
  it('passes through unknown errors without a code', () => {
    expect(mapPlanError('server_error', 'boom')).toEqual({ type: 'error', message: 'boom' });
  });
});
