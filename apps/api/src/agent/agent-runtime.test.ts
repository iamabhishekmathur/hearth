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

describe('agentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('yields text_delta events then done for a simple text response', async () => {
    mockedChatWithFallback.mockReturnValue(
      streamEvents([
        { type: 'text_delta', content: 'Hello' },
        { type: 'text_delta', content: ' world' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
      ]),
    );

    const events = await collectEvents(
      agentLoop(makeContext(), [{ role: 'user', content: 'Hi' }]),
    );

    expect(events).toEqual([
      { type: 'text_delta', content: 'Hello' },
      { type: 'text_delta', content: ' world' },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ]);
    expect(mockedChatWithFallback).toHaveBeenCalledTimes(1);
  });

  it('handles tool call flow: yields tool events, executes tool, makes second LLM call', async () => {
    const tool = {
      name: 'search',
      description: 'Search things',
      inputSchema: { type: 'object' },
      handler: vi.fn(),
    };

    mockedExecuteTool.mockResolvedValue({ output: { result: 'mock' } });

    // First LLM call returns a tool call. The runtime accumulates the tool
    // input via tool_call_delta events (streaming), not tool_call_start,
    // so emit a delta with the JSON payload.
    mockedChatWithFallback.mockReturnValueOnce(
      streamEvents([
        { type: 'tool_call_start', id: 'tc-1', tool: 'search', input: {} },
        { type: 'tool_call_delta', id: 'tc-1', input: '{"q":"foo"}' },
        { type: 'tool_call_end', id: 'tc-1' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
      ]),
    );

    // Second LLM call returns final text
    mockedChatWithFallback.mockReturnValueOnce(
      streamEvents([
        { type: 'text_delta', content: 'Found it' },
        { type: 'done', usage: { inputTokens: 20, outputTokens: 10 } },
      ]),
    );

    const events = await collectEvents(
      agentLoop(makeContext({ tools: [tool] }), [{ role: 'user', content: 'search for foo' }]),
    );

    // Should have: tool_call_start, tool_call_delta, tool_call_end from LLM
    // stream, then text_delta from second call, then done.
    // (Execution itself does not re-emit tool events; the LLM stream is the
    // single source of truth for tool_call lifecycle.)
    expect(events).toEqual([
      { type: 'tool_call_start', id: 'tc-1', tool: 'search', input: {} },
      { type: 'tool_call_delta', id: 'tc-1', input: '{"q":"foo"}' },
      { type: 'tool_call_end', id: 'tc-1' },
      { type: 'tool_progress', toolCallId: 'tc-1', toolName: 'search', status: 'started' },
      { type: 'tool_progress', toolCallId: 'tc-1', toolName: 'search', status: 'completed', durationMs: expect.any(Number) },
      { type: 'text_delta', content: 'Found it' },
      { type: 'done', usage: { inputTokens: 20, outputTokens: 10 } },
    ]);

    expect(mockedChatWithFallback).toHaveBeenCalledTimes(2);
    expect(mockedExecuteTool).toHaveBeenCalledOnce();
    expect(mockedExecuteTool).toHaveBeenCalledWith('search', { q: 'foo' }, expect.any(Map));
  });

  it('yields error and returns immediately when LLM streams an error event', async () => {
    mockedChatWithFallback.mockReturnValue(
      streamEvents([
        { type: 'text_delta', content: 'partial' },
        { type: 'error', message: 'rate limit exceeded' },
        // Events after error should not appear
        { type: 'text_delta', content: 'should not appear' },
      ]),
    );

    const events = await collectEvents(
      agentLoop(makeContext(), [{ role: 'user', content: 'Hi' }]),
    );

    // The generator returns on error, so the text_delta after error is still yielded
    // by the stream but the agentLoop returns after yielding the error.
    // Actually looking at the code: the for-await loop processes events one by one,
    // so after error is yielded the function returns immediately.
    // But the stream itself yields all events — the for-await just stops consuming.
    expect(events[0]).toEqual({ type: 'text_delta', content: 'partial' });
    expect(events[1]).toEqual({ type: 'error', message: 'rate limit exceeded' });
    expect(events).toHaveLength(2);
  });

  it('gracefully summarizes after MAX_ITERATIONS (25) when LLM keeps returning tool calls', async () => {
    const tool = {
      name: 'loop_tool',
      description: 'Always called',
      inputSchema: { type: 'object' },
      handler: vi.fn(),
    };

    mockedExecuteTool.mockResolvedValue({ output: { result: 'ok' } });

    let callCount = 0;
    mockedChatWithFallback.mockImplementation(() => {
      callCount++;
      // First 25 calls return tool calls; the 26th (graceful summary) returns text
      if (callCount <= 25) {
        return streamEvents([
          { type: 'tool_call_start', id: 'tc-loop', tool: 'loop_tool', input: {} },
          { type: 'tool_call_end', id: 'tc-loop' },
          { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
        ]);
      }
      return streamEvents([
        { type: 'text_delta', content: 'Summary of progress...' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
      ]);
    });

    const events = await collectEvents(
      agentLoop(makeContext({ tools: [tool] }), [{ role: 'user', content: 'loop' }]),
    );

    const lastEvent = events[events.length - 1];
    expect(lastEvent).toEqual({
      type: 'done',
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    // 25 tool-call iterations + 1 graceful summary call = 26
    expect(mockedChatWithFallback).toHaveBeenCalledTimes(26);
  });

  it('yields done with usage when response has no text and no tool calls', async () => {
    mockedChatWithFallback.mockReturnValue(
      streamEvents([
        { type: 'done', usage: { inputTokens: 5, outputTokens: 0 } },
      ]),
    );

    const events = await collectEvents(
      agentLoop(makeContext(), [{ role: 'user', content: 'empty' }]),
    );

    expect(events).toEqual([
      { type: 'done', usage: { inputTokens: 5, outputTokens: 0 } },
    ]);
  });

  it('uses the provided model from context instead of the default', async () => {
    mockedChatWithFallback.mockReturnValue(
      streamEvents([
        { type: 'text_delta', content: 'ok' },
        { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
      ]),
    );

    await collectEvents(
      agentLoop(makeContext({ model: 'gpt-4o' }), [{ role: 'user', content: 'test' }]),
    );

    expect(mockedChatWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o' }),
      undefined,
    );
  });

  it('passes thinking events through', async () => {
    mockedChatWithFallback.mockReturnValue(
      streamEvents([
        { type: 'thinking', content: 'Let me think...' },
        { type: 'text_delta', content: 'Answer' },
        { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
      ]),
    );

    const events = await collectEvents(
      agentLoop(makeContext(), [{ role: 'user', content: 'think' }]),
    );

    expect(events[0]).toEqual({ type: 'thinking', content: 'Let me think...' });
    expect(events[1]).toEqual({ type: 'text_delta', content: 'Answer' });
  });
});
