import type { ToolDefinition } from '@hearth/shared';
import type { ToolResult } from '../../agent/types.js';

export interface ConnectorConfig {
  provider: string;
  credentials: Record<string, string>;
  serverUrl?: string;
}

export interface MCPConnector {
  provider: string;
  connect(config: ConnectorConfig): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): ToolDefinition[];
  executeTool(toolName: string, input: Record<string, unknown>): Promise<ToolResult>;
  healthCheck(): Promise<boolean>;
}
