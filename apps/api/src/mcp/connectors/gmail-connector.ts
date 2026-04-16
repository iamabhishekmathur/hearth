import type { ToolDefinition } from '@hearth/shared';
import type { ToolResult } from '../../agent/types.js';
import type { ConnectorConfig, MCPConnector } from './base-connector.js';
import { logger } from '../../lib/logger.js';

const GMAIL_TOOLS: ToolDefinition[] = [
  {
    name: 'gmail_send_email',
    description: 'Send an email via Gmail',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plain text or HTML)' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'gmail_search',
    description: 'Search Gmail messages',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query' },
        maxResults: { type: 'number', description: 'Max results to return', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'gmail_list_labels',
    description: 'List Gmail labels',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export class GmailConnector implements MCPConnector {
  readonly provider = 'gmail';
  private connected = false;
  private accessToken = '';

  async connect(config: ConnectorConfig): Promise<void> {
    if (!config.credentials['access_token']) {
      throw new Error('Gmail connector requires access_token credential');
    }
    this.accessToken = config.credentials['access_token'];
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.accessToken = '';
  }

  listTools(): ToolDefinition[] {
    return GMAIL_TOOLS;
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.connected || !this.accessToken) {
      return { output: { message: 'Gmail not connected. Configure in Settings.' } };
    }

    const headers = { Authorization: `Bearer ${this.accessToken}` };

    switch (toolName) {
      case 'gmail_send_email': {
        try {
          const to = (input.to as string).replace(/[\r\n]/g, '');
          const subject = (input.subject as string).replace(/[\r\n]/g, '');
          const body = input.body as string;
          const rawMessage = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${body}`;
          const encoded = Buffer.from(rawMessage).toString('base64url');

          const res = await fetch(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
            {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ raw: encoded }),
            },
          );
          const data = (await res.json()) as Record<string, unknown>;
          if (!res.ok) {
            return { output: { message: `Gmail API error: ${JSON.stringify(data)}` } };
          }
          return { output: { message: 'Email sent', messageId: data.id } };
        } catch (err) {
          logger.error({ err }, 'Failed to send email');
          return { output: { message: 'Failed to send email' }, error: String(err) };
        }
      }

      case 'gmail_search': {
        try {
          const query = input.query as string;
          const maxResults = (input.maxResults as number) ?? 10;
          const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
          url.searchParams.set('q', query);
          url.searchParams.set('maxResults', String(maxResults));

          const listRes = await fetch(url.toString(), { headers });
          const listData = (await listRes.json()) as Record<string, unknown>;
          if (!listRes.ok) {
            return { output: { message: `Gmail API error: ${JSON.stringify(listData)}` } };
          }

          const messageRefs = (listData.messages as Array<Record<string, unknown>>) ?? [];
          const fetchLimit = Math.min(maxResults, 20);
          const messages = await Promise.all(
            messageRefs.slice(0, fetchLimit).map(async (ref) => {
              const msgRes = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
                { headers },
              );
              return msgRes.json() as Promise<Record<string, unknown>>;
            }),
          );

          return {
            output: {
              messages: messages.map((m) => ({
                id: m.id,
                threadId: m.threadId,
                snippet: m.snippet,
                payload: m.payload,
              })),
            },
          };
        } catch (err) {
          logger.error({ err }, 'Failed to search Gmail');
          return { output: { message: 'Failed to search messages' }, error: String(err) };
        }
      }

      case 'gmail_list_labels': {
        try {
          const res = await fetch(
            'https://gmail.googleapis.com/gmail/v1/users/me/labels',
            { headers },
          );
          const data = (await res.json()) as Record<string, unknown>;
          if (!res.ok) {
            return { output: { message: `Gmail API error: ${JSON.stringify(data)}` } };
          }
          return { output: { labels: data.labels } };
        } catch (err) {
          logger.error({ err }, 'Failed to list labels');
          return { output: { message: 'Failed to list labels' }, error: String(err) };
        }
      }

      default:
        return { output: { message: `Unknown tool: ${toolName}` } };
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.connected || !this.accessToken) return false;
    try {
      const res = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/profile',
        { headers: { Authorization: `Bearer ${this.accessToken}` } },
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
