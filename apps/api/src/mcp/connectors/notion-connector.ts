import type { ToolDefinition } from '@hearth/shared';
import type { ToolResult } from '../../agent/types.js';
import type { ConnectorConfig, MCPConnector } from './base-connector.js';
import { logger } from '../../lib/logger.js';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const NOTION_TOOLS: ToolDefinition[] = [
  {
    name: 'notion_search',
    description: 'Search Notion pages and databases',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        filter: {
          type: 'string',
          description: 'Filter by object type',
          enum: ['page', 'database'],
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'notion_get_page',
    description: 'Get a Notion page by ID',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'Notion page ID' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'notion_create_page',
    description: 'Create a new Notion page',
    inputSchema: {
      type: 'object',
      properties: {
        parentId: { type: 'string', description: 'Parent page or database ID' },
        title: { type: 'string', description: 'Page title' },
        content: { type: 'string', description: 'Page content in markdown' },
      },
      required: ['parentId', 'title'],
    },
  },
];

function markdownToNotionBlocks(markdown: string): Array<Record<string, unknown>> {
  return markdown
    .split('\n')
    .filter(Boolean)
    .map((line) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: line } }],
      },
    }));
}

export class NotionConnector implements MCPConnector {
  readonly provider = 'notion';
  private connected = false;
  private apiKey = '';

  async connect(config: ConnectorConfig): Promise<void> {
    if (!config.credentials['api_key']) {
      throw new Error('Notion connector requires api_key credential');
    }
    this.apiKey = config.credentials['api_key'];
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.apiKey = '';
  }

  listTools(): ToolDefinition[] {
    return NOTION_TOOLS;
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    };
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.connected || !this.apiKey) {
      return { output: { message: 'Notion not connected. Configure in Settings.' } };
    }

    const headers = this.getHeaders();

    switch (toolName) {
      case 'notion_search': {
        try {
          const query = input.query as string;
          const filter = input.filter as string | undefined;
          const body: Record<string, unknown> = { query };
          if (filter) {
            body.filter = { value: filter, property: 'object' };
          }

          const res = await fetch(`${NOTION_API_BASE}/search`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          });
          const data = (await res.json()) as Record<string, unknown>;
          if (!res.ok) {
            return { output: { message: `Notion API error: ${JSON.stringify(data)}` } };
          }
          return { output: { results: data.results } };
        } catch (err) {
          logger.error({ err }, 'Failed to search Notion');
          return { output: { message: 'Failed to search' }, error: String(err) };
        }
      }

      case 'notion_get_page': {
        try {
          const pageId = input.pageId as string;

          const [pageRes, blocksRes] = await Promise.all([
            fetch(`${NOTION_API_BASE}/pages/${pageId}`, { headers }),
            fetch(`${NOTION_API_BASE}/blocks/${pageId}/children`, { headers }),
          ]);

          const page = (await pageRes.json()) as Record<string, unknown>;
          const blocks = (await blocksRes.json()) as Record<string, unknown>;

          if (!pageRes.ok) {
            return { output: { message: `Notion API error: ${JSON.stringify(page)}` } };
          }
          if (!blocksRes.ok) {
            return { output: { message: `Notion API error fetching blocks: ${JSON.stringify(blocks)}` } };
          }

          return { output: { page, blocks: blocks.results } };
        } catch (err) {
          logger.error({ err }, 'Failed to get Notion page');
          return { output: { message: 'Failed to get page' }, error: String(err) };
        }
      }

      case 'notion_create_page': {
        try {
          const parentId = input.parentId as string;
          const title = input.title as string;
          const content = input.content as string | undefined;

          const body: Record<string, unknown> = {
            parent: { page_id: parentId },
            properties: {
              title: {
                title: [{ text: { content: title } }],
              },
            },
          };

          if (content) {
            body.children = markdownToNotionBlocks(content);
          }

          const res = await fetch(`${NOTION_API_BASE}/pages`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          });
          const data = (await res.json()) as Record<string, unknown>;
          if (!res.ok) {
            return { output: { message: `Notion API error: ${JSON.stringify(data)}` } };
          }
          return { output: { message: 'Page created', id: data.id, url: data.url } };
        } catch (err) {
          logger.error({ err }, 'Failed to create Notion page');
          return { output: { message: 'Failed to create page' }, error: String(err) };
        }
      }

      default:
        return { output: { message: `Unknown tool: ${toolName}` } };
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.connected || !this.apiKey) return false;
    try {
      const res = await fetch(`${NOTION_API_BASE}/search`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ page_size: 1 }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
