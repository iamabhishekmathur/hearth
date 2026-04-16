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
  content: string;
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
  | { type: 'error'; message: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number } };
