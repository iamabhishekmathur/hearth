import type { ToolDefinition } from '@hearth/shared';
import type { ToolResult } from '../../agent/types.js';
import type { ConnectorConfig, MCPConnector } from './base-connector.js';
import * as slackService from '../../services/slack-service.js';
import { decrypt } from '../token-store.js';

const SLACK_TOOLS: ToolDefinition[] = [
  {
    name: 'slack_post_message',
    description: 'Post a message to a Slack channel',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name or ID' },
        text: { type: 'string', description: 'Message text' },
      },
      required: ['channel', 'text'],
    },
  },
  {
    name: 'slack_list_channels',
    description: 'List available Slack channels',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max channels to return', default: 100 },
      },
    },
  },
  {
    name: 'slack_search_messages',
    description: 'Search Slack messages by query',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results', default: 20 },
      },
      required: ['query'],
    },
  },
];

export class SlackConnector implements MCPConnector {
  readonly provider = 'slack';
  private connected = false;
  private botToken = '';

  async connect(config: ConnectorConfig): Promise<void> {
    if (!config.credentials['bot_token']) {
      throw new Error('Slack connector requires bot_token credential');
    }
    // Decrypt if stored encrypted
    const raw = config.credentials['bot_token'];
    this.botToken = config.credentials['bot_token_encrypted'] === 'true' ? decrypt(raw) : raw;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.botToken = '';
  }

  listTools(): ToolDefinition[] {
    return SLACK_TOOLS;
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.connected || !this.botToken) {
      return { output: { message: 'Integration not yet connected. Configure in Settings.' } };
    }

    switch (toolName) {
      case 'slack_post_message': {
        const result = await slackService.postMessage(
          this.botToken,
          input.channel as string,
          input.text as string,
        );
        return { output: { message: 'Message posted', ts: result.ts } };
      }

      case 'slack_list_channels': {
        const channels = await slackService.listChannels(
          this.botToken,
          (input.limit as number) ?? 100,
        );
        return {
          output: {
            channels: channels.map((c) => ({
              id: c.id,
              name: c.name,
              topic: (c.topic as Record<string, unknown>)?.value,
            })),
          },
        };
      }

      case 'slack_search_messages': {
        const messages = await slackService.searchMessages(
          this.botToken,
          input.query as string,
          (input.limit as number) ?? 20,
        );
        return { output: { messages } };
      }

      default:
        return { output: { message: `Unknown tool: ${toolName}` } };
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.connected || !this.botToken) return false;
    try {
      const res = await fetch('https://slack.com/api/auth.test', {
        headers: { Authorization: `Bearer ${this.botToken}` },
      });
      const data = await res.json() as Record<string, unknown>;
      return data.ok === true;
    } catch {
      return false;
    }
  }
}
