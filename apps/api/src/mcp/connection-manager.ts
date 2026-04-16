import { logger } from '../lib/logger.js';
import { env } from '../config.js';
import type { MCPConnector, ConnectorConfig } from './connectors/base-connector.js';
import { SlackConnector } from './connectors/slack-connector.js';
import { GmailConnector } from './connectors/gmail-connector.js';
import { GDriveConnector } from './connectors/gdrive-connector.js';
import { JiraConnector } from './connectors/jira-connector.js';
import { NotionConnector } from './connectors/notion-connector.js';
import { GCalendarConnector } from './connectors/gcalendar-connector.js';
import { GitHubConnector } from './connectors/github-connector.js';
import { CustomMCPConnector } from './connectors/custom-mcp-connector.js';
import { DevMockConnector } from './connectors/dev-mock-connector.js';

const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const CONNECTOR_REGISTRY: Record<string, () => MCPConnector> = {
  slack: () => new SlackConnector(),
  gmail: () => new GmailConnector(),
  gdrive: () => new GDriveConnector(),
  jira: () => new JiraConnector(),
  notion: () => new NotionConnector(),
  gcalendar: () => new GCalendarConnector(),
  github: () => new GitHubConnector(),
  custom: () => new CustomMCPConnector(),
};

export interface ConnectionEntry {
  connector: MCPConnector;
  config: ConnectorConfig;
  lastHealthCheck: Date | null;
  healthy: boolean;
}

export class ConnectionManager {
  private connections = new Map<string, ConnectionEntry>();
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startHealthChecks();
  }

  /**
   * Create a connector instance for the given provider and connect it.
   * In development mode with dummy credentials, wraps with DevMockConnector.
   */
  async connect(integrationId: string, config: ConnectorConfig): Promise<void> {
    // Disconnect existing connection if any
    if (this.connections.has(integrationId)) {
      await this.disconnect(integrationId);
    }

    const factory = CONNECTOR_REGISTRY[config.provider];
    if (!factory) {
      throw new Error(`Unknown provider: ${config.provider}`);
    }

    const realConnector = factory();
    const useMock = this.shouldUseMock(config);

    let connector: MCPConnector;
    if (useMock) {
      connector = new DevMockConnector(realConnector);
      await connector.connect(config);
      logger.info({ integrationId, provider: config.provider }, 'MCP connector connected (dev mock)');
    } else {
      connector = realConnector;
      await connector.connect(config);
      logger.info({ integrationId, provider: config.provider }, 'MCP connector connected');
    }

    this.connections.set(integrationId, {
      connector,
      config,
      lastHealthCheck: new Date(),
      healthy: true,
    });
  }

  /**
   * Check if this integration should use mock mode.
   * True when: dev environment AND credentials are empty/dummy.
   */
  private shouldUseMock(config: ConnectorConfig): boolean {
    if (env.NODE_ENV !== 'development') return false;

    const creds = config.credentials;
    if (!creds || Object.keys(creds).length === 0) return true;

    // All credential values are empty or placeholder
    const values = Object.values(creds);
    return values.every((v) => !v || v === 'sample' || v === 'placeholder' || v === 'test');
  }

  async disconnect(integrationId: string): Promise<void> {
    const entry = this.connections.get(integrationId);
    if (entry) {
      await entry.connector.disconnect();
      this.connections.delete(integrationId);
      logger.info({ integrationId }, 'MCP connector disconnected');
    }
  }

  getConnection(integrationId: string): ConnectionEntry | undefined {
    return this.connections.get(integrationId);
  }

  getConnectedIds(): string[] {
    return Array.from(this.connections.keys());
  }

  isConnected(integrationId: string): boolean {
    return this.connections.has(integrationId);
  }

  /**
   * Run health checks on all active connections. Attempt reconnect on failure.
   */
  async runHealthChecks(): Promise<void> {
    for (const [integrationId, entry] of this.connections) {
      try {
        const healthy = await entry.connector.healthCheck();
        entry.healthy = healthy;
        entry.lastHealthCheck = new Date();

        if (!healthy) {
          logger.warn({ integrationId }, 'MCP connector health check failed, attempting reconnect');
          try {
            await entry.connector.connect(entry.config);
            entry.healthy = true;
          } catch (reconnectErr) {
            logger.error(
              { integrationId, error: reconnectErr },
              'MCP connector reconnect failed',
            );
          }
        }
      } catch (err) {
        entry.healthy = false;
        entry.lastHealthCheck = new Date();
        logger.error({ integrationId, error: err }, 'MCP health check error');
      }
    }
  }

  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(() => {
      void this.runHealthChecks();
    }, HEALTH_CHECK_INTERVAL_MS);

    // Allow Node to exit even if timer is active
    if (this.healthCheckTimer.unref) {
      this.healthCheckTimer.unref();
    }
  }

  /**
   * Get static tool definitions for a provider without an active connection.
   * Works for built-in connectors whose listTools() returns hardcoded arrays.
   */
  getStaticTools(provider: string): import('@hearth/shared').ToolDefinition[] {
    const factory = CONNECTOR_REGISTRY[provider];
    if (!factory) return [];
    return factory().listTools();
  }

  destroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }
}
