import OpenAI from 'openai';
import type { ChatParams, ChatEvent, LLMMessage, ToolDefinition, ContentPart } from '@hearth/shared';
import type { LLMProvider } from './types.js';
import { env } from '../config.js';

function toOpenAIMessages(
  messages: LLMMessage[],
  systemPrompt?: string,
): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    switch (msg.role) {
      case 'system': {
        const systemText = typeof msg.content === 'string' ? msg.content : msg.content.filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text').map((p) => p.text).join('');
        result.push({ role: 'system', content: systemText });
        break;
      }

      case 'user':
        if (Array.isArray(msg.content)) {
          result.push({
            role: 'user',
            content: msg.content.map((part) => {
              if (part.type === 'image') {
                return {
                  type: 'image_url' as const,
                  image_url: { url: `data:${part.mimeType};base64,${part.data}` },
                };
              }
              return { type: 'text' as const, text: part.text };
            }),
          });
        } else {
          result.push({ role: 'user', content: msg.content });
        }
        break;

      case 'assistant': {
        const assistantText = typeof msg.content === 'string' ? msg.content : msg.content.filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text').map((p) => p.text).join('') || null;
        const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: assistantText,
        };
        if (msg.toolCalls?.length) {
          assistantMsg.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input),
            },
          }));
        }
        result.push(assistantMsg);
        break;
      }

      case 'tool': {
        const toolText = typeof msg.content === 'string' ? msg.content : msg.content.filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text').map((p) => p.text).join('');
        result.push({
          role: 'tool',
          tool_call_id: msg.toolCallId ?? '',
          content: toolText,
        });
        break;
      }
    }
  }

  return result;
}

function toOpenAITools(
  tools: ToolDefinition[],
): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

export class OpenAIProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  protected client: OpenAI;

  constructor(options?: { apiKey?: string; baseURL?: string; id?: string; name?: string }) {
    const key = options?.apiKey ?? env.OPENAI_API_KEY;
    if (!key) {
      throw new Error('OPENAI_API_KEY is required for OpenAI provider');
    }
    this.id = options?.id ?? 'openai';
    this.name = options?.name ?? 'OpenAI';
    this.client = new OpenAI({
      apiKey: key,
      ...(options?.baseURL ? { baseURL: options.baseURL } : {}),
    });
  }

  async *chat(params: ChatParams): AsyncIterable<ChatEvent> {
    const messages = toOpenAIMessages(params.messages, params.systemPrompt);

    const requestParams: OpenAI.ChatCompletionCreateParams = {
      model: params.model,
      messages,
      stream: true,
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
      ...(params.maxTokens != null ? { max_tokens: params.maxTokens } : {}),
      ...(params.tools?.length ? { tools: toOpenAITools(params.tools) } : {}),
    };

    try {
      const stream = await this.client.chat.completions.create(requestParams);

      const toolCalls = new Map<number, { id: string; name: string; args: string }>();
      let completionTokens = 0;
      let promptTokens = 0;

      for await (const chunk of stream as AsyncIterable<OpenAI.ChatCompletionChunk>) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Text content
        if (delta.content) {
          yield { type: 'text_delta', content: delta.content };
        }

        // Tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;

            if (tc.id) {
              // New tool call starting
              toolCalls.set(idx, { id: tc.id, name: tc.function?.name ?? '', args: '' });
              yield {
                type: 'tool_call_start',
                id: tc.id,
                tool: tc.function?.name ?? '',
                input: {},
              };
            }

            if (tc.function?.arguments) {
              const existing = toolCalls.get(idx);
              if (existing) {
                existing.args += tc.function.arguments;
                yield {
                  type: 'tool_call_delta',
                  id: existing.id,
                  input: tc.function.arguments,
                };
              }
            }
          }
        }

        // Check for finish
        if (choice.finish_reason) {
          // End any open tool calls
          for (const [idx, tc] of toolCalls) {
            yield { type: 'tool_call_end', id: tc.id };
            toolCalls.delete(idx);
          }
        }

        // Usage info (available in the last chunk for some models)
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens;
          completionTokens = chunk.usage.completion_tokens;
        }
      }

      yield {
        type: 'done',
        usage: { inputTokens: promptTokens, outputTokens: completionTokens },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OpenAI API error';
      yield { type: 'error', message };
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    });
    return response.data.map((d) => d.embedding);
  }

  async listModels(): Promise<string[]> {
    const response = await this.client.models.list();
    const models: string[] = [];
    for await (const model of response) {
      models.push(model.id);
    }
    return models.sort();
  }
}
