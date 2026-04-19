export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string }; // base64 data (no data: prefix)

/** Extract plain text from a message's content (ignoring image parts) */
export function getTextContent(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

export interface ChatParams {
  model: string;
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ChatEvent =
  | { type: 'thinking'; content: string }
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call_start'; id: string; tool: string; input: Record<string, unknown> }
  | { type: 'tool_call_delta'; id: string; input: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'tool_progress'; toolCallId: string; toolName: string; status: 'started' | 'completed' | 'failed'; durationMs?: number }
  | { type: 'error'; message: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number } };
