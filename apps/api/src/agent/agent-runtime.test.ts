import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatEvent } from '@hearth/shared';
import type { AgentContext } from './types.js';

// Mock the provider-registry module
vi.mock('../llm/provider-registry.js', () => ({
  providerRegistry: {
    chatWithFallback: vi.fn(),
  },
}));

// Mock the tool-router module
vi.mock('./tool-router.js', () => ({
  executeTool: vi.fn(),
}));

// Mock the model catalog — the loop now validates the model via resolveModel.
// The factory is hoisted, so the error class + known-set live inside it.
vi.mock('../llm/model-catalog.js', () => {
  class UnknownModelError extends Error {
    readonly code = 'UNKNOWN_MODEL';
    constructor(public readonly modelId: string) {
      super(`Unknown model '${modelId}'`);
      this.name = 'UnknownModelError';
    }
  }
  const known = new Set(['claude-sonnet-4-6', 'claude-opus-4-8', 'gpt-4o']);
  return {
    UnknownModelError,
    resolveModel: vi.fn((id: string) => {
      if (!known.has(id)) throw new UnknownModelError(id);
      return { id, providerId: 'anthropic', contextWindow: 1_000_000, caps: { vision: true, tools: true, reasoning: true } };
    }),
  };
});

// Mock prisma — org default model lookup; default: no org default (null).
const orgSettingsRef: { settings: Record<string, unknown> | null } = { settings: {} };
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    org: {
      findUnique: vi.fn(async () => ({ settings: orgSettingsRef.settings })),
    },
  },
}));

// No-op usage metering.
vi.mock('../extensions/usage-metering.js', () => ({
  getUsageRecorder: () => null,
}));

import { agentLoop } from './agent-runtime.js';
import { providerRegistry } from '../llm/provider-registry.js';
import { executeTool } from './tool-router.js';

const mockedChatWithFallback = vi.mocked(providerRegistry.chatWithFallback);
const mockedExecuteTool = vi.mocked(executeTool);

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    userId: 'user-1',
    orgId: 'org-1',
    teamId: null,
    sessionId: 'session-1',
    systemPrompt: 'You are helpful.',
    tools: [],
    ...overrides,
  };
}

async function* streamEvents(events: ChatEvent[]): AsyncGenerator<ChatEvent> {
  for (const event of events) {
    yield event;
  }
}

async function collectEvents(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const result: ChatEvent[] = [];
  for await (const event of gen) {
    result.push(event);
  }
  return result;
}

function tool(name = 'search') {
  return { name, description: `${name} tool`, inputSchema: { type: 'object' }, handler: vi.fn() };
}

