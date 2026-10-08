import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ChatEvent } from '@hearth/shared';

// ── Mock the Vercel AI SDK so we can feed a recorded fullStream fixture and
//    control embedMany, without any network. We keep the real `tool`/`jsonSchema`
//    helpers (pure) so message/tool conversion is exercised for real.
const streamTextMock = vi.fn();
const embedManyMock = vi.fn();

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: (opts: unknown) => streamTextMock(opts),
    embedMany: (opts: unknown) => embedManyMock(opts),
  };
});

import { AiSdkProvider } from './ai-sdk-provider.js';

/** Build a fake streamText result whose fullStream yields the given parts. */
function fakeStream(parts: unknown[]) {
  return {
    fullStream: (async function* () {
      for (const p of parts) yield p;
    })(),
  };
}

async function collect(iter: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

beforeEach(() => {
  streamTextMock.mockReset();
  embedManyMock.mockReset();
});

describe('AiSdkProvider.chat — event mapping/order', () => {
  // §5.1 case 6 — recorded Anthropic tool-use stream fixture.
  it('emits thinking → text_delta* → tool_call_start/delta/end → done{usage} in order', async () => {
    // A realistic Anthropic extended-thinking + tool-use stream, as the AI SDK
    // surfaces it on fullStream.
    streamTextMock.mockReturnValue(
      fakeStream([
        { type: 'start' },
        { type: 'start-step', request: {}, warnings: [] },
        { type: 'reasoning-start', id: 'r0' },
        { type: 'reasoning-delta', id: 'r0', text: 'Let me think. ' },
        { type: 'reasoning-delta', id: 'r0', text: 'I should look it up.' },
        { type: 'reasoning-end', id: 'r0' },
        { type: 'text-start', id: 't0' },
        { type: 'text-delta', id: 't0', text: 'Checking ' },
        { type: 'text-delta', id: 't0', text: 'the weather.' },
        { type: 'text-end', id: 't0' },
        { type: 'tool-input-start', id: 'tc_1', toolName: 'get_weather' },
        { type: 'tool-input-delta', id: 'tc_1', delta: '{"city":' },
        { type: 'tool-input-delta', id: 'tc_1', delta: '"SF"}' },
        { type: 'tool-input-end', id: 'tc_1' },
        {
          type: 'finish',
          finishReason: 'tool-calls',
          totalUsage: { inputTokens: 42, outputTokens: 13, totalTokens: 55 },
        },
      ]),
    );

    const provider = new AiSdkProvider({ id: 'anthropic', name: 'Anthropic', kind: 'anthropic', apiKey: 'sk-test' });
    const events = await collect(
      provider.chat({ model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'weather in SF?' }] }),
    );

    expect(events).toEqual([
      { type: 'thinking', content: 'Let me think. ' },
      { type: 'thinking', content: 'I should look it up.' },
      { type: 'text_delta', content: 'Checking ' },
      { type: 'text_delta', content: 'the weather.' },
      { type: 'tool_call_start', id: 'tc_1', tool: 'get_weather', input: {} },
      { type: 'tool_call_delta', id: 'tc_1', input: '{"city":' },
      { type: 'tool_call_delta', id: 'tc_1', input: '"SF"}' },
      { type: 'tool_call_end', id: 'tc_1' },
      { type: 'done', usage: { inputTokens: 42, outputTokens: 13 } },
    ]);
  });

  it('synthesizes start/delta/end for a model that emits only a terminal tool-call', async () => {
    streamTextMock.mockReturnValue(
      fakeStream([
        { type: 'tool-call', toolCallId: 'tc_9', toolName: 'search', input: { q: 'hearth' } },
        { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 5, outputTokens: 2 } },
      ]),
    );
    const provider = new AiSdkProvider({ id: 'openai', name: 'OpenAI', kind: 'openai', apiKey: 'k' });
    const events = await collect(
      provider.chat({ model: 'gpt-4o', messages: [{ role: 'user', content: 'go' }] }),
    );
    expect(events).toEqual([
      { type: 'tool_call_start', id: 'tc_9', tool: 'search', input: {} },
      { type: 'tool_call_delta', id: 'tc_9', input: '{"q":"hearth"}' },
      { type: 'tool_call_end', id: 'tc_9' },
      { type: 'done', usage: { inputTokens: 5, outputTokens: 2 } },
    ]);
  });

  it('maps a stream error to an error event and closes dangling tool calls', async () => {
    streamTextMock.mockReturnValue(
      fakeStream([
        { type: 'tool-input-start', id: 'tc_x', toolName: 'foo' },
        { type: 'error', error: new Error('boom') },
      ]),
    );
    const provider = new AiSdkProvider({ id: 'openai', name: 'OpenAI', kind: 'openai', apiKey: 'k' });
    const events = await collect(provider.chat({ model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }] }));
    expect(events).toEqual([
      { type: 'tool_call_start', id: 'tc_x', tool: 'foo', input: {} },
      { type: 'tool_call_end', id: 'tc_x' },
      { type: 'error', message: 'boom' },
    ]);
  });

  it('honors params.signal: an abort part finalizes as done{stopReason:interrupted}', async () => {
    streamTextMock.mockReturnValue(
      fakeStream([
        { type: 'text-delta', id: 't', text: 'partial' },
        { type: 'abort', reason: 'user_stop' },
      ]),
    );
    const provider = new AiSdkProvider({ id: 'anthropic', name: 'Anthropic', kind: 'anthropic', apiKey: 'k' });
    const controller = new AbortController();
    const events = await collect(
      provider.chat({ model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'x' }], signal: controller.signal }),
    );
    expect(events).toEqual([
      { type: 'text_delta', content: 'partial' },
      { type: 'done', usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'interrupted' },
    ]);
    // Signal was forwarded to the SDK.
    expect(streamTextMock.mock.calls[0][0]).toHaveProperty('abortSignal', controller.signal);
  });

  it('forwards system prompt, tools and maxTokens to streamText', async () => {
    streamTextMock.mockReturnValue(fakeStream([{ type: 'finish', finishReason: 'stop', totalUsage: {} }]));
    const provider = new AiSdkProvider({ id: 'anthropic', name: 'Anthropic', kind: 'anthropic', apiKey: 'k' });
    await collect(
      provider.chat({
        model: 'claude-opus-4-8',
        systemPrompt: 'be terse',
        maxTokens: 256,
        temperature: 0.2,
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ name: 'get_x', description: 'gets x', inputSchema: { type: 'object', properties: {} } }],
      }),
    );
    const opts = streamTextMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.system).toBe('be terse');
    expect(opts.maxOutputTokens).toBe(256);
    expect(opts.temperature).toBe(0.2);
    expect(opts.tools).toHaveProperty('get_x');
  });
});

describe('AiSdkProvider.embed', () => {
  // §5.1 case 7 — embedding dimensions match the pgvector column (1536).
  it('maps embed() to embedMany and returns vectors of the configured dimension', async () => {
    const vec = (n: number) => Array.from({ length: n }, (_, i) => i / n);
    embedManyMock.mockResolvedValue({ embeddings: [vec(1536), vec(1536)] });

    const provider = new AiSdkProvider({
      id: 'openai',
      name: 'OpenAI',
      kind: 'openai',
      apiKey: 'k',
      embeddingModel: 'text-embedding-3-small',
      embeddingDimensions: 1536,
    });
    const result = await provider.embed(['a', 'b']);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(1536);

    const opts = embedManyMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.values).toEqual(['a', 'b']);
    expect(opts.dimensions).toBe(1536);
  });

  it('throws for a provider family without embeddings (Anthropic)', async () => {
    const provider = new AiSdkProvider({ id: 'anthropic', name: 'Anthropic', kind: 'anthropic', apiKey: 'k' });
    await expect(provider.embed(['x'])).rejects.toThrow(/does not support embeddings/);
  });
});
