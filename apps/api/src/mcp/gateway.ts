import type { ToolDefinition } from '@hearth/shared';
import type { ToolResult } from '../agent/types.js';
import type { ConnectorConfig } from './connectors/base-connector.js';
import { ConnectionManager } from './connection-manager.js';
import { logger } from '../lib/logger.js';

export interface HealthStatus {
  connected: boolean;
  healthy: boolean;
  lastChecked: Date | null;
  provider: string;
}

export interface MCPGateway {
  connect(integrationId: string, config: ConnectorConfig): Promise<void>;
  disconnect(integrationId: string): Promise<void>;
  listTools(integrationId: string): Promise<ToolDefinition[]>;
  executeTool(
    integrationId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult>;
  healthCheck(integrationId: string): Promise<HealthStatus>;
  getConnectedIntegrations(): string[];
}

export class MCPGatewayImpl implements MCPGateway {
  private connectionManager: ConnectionManager;

  constructor() {
    this.connectionManager = new ConnectionManager();
  }

  async connect(integrationId: string, config: ConnectorConfig): Promise<void> {
    await this.connectionManager.connect(integrationId, config);
  }

  async disconnect(integrationId: string): Promise<void> {
    await this.connectionManager.disconnect(integrationId);
  }

  async listTools(integrationId: string): Promise<ToolDefinition[]> {
    const entry = this.connectionManager.getConnection(integrationId);
    if (!entry) {
      return [];
    }
    return entry.connector.listTools();
  }

  async executeTool(
    integrationId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const entry = this.connectionManager.getConnection(integrationId);
    if (!entry) {
      return {
        output: { message: 'Integration not connected' },
        error: `Integration ${integrationId} is not connected`,
      };
    }

    try {
      return await entry.connector.executeTool(toolName, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Tool execution failed';
      logger.error({ integrationId, toolName, error: err }, 'MCP tool execution error');
      return { output: {}, error: message };
    }
  }

  async healthCheck(integrationId: string): Promise<HealthStatus> {
    const entry = this.connectionManager.getConnection(integrationId);
    if (!entry) {
      return {
        connected: false,
        healthy: false,
        lastChecked: null,
        provider: 'unknown',
      };
    }

    const healthy = await entry.connector.healthCheck();
    entry.healthy = healthy;
    entry.lastHealthCheck = new Date();

    return {
      connected: true,
      healthy,
      lastChecked: entry.lastHealthCheck,
      provider: entry.config.provider,
    };
  }

  getConnectedIntegrations(): string[] {
    return this.connectionManager.getConnectedIds();
  }

  /**
   * Get all tools from all connected integrations.
   */
  async getAllTools(): Promise<Map<string, { integrationId: string; tool: ToolDefinition }>> {
    const toolMap = new Map<string, { integrationId: string; tool: ToolDefinition }>();

    for (const integrationId of this.connectionManager.getConnectedIds()) {
      const tools = await this.listTools(integrationId);
      for (const tool of tools) {
        toolMap.set(tool.name, { integrationId, tool });
      }
    }

    return toolMap;
  }

  /**
   * Get static tool definitions for a provider (no active connection needed).
   */
  getStaticTools(provider: string): ToolDefinition[] {
    return this.connectionManager.getStaticTools(provider);
  }

  destroy(): void {
    this.connectionManager.destroy();
  }
}

/** Singleton MCP gateway instance */
export const mcpGateway = new MCPGatewayImpl();
