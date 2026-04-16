import Anthropic from '@anthropic-ai/sdk';
import type { ChatParams, ChatEvent, LLMMessage, ToolDefinition } from '@hearth/shared';
import type { LLMProvider } from './types.js';
import { env } from '../config.js';

function toAnthropicMessages(
  messages: LLMMessage[],
): Anthropic.MessageCreateParams['messages'] {
  const result: Anthropic.MessageCreateParams['messages'] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue; // handled via system param

    if (msg.role === 'tool') {
      result.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.toolCallId ?? '',
            content: msg.content,
          },
        ],
      });
      continue;
    }

    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      const content: Anthropic.ContentBlockParam[] = [];
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.input,
        });
      }
      result.push({ role: 'assistant', content });
      continue;
    }

    result.push({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    });
  }

  return result;
}

function toAnthropicTools(
  tools: ToolDefinition[],
): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
  }));
}

export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';
  private client: Anthropic;

  constructor(apiKey?: string) {
    const key = apiKey ?? env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('ANTHROPIC_API_KEY is required for Anthropic provider');
    }
    this.client = new Anthropic({ apiKey: key });
  }

  async *chat(params: ChatParams): AsyncIterable<ChatEvent> {
    const systemPrompt =
      params.systemPrompt ??
      params.messages.find((m) => m.role === 'system')?.content;

    const requestParams: Anthropic.MessageCreateParams = {
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      messages: toAnthropicMessages(params.messages),
      stream: true,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
      ...(params.tools?.length ? { tools: toAnthropicTools(params.tools) } : {}),
    };

    try {
      const stream = this.client.messages.stream(requestParams);

      let currentToolId = '';
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const event of stream) {
        switch (event.type) {
          case 'message_start': {
            const usage = (event as Anthropic.MessageStreamEvent & { message?: { usage?: { input_tokens?: number } } }).message?.usage;
            if (usage?.input_tokens) {
              inputTokens = usage.input_tokens;
            }
            break;
          }

          case 'content_block_start': {
            const block = (event as Anthropic.ContentBlockStartEvent).content_block;
            if (block.type === 'thinking') {
              // Thinking block started — content comes in deltas
            } else if (block.type === 'tool_use') {
              currentToolId = block.id;
              yield {
                type: 'tool_call_start',
                id: block.id,
                tool: block.name,
                input: {},
              };
            }
            break;
          }

          case 'content_block_delta': {
            const delta = (event as Anthropic.ContentBlockDeltaEvent).delta;
            if (delta.type === 'thinking_delta') {
              yield { type: 'thinking', content: (delta as Anthropic.ThinkingDelta).thinking };
            } else if (delta.type === 'text_delta') {
              yield { type: 'text_delta', content: (delta as Anthropic.TextDelta).text };
            } else if (delta.type === 'input_json_delta') {
              yield {
                type: 'tool_call_delta',
                id: currentToolId,
                input: (delta as Anthropic.InputJSONDelta).partial_json,
              };
            }
            break;
          }

          case 'content_block_stop': {
            if (currentToolId) {
              yield { type: 'tool_call_end', id: currentToolId };
              currentToolId = '';
            }
            break;
          }

          case 'message_delta': {
            const msgDelta = event as Anthropic.MessageDeltaEvent;
            if (msgDelta.usage?.output_tokens) {
              outputTokens = msgDelta.usage.output_tokens;
            }
            break;
          }
        }
      }

      yield { type: 'done', usage: { inputTokens, outputTokens } };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Anthropic API error';
      yield { type: 'error', message };
    }
  }

  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error(
      'Anthropic does not provide an embeddings API. Use OpenAI or another provider for embeddings.',
    );
  }

  async listModels(): Promise<string[]> {
    return ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'];
  }
}
