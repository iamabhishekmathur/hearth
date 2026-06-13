import type { ToolDefinition } from '@hearth/shared';
import type { ToolResult } from '../agent/types.js';
import type { ConnectorConfig } from './connectors/base-connector.js';
import { ConnectionManager } from './connection-manager.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from './token-store.js';

export interface HealthStatus {
  connected: boolean;
  healthy: boolean;
  lastChecked: Date | null;
  provider: string;
}

export interface MCPGateway {
  connect(integrationId: string, config: ConnectorConfig): Promise<void>;
  ensureConnected(integrationId: string): Promise<boolean>;
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

  /**
   * Ensure this integration has a live, in-memory connection IN THIS PROCESS.
   *
   * mcpGateway connections are per-process and in-memory. The connect path runs
   * in the API process, but the on-connect backfill (synthesis + task detection)
   * runs in the WORKER process, whose gateway only connected to integrations that
   * existed at worker startup. A just-connected integration is therefore absent
   * from the worker's gateway, so pulls silently skip it.
   *
   * This self-heals that gap: if there is no live connection, it loads the
   * Integration row, decrypts its credentials, rebuilds the ConnectorConfig, and
   * connects on-demand. Idempotent and safe to call before every pull.
   *
   * Returns true if a usable connection exists afterwards, false otherwise (row
   * missing, disabled, or connect failed) so callers can skip cleanly.
   */
  async ensureConnected(integrationId: string): Promise<boolean> {
    if (this.connectionManager.isConnected(integrationId)) {
      return true;
    }

    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
    });
    if (!integration || !integration.enabled) {
      logger.debug(
        { integrationId },
        'ensureConnected: integration row missing or disabled, cannot connect',
      );
      return false;
    }

    const config = integration.config as Record<string, unknown> | null;
    let credentials: Record<string, string> = {};
    const encrypted = config?.['encryptedCredentials'] as string | undefined;
    if (encrypted) {
      try {
        credentials = JSON.parse(decrypt(encrypted)) as Record<string, string>;
      } catch (err) {
        logger.error(
          { integrationId, error: err },
          'ensureConnected: failed to decrypt integration credentials',
        );
        return false;
      }
    }

    const serverUrl = config?.['serverUrl'] as string | undefined;
    const connectorConfig: ConnectorConfig = {
      provider: integration.provider,
      credentials,
      serverUrl,
    };

    try {
      await this.connectionManager.connect(integrationId, connectorConfig);
      logger.info(
        { integrationId, provider: integration.provider },
        'ensureConnected: connected integration on-demand (cross-process backfill)',
      );
      return true;
    } catch (err) {
      logger.error(
        { integrationId, provider: integration.provider, error: err },
        'ensureConnected: on-demand connect failed',
      );
      return false;
    }
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
      // Not connected to the gateway at all. Persist 'error' so a broken/stale
      // integration doesn't keep reporting 'active' from a previous connect.
      const checkedAt = new Date();
      await this.persistHealth(integrationId, 'error', checkedAt);
      return {
        connected: false,
        healthy: false,
        lastChecked: checkedAt,
        provider: 'unknown',
      };
    }

    const healthy = await entry.connector.healthCheck();
    entry.healthy = healthy;
    entry.lastHealthCheck = new Date();

    // Persist the real status back to the Integration row so a broken token
    // shows 'error' instead of staying 'active' forever. An integration that is
    // connected but failing its health probe is 'error'; healthy is 'active'.
    await this.persistHealth(
      integrationId,
      healthy ? 'active' : 'error',
      entry.lastHealthCheck,
    );

    return {
      connected: true,
      healthy,
      lastChecked: entry.lastHealthCheck,
      provider: entry.config.provider,
    };
  }

  /**
   * Persist health-check outcome to the Integration row. Best-effort: a DB
   * hiccup here must not break the health endpoint or the background sweep.
   * Never downgrades a disabled integration (status 'inactive').
   */
  private async persistHealth(
    integrationId: string,
    status: 'active' | 'error',
    checkedAt: Date,
  ): Promise<void> {
    try {
      await prisma.integration.updateMany({
        where: { id: integrationId, enabled: true },
        data: { status, healthCheckedAt: checkedAt },
      });
    } catch (err) {
      logger.error({ integrationId, error: err }, 'Failed to persist integration health');
    }
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
