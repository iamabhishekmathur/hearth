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
  /**
   * Chat session this call belongs to, if any. Used by the compliance layer to
   * keep one PII token map per conversation (stable placeholders across turns
   * and across participants in a shared session), not per HTTP request.
   */
  sessionId?: string;
  /**
   * Cancellation signal. When aborted, the provider must stop streaming and
   * clean up. Powers interruptible/steerable runs (W2). Providers that don't
   * support cancellation may ignore it.
   */
  signal?: AbortSignal;
  /**
   * User whose *personal* LLM credential should pay for this call when the
   * provider is user-scoped (e.g. `chatgpt-plan`). Ignored by org providers.
   */
  userId?: string;
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

/**
 * Why a run finished. Powers interruptible runs, doom-loop breaks, budget caps,
 * and graceful degradation (W2). `done` = normal completion.
 */
export type StopReason = 'done' | 'interrupted' | 'max_iterations' | 'budget' | 'error';

export type ChatEvent =
  | { type: 'thinking'; content: string }
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call_start'; id: string; tool: string; input: Record<string, unknown> }
  | { type: 'tool_call_delta'; id: string; input: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'tool_progress'; toolCallId: string; toolName: string; status: 'started' | 'completed' | 'failed'; durationMs?: number }
  | { type: 'side_effect'; toolName: string; provider: string }
  // W3: interactive tool-permission prompt. Server → client; the client replies
  // out-of-band with a PermissionResponse (see agent.ts). `callId` correlates them.
  | { type: 'permission_request'; callId: string; tool: string; input: Record<string, unknown> }
  // W2: non-fatal notice surfaced mid-run (e.g. doom-loop break, budget warning).
  | { type: 'warning'; message: string }
  // `code` lets clients render an actionable state instead of raw text, e.g.
  // the ChatGPT plan "Manage usage" prompt. See CHATGPT_PLAN_ERROR_CODES.
  | { type: 'error'; message: string; code?: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number }; stopReason?: StopReason };

/** Error codes emitted by the user-scoped ChatGPT plan provider. */
export const CHATGPT_PLAN_ERROR_CODES = {
  /** Plan or per-app usage cap reached → show "Manage usage". */
  usageLimit: 'chatgpt_plan_usage_limit',
  /** Plan usage unavailable for this account/workspace. */
  unavailable: 'chatgpt_plan_unavailable',
  /** Tokens revoked/expired → reconnect. */
  reauth: 'chatgpt_plan_reauth',
  /** User asked for their plan but hasn't connected one. */
  notConnected: 'chatgpt_plan_not_connected',
} as const;

/** Provider id for "use the signed-in user's ChatGPT plan". */
export const CHATGPT_PLAN_PROVIDER_ID = 'chatgpt-plan';
