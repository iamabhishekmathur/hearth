import type { ChatEvent, LLMMessage, ToolDefinition } from '@hearth/shared';
import { providerRegistry } from '../llm/provider-registry.js';
import { executeTool } from './tool-router.js';
import type { AgentContext } from './types.js';
import { getUsageRecorder } from '../extensions/usage-metering.js';
import { logger } from '../lib/logger.js';

const MAX_ITERATIONS = 25;
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// TODO: Long-running agent improvements (next phase)
// - Context compaction: summarize older messages when approaching context limit
//   (Claude does this at ~150K tokens). Prevents context window overflow on
//   complex tasks that need many tool calls.
// - Loop detection: fingerprint each iteration as (tool_name, result_hash).
//   Three identical fingerprints in a row = stuck. Break with graceful summary.
// - Graceful degradation: at max iterations, do one final toolless LLM call
//   asking "summarize your progress and what remains" instead of hard-erroring.
// - Configurable limits: accept maxIterations via AgentContext so callers
//   (task executor, chat, etc.) can set per-task budgets.
// - Cost/token budget: complementary limit to iteration count. Track cumulative
//   token usage across iterations and stop when budget exceeded.
// - Subagent isolation: each subtask already gets a separate agentLoop call,
//   giving it a fresh context window. Formalize this pattern and ensure parent
//   task context doesn't bleed into subtask execution.
// Reference: Claude Code uses no default limit + compaction at 150K tokens.
// Codex demonstrated 25-hour runs with auto-compaction across windows.
// CrewAI defaults to 25 iterations, Vercel AI SDK to 20 steps.

/**
 * The main agent loop. Sends messages to the LLM, handles tool calls,
 * and yields ChatEvent events as an async generator.
 */
