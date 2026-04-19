import type { ChatParams, ChatEvent, LLMMessage, ContentPart } from '@hearth/shared';
import type { LLMProvider } from './types.js';
import { env } from '../config.js';

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[]; // base64 encoded images
}

interface OllamaStreamChunk {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

function toOllamaMessages(messages: LLMMessage[], systemPrompt?: string): OllamaChatMessage[] {
  const result: OllamaChatMessage[] = [];

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === 'tool') {
      // Ollama doesn't support tool messages natively; inject as user context
      const toolText = typeof msg.content === 'string' ? msg.content : msg.content.filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text').map((p) => p.text).join('');
      result.push({
        role: 'user',
        content: `[Tool result for ${msg.toolCallId ?? 'unknown'}]: ${toolText}`,
      });
      continue;
    }

    if (Array.isArray(msg.content)) {
      const textParts = msg.content.filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text');
      const imageParts = msg.content.filter((p): p is Extract<ContentPart, { type: 'image' }> => p.type === 'image');
      const text = textParts.map((p) => p.text).join('\n');
      const images = imageParts.map((p) => p.data);
      result.push({
        role: msg.role === 'system' ? 'system' : msg.role === 'assistant' ? 'assistant' : 'user',
        content: text,
        ...(images.length > 0 ? { images } : {}),
      });
    } else {
      result.push({
        role: msg.role === 'system' ? 'system' : msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      });
    }
  }

  return result;
}

export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama';
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl ?? env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(
      /\/$/,
      '',
    );
  }

  async *chat(params: ChatParams): AsyncIterable<ChatEvent> {
    const messages = toOllamaMessages(params.messages, params.systemPrompt);

    const body = JSON.stringify({
      model: params.model,
      messages,
      stream: true,
      ...(params.temperature != null ? { options: { temperature: params.temperature } } : {}),
    });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to Ollama';
      yield { type: 'error', message: `Ollama connection error: ${message}` };
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      yield { type: 'error', message: `Ollama API error (${response.status}): ${text}` };
      return;
    }

    if (!response.body) {
      yield { type: 'error', message: 'Ollama returned no response body' };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse NDJSON: split on newlines and process complete lines
        const lines = buffer.split('\n');
        // Keep the last (possibly incomplete) line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let chunk: OllamaStreamChunk;
          try {
            chunk = JSON.parse(trimmed) as OllamaStreamChunk;
          } catch {
            continue; // Skip malformed lines
          }

          if (chunk.message?.content) {
            yield { type: 'text_delta', content: chunk.message.content };
          }

          if (chunk.done) {
            promptTokens = chunk.prompt_eval_count ?? 0;
            completionTokens = chunk.eval_count ?? 0;
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const chunk = JSON.parse(buffer.trim()) as OllamaStreamChunk;
          if (chunk.message?.content) {
            yield { type: 'text_delta', content: chunk.message.content };
          }
          if (chunk.done) {
            promptTokens = chunk.prompt_eval_count ?? 0;
            completionTokens = chunk.eval_count ?? 0;
          }
        } catch {
          // Ignore trailing incomplete data
        }
      }

      yield {
        type: 'done',
        usage: { inputTokens: promptTokens, outputTokens: completionTokens },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ollama streaming error';
      yield { type: 'error', message };
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        input: texts.map((t) => t.slice(0, 8000)),
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      throw new Error(`Ollama embed error (${response.status}): ${text}`);
    }

    const data = (await response.json()) as { embeddings: number[][] };
    return data.embeddings;
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }
      const data = (await response.json()) as { models: OllamaModel[] };
      return data.models.map((m) => m.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list Ollama models';
      throw new Error(message);
    }
  }
}
