import type { ChatEvent } from '@hearth/shared';

export interface AgentContext {
  userId: string;
  orgId: string;
  teamId: string | null;
  sessionId: string;
  model?: string;
  providerId?: string;
  latestMessage?: string;
  // These will be populated by context-builder
  systemPrompt: string;
  tools: AgentTool[];
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  output: Record<string, unknown>;
  error?: string;
}

// Re-export ChatEvent as AgentEvent for clarity
export type AgentEvent = ChatEvent;