export async function* agentLoop(
  context: AgentContext,
  messages: LLMMessage[],
): AsyncGenerator<ChatEvent> {
  // Filter out unavailable tools before sending to LLM
  const availableTools = context.tools.filter((t) => !t.isAvailable || t.isAvailable());

  const toolDefs: ToolDefinition[] = availableTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

  // Build tool handler map for execution (only available tools)
  const toolMap = new Map(availableTools.map((t) => [t.name, t]));

  const conversationMessages: LLMMessage[] = [...messages];
  const model = context.model ?? DEFAULT_MODEL;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const pendingToolCalls: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
    }> = [];
    const inputBuffers = new Map<string, string>(); // tool call id → accumulated JSON
    let hasToolCalls = false;
    let fullTextContent = '';
    let lastUsage = { inputTokens: 0, outputTokens: 0 };

    // Stream from LLM
    const stream = providerRegistry.chatWithFallback(
      {
        model,
        messages: conversationMessages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        systemPrompt: context.systemPrompt,
      },
      context.providerId,
    );

    for await (const event of stream) {
      switch (event.type) {
        case 'thinking':
        case 'text_delta':
          if (event.type === 'text_delta') {
            fullTextContent += event.content;
          }
          yield event;
          break;

        case 'tool_call_start':
          hasToolCalls = true;
          pendingToolCalls.push({ id: event.id, name: event.tool, input: {} });
          inputBuffers.set(event.id, '');
          yield event;
          break;

        case 'tool_call_delta':
          inputBuffers.set(event.id, (inputBuffers.get(event.id) ?? '') + event.input);
          yield event;
          break;

        case 'tool_call_end': {
          // Parse the accumulated JSON and update the pending tool call's input
          const jsonStr = inputBuffers.get(event.id) ?? '{}';
          const tc = pendingToolCalls.find((t) => t.id === event.id);
          if (tc) {
            try { tc.input = JSON.parse(jsonStr); } catch { tc.input = {}; }
          }
          inputBuffers.delete(event.id);
          yield event;
          break;
        }

        case 'error':
          yield event;
          return;

        case 'done':
          lastUsage = event.usage;
          break;
      }
    }

    // If no tool calls, we're done
    if (!hasToolCalls) {
      // Add assistant message to conversation history
      if (fullTextContent) {
        conversationMessages.push({
          role: 'assistant',
          content: fullTextContent,
        });
      }
      recordAgentRunUsage(context.orgId);
      yield { type: 'done', usage: lastUsage };
      return;
    }

    // Execute tool calls and add results to conversation
    const assistantMessage: LLMMessage = {
      role: 'assistant',
      content: fullTextContent,
      toolCalls: pendingToolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        input: tc.input,
      })),
    };
    conversationMessages.push(assistantMessage);

    // Yield 'started' progress for all tools before execution
    for (const toolCall of pendingToolCalls) {
      yield { type: 'tool_progress', toolCallId: toolCall.id, toolName: toolCall.name, status: 'started' as const };
    }

    // Execute tool calls in parallel
    const toolResults = await Promise.all(
      pendingToolCalls.map(async (toolCall) => {
        const startTime = Date.now();
        const result = await executeTool(toolCall.name, toolCall.input, toolMap, context.userId);
        const durationMs = Date.now() - startTime;
        return { toolCall, result, durationMs };
      }),
    );

    // Yield completion progress and add results to conversation
    for (const { toolCall, result, durationMs } of toolResults) {
      yield {
        type: 'tool_progress',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        status: result.error ? 'failed' as const : 'completed' as const,
        durationMs,
      };

      // Side-effect detection: MCP tools whose name implies a write
      // emit a hint so the chat UI can suggest "make this a task with
      // a review gate" — useful for high-stakes external actions.
      if (!result.error && hasExternalSideEffect(toolCall.name)) {
        yield {
          type: 'side_effect',
          toolName: toolCall.name,
          provider: extractProvider(toolCall.name),
        };
      }

      // Add tool result message for the LLM — include error so model doesn't retry blindly
      conversationMessages.push({
        role: 'tool',
        content: result.error
          ? JSON.stringify({ error: result.error, ...result.output })
          : JSON.stringify(result.output),
        toolCallId: toolCall.id,
      });
    }

    // Continue the loop — LLM will process tool results
  }

  // Hit max iterations — do one final toolless call for graceful degradation
  conversationMessages.push({
    role: 'user',
    content: 'You have reached the maximum number of steps. Summarize what you accomplished and what remains to be done. Do not call any tools.',
  });

  const finalStream = providerRegistry.chatWithFallback(
    {
      model,
      messages: conversationMessages,
      systemPrompt: context.systemPrompt,
      // No tools — force a text-only response
    },
    context.providerId,
  );

  let finalUsage = { inputTokens: 0, outputTokens: 0 };
  for await (const event of finalStream) {
    if (event.type === 'text_delta') yield event;
    if (event.type === 'done') finalUsage = event.usage;
  }

  recordAgentRunUsage(context.orgId);
  yield { type: 'done', usage: finalUsage };
}

/**
 * Fire-and-forget usage metering. No-op when no recorder is registered
 * (i.e. OSS self-hosting). Errors are logged but never propagated — a
 * metering glitch must never break an agent run.
 */
function recordAgentRunUsage(orgId: string): void {
  const recorder = getUsageRecorder();
  if (recorder) {
    recorder(orgId, 'agent_runs', 1).catch((err) => {
      logger.warn({ err, orgId }, 'usage metering failed');
    });
  }
}

// ────────────────────────────────────────────────────────────────────────
// Side-effect detection
//
// Heuristic: MCP tool calls (prefixed `mcp__provider__action`) whose
// action verb implies a write to an external system. We don't gate the
// call — the agent already ran it — but we surface a UI hint so the
// user can promote similar requests into tasks (with a review gate).
// ────────────────────────────────────────────────────────────────────────

const WRITE_VERBS = [
  'send', 'post', 'create', 'publish', 'write', 'add', 'update',
  'edit', 'comment', 'file', 'delete', 'remove', 'schedule', 'invite',
  'transition', 'move', 'merge', 'close', 'reply',
];

function hasExternalSideEffect(toolName: string): boolean {
  // Only MCP-prefixed tools are considered "external" — the rest are internal Hearth state.
  if (!toolName.startsWith('mcp__')) return false;
  // Strip the prefix and provider; check action verb.
  const rest = toolName.slice('mcp__'.length).toLowerCase();
  return WRITE_VERBS.some((v) => rest.includes(v));
}

function extractProvider(toolName: string): string {
  // mcp__slack__send_message → slack
  const parts = toolName.split('__');
  return parts.length >= 2 ? parts[1] : 'integration';
}
