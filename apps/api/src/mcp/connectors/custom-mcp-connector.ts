import type { ToolDefinition } from '@hearth/shared';
import type { ToolResult } from '../../agent/types.js';
import type { ConnectorConfig, MCPConnector } from './base-connector.js';
import { logger } from '../../lib/logger.js';

let nextId = 1;

/**
 * Generic MCP connector that talks to any MCP-compatible server via JSON-RPC over HTTP.
 * Users provide the server URL; tools are discovered dynamically on connect.
 */
export class CustomMCPConnector implements MCPConnector {
  readonly provider = 'custom';
  private connected = false;
  private serverUrl = '';
  private tools: ToolDefinition[] = [];

  async connect(config: ConnectorConfig): Promise<void> {
    const url = config.credentials['server_url'] ?? config.serverUrl;
    if (!url) {
      throw new Error('Custom MCP connector requires server_url credential');
    }

    this.serverUrl = url.replace(/\/+$/, ''); // strip trailing slashes

    // Discover tools via JSON-RPC tools/list
    try {
      const res = await this.rpc('tools/list', {});
      const body = res as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
      this.tools = (body.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      }));
    } catch (err) {
      logger.error({ serverUrl: this.serverUrl, error: err }, 'Failed to discover tools from custom MCP server');
      throw new Error(`Could not connect to MCP server at ${this.serverUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.connected = true;
    logger.info({ serverUrl: this.serverUrl, toolCount: this.tools.length }, 'Custom MCP connector connected');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.tools = [];
    this.serverUrl = '';
  }

  listTools(): ToolDefinition[] {
    return this.tools;
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.connected || !this.serverUrl) {
      return { output: { message: 'Custom MCP server not connected.' } };
    }

    try {
      const result = await this.rpc('tools/call', { name: toolName, arguments: input });
      return { output: result as Record<string, unknown> };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ serverUrl: this.serverUrl, toolName, error: err }, 'Custom MCP tool execution failed');
      return { output: { message: `Tool execution failed: ${message}` }, error: message };
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.connected || !this.serverUrl) return false;
    try {
      // Ping with tools/list — if it responds, server is healthy
      await this.rpc('tools/list', {});
      return true;
    } catch {
      return false;
    }
  }

  /** Send a JSON-RPC 2.0 request to the MCP server */
  private async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = nextId++;
    const res = await fetch(this.serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`MCP server returned HTTP ${res.status}`);
    }

    const body = (await res.json()) as { result?: unknown; error?: { message?: string; code?: number } };
    if (body.error) {
      throw new Error(body.error.message ?? `JSON-RPC error ${body.error.code}`);
    }

    return body.result;
  }
}