describe('agentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgSettingsRef.settings = {};
  });

  it('yields text_delta events then done{stopReason:done} for a simple text response', async () => {
    mockedChatWithFallback.mockReturnValue(
      streamEvents([
        { type: 'text_delta', content: 'Hello' },
        { type: 'text_delta', content: ' world' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
      ]),
    );

    const events = await collectEvents(agentLoop(makeContext(), [{ role: 'user', content: 'Hi' }]));

    expect(events).toEqual([
      { type: 'text_delta', content: 'Hello' },
      { type: 'text_delta', content: ' world' },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'done' },
    ]);
    expect(mockedChatWithFallback).toHaveBeenCalledTimes(1);
  });

  it('handles tool call flow: yields tool events, executes tool, makes second LLM call', async () => {
    mockedExecuteTool.mockResolvedValue({ output: { result: 'mock' } });

    mockedChatWithFallback.mockReturnValueOnce(
      streamEvents([
        { type: 'tool_call_start', id: 'tc-1', tool: 'search', input: {} },
        { type: 'tool_call_delta', id: 'tc-1', input: '{"q":"foo"}' },
        { type: 'tool_call_end', id: 'tc-1' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
      ]),
    );
    mockedChatWithFallback.mockReturnValueOnce(
      streamEvents([
        { type: 'text_delta', content: 'Found it' },
        { type: 'done', usage: { inputTokens: 20, outputTokens: 10 } },
      ]),
    );

    const events = await collectEvents(
      agentLoop(makeContext({ tools: [tool()] }), [{ role: 'user', content: 'search for foo' }]),
    );

    expect(events).toEqual([
      { type: 'tool_call_start', id: 'tc-1', tool: 'search', input: {} },
      { type: 'tool_call_delta', id: 'tc-1', input: '{"q":"foo"}' },
      { type: 'tool_call_end', id: 'tc-1' },
      { type: 'tool_progress', toolCallId: 'tc-1', toolName: 'search', status: 'started' },
      { type: 'tool_progress', toolCallId: 'tc-1', toolName: 'search', status: 'completed', durationMs: expect.any(Number) },
      { type: 'text_delta', content: 'Found it' },
      { type: 'done', usage: { inputTokens: 20, outputTokens: 10 }, stopReason: 'done' },
    ]);
    expect(mockedExecuteTool).toHaveBeenCalledOnce();
    // Signal is threaded (undefined here — no abort).
    expect(mockedExecuteTool).toHaveBeenCalledWith('search', { q: 'foo' }, expect.any(Map), 'user-1', undefined);
  });

  it('yields error + done{error} when the LLM streams an error event', async () => {
    mockedChatWithFallback.mockReturnValue(
      streamEvents([
        { type: 'text_delta', content: 'partial' },
        { type: 'error', message: 'rate limit exceeded' },
      ]),
    );

    const events = await collectEvents(agentLoop(makeContext(), [{ role: 'user', content: 'Hi' }]));

    expect(events[0]).toEqual({ type: 'text_delta', content: 'partial' });
    expect(events[1]).toEqual({ type: 'error', message: 'rate limit exceeded' });
    expect(events[2]).toEqual({ type: 'done', usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'error' });
  });

  it('uses the provided model from context and passes the abort signal', async () => {
    mockedChatWithFallback.mockReturnValue(
      streamEvents([
        { type: 'text_delta', content: 'ok' },
        { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
      ]),
    );
    const ctl = new AbortController();

    await collectEvents(agentLoop(makeContext({ model: 'gpt-4o', abortSignal: ctl.signal }), [{ role: 'user', content: 't' }]));

    expect(mockedChatWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o', signal: ctl.signal }),
      undefined,
    );
  });

  // ── §5.1 case 2 (headline): unknown model surfaces an error, no silent fallback ──
  it('surfaces UnknownModelError as error + done{error} — no silent fallback', async () => {
    const events = await collectEvents(
      agentLoop(makeContext({ model: 'claude-haiku-4-5' }), [{ role: 'user', content: 'hi' }]),
    );
    expect(events[0].type).toBe('error');
    expect((events[0] as { message: string }).message).toContain('claude-haiku-4-5');
    expect(events[1]).toEqual({ type: 'done', usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'error' });
    // The provider was never called — no answer produced on a different model.
    expect(mockedChatWithFallback).not.toHaveBeenCalled();
  });

  it('uses the org default model when no request model is set', async () => {
    orgSettingsRef.settings = { defaultModel: 'claude-opus-4-8' };
    mockedChatWithFallback.mockReturnValue(
      streamEvents([{ type: 'text_delta', content: 'ok' }, { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } }]),
    );

    await collectEvents(agentLoop(makeContext(), [{ role: 'user', content: 't' }]));

    expect(mockedChatWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-8' }),
      undefined,
    );
  });

  // ── §5.1 case 11: abort mid-stream ──
  it('case 11: an aborted signal stops the loop and emits done{interrupted}', async () => {
    const ctl = new AbortController();
    // Provider stream that aborts partway: emit one delta, then the controller
    // fires, then the stream ends (mimicking a provider honoring the signal).
    mockedChatWithFallback.mockImplementation(() =>
      (async function* () {
        yield { type: 'text_delta', content: 'partial answer' } as ChatEvent;
        ctl.abort();
        // Provider stops yielding once aborted.
      })(),
    );

    const events = await collectEvents(
      agentLoop(makeContext({ abortSignal: ctl.signal }), [{ role: 'user', content: 'long task' }]),
    );

    expect(events.some((e) => e.type === 'text_delta')).toBe(true);
    const done = events[events.length - 1];
    expect(done).toEqual({ type: 'done', usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'interrupted' });
  });

  it('case 11b: an already-aborted signal finishes immediately as interrupted', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const events = await collectEvents(
      agentLoop(makeContext({ abortSignal: ctl.signal }), [{ role: 'user', content: 'x' }]),
    );
    expect(events).toEqual([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'interrupted' }]);
    expect(mockedChatWithFallback).not.toHaveBeenCalled();
  });

  it('case 11c: abort before a tool fires discards tool work and interrupts', async () => {
    const ctl = new AbortController();
    mockedExecuteTool.mockResolvedValue({ output: {} });
    mockedChatWithFallback.mockImplementation(() =>
      (async function* () {
        yield { type: 'tool_call_start', id: 'tc-1', tool: 'search', input: {} } as ChatEvent;
        yield { type: 'tool_call_end', id: 'tc-1' } as ChatEvent;
        yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } } as ChatEvent;
        // Abort *after* the stream, before the loop's pre-tool checkpoint.
        ctl.abort();
      })(),
    );

    const events = await collectEvents(
      agentLoop(makeContext({ tools: [tool()], abortSignal: ctl.signal }), [{ role: 'user', content: 'go' }]),
    );

    const done = events[events.length - 1];
    expect(done).toEqual({ type: 'done', usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'interrupted' });
    // Tool never executed (aborted at the checkpoint).
    expect(mockedExecuteTool).not.toHaveBeenCalled();
  });

  // ── §5.1 case 14: doom-loop detection ──
  it('case 14: 3 identical tool fingerprints → warning + toolless summary, no 4th tool call', async () => {
    mockedExecuteTool.mockResolvedValue({ output: { result: 'same-every-time' } });

    let toolCalls = 0;
    mockedChatWithFallback.mockImplementation(() => {
      toolCalls++;
      if (toolCalls <= 10) {
        return streamEvents([
          { type: 'tool_call_start', id: 'tc', tool: 'loop_tool', input: {} },
          { type: 'tool_call_delta', id: 'tc', input: '{"q":"x"}' },
          { type: 'tool_call_end', id: 'tc' },
          { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
        ]);
      }
      return streamEvents([
        { type: 'text_delta', content: 'summary' },
        { type: 'done', usage: { inputTokens: 2, outputTokens: 2 } },
      ]);
    });

    const events = await collectEvents(
      agentLoop(makeContext({ tools: [tool('loop_tool')] }), [{ role: 'user', content: 'loop' }]),
    );

    expect(events.some((e) => e.type === 'warning')).toBe(true);
    const done = events[events.length - 1];
    expect(done.type).toBe('done');
    // 3 identical iterations then the summary call = 4 provider calls total.
    expect(mockedChatWithFallback).toHaveBeenCalledTimes(4);
    // Exactly 3 tool executions — the loop broke before a 4th.
    expect(mockedExecuteTool).toHaveBeenCalledTimes(3);
  });

  // ── §5.1 case 15: graceful degradation at the iteration cap ──
  it('case 15: maxIterations reached → graceful summary (not a thrown error)', async () => {
    mockedExecuteTool.mockImplementation(async (_n, input) => ({ output: { echoed: input } }));

    let call = 0;
    // Every iteration returns a *different* tool input so doom-loop doesn't fire;
    // we hit the iteration cap instead.
    mockedChatWithFallback.mockImplementation(() => {
      call++;
      if (call <= 3) {
        return streamEvents([
          { type: 'tool_call_start', id: `tc${call}`, tool: 'step', input: {} },
          { type: 'tool_call_delta', id: `tc${call}`, input: `{"n":${call}}` },
          { type: 'tool_call_end', id: `tc${call}` },
          { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
        ]);
      }
      return streamEvents([
        { type: 'text_delta', content: 'final summary' },
        { type: 'done', usage: { inputTokens: 3, outputTokens: 2 } },
      ]);
    });

    const events = await collectEvents(
      agentLoop(makeContext({ tools: [tool('step')], maxIterations: 3 }), [{ role: 'user', content: 'go' }]),
    );

    expect(events.some((e) => e.type === 'warning')).toBe(true);
    const done = events[events.length - 1];
    expect(done).toMatchObject({ type: 'done', stopReason: 'max_iterations' });
    // 3 tool iterations + 1 summary call.
    expect(mockedChatWithFallback).toHaveBeenCalledTimes(4);
  });

  // ── §5.1 case 16: per-run token budget ──
  it('case 16: maxTokens budget stops the run with done{budget}', async () => {
    mockedExecuteTool.mockImplementation(async (_n, input) => ({ output: { echoed: input } }));

    let call = 0;
    mockedChatWithFallback.mockImplementation(() => {
      call++;
      // First iteration spends 100 tokens via a tool call, exceeding the budget.
      if (call === 1) {
        return streamEvents([
          { type: 'tool_call_start', id: 'tc1', tool: 'step', input: {} },
          { type: 'tool_call_delta', id: 'tc1', input: '{"n":1}' },
          { type: 'tool_call_end', id: 'tc1' },
          { type: 'done', usage: { inputTokens: 60, outputTokens: 40 } },
        ]);
      }
      // The toolless summary call.
      return streamEvents([
        { type: 'text_delta', content: 'budget summary' },
        { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
      ]);
    });

    const events = await collectEvents(
      agentLoop(makeContext({ tools: [tool('step')], maxTokens: 50 }), [{ role: 'user', content: 'go' }]),
    );

    expect(events.some((e) => e.type === 'warning' && (e as { message: string }).message.includes('budget'))).toBe(true);
    const done = events[events.length - 1];
    expect(done).toMatchObject({ type: 'done', stopReason: 'budget' });
  });

  it('passes thinking events through', async () => {
    mockedChatWithFallback.mockReturnValue(
      streamEvents([
        { type: 'thinking', content: 'Let me think...' },
        { type: 'text_delta', content: 'Answer' },
        { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
      ]),
    );

    const events = await collectEvents(agentLoop(makeContext(), [{ role: 'user', content: 'think' }]));

    expect(events[0]).toEqual({ type: 'thinking', content: 'Let me think...' });
    expect(events[1]).toEqual({ type: 'text_delta', content: 'Answer' });
  });
});
