import type { ToolDefinition } from '@hearth/shared';
import type { ToolResult } from '../../agent/types.js';
import type { ConnectorConfig, MCPConnector } from './base-connector.js';
import { logger } from '../../lib/logger.js';

const JIRA_ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]+-\d+$/;
const JIRA_DOMAIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

const JIRA_TOOLS: ToolDefinition[] = [
  {
    name: 'jira_create_issue',
    description: 'Create a new Jira issue',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project key (e.g. PROJ)' },
        summary: { type: 'string', description: 'Issue summary/title' },
        description: { type: 'string', description: 'Issue description' },
        issueType: {
          type: 'string',
          description: 'Issue type (e.g. Task, Bug, Story)',
          default: 'Task',
        },
      },
      required: ['project', 'summary'],
    },
  },
  {
    name: 'jira_search',
    description: 'Search Jira issues using JQL',
    inputSchema: {
      type: 'object',
      properties: {
        jql: { type: 'string', description: 'JQL query string' },
        maxResults: { type: 'number', description: 'Max results to return', default: 20 },
      },
      required: ['jql'],
    },
  },
  {
    name: 'jira_get_issue',
    description: 'Get details of a specific Jira issue',
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: { type: 'string', description: 'Issue key (e.g. PROJ-123)' },
      },
      required: ['issueKey'],
    },
  },
];

export class JiraConnector implements MCPConnector {
  readonly provider = 'jira';
  private connected = false;
  private baseUrl = '';
  private authHeader = '';

  async connect(config: ConnectorConfig): Promise<void> {
    const apiToken = config.credentials['api_token'];
    const domain = config.credentials['domain'];
    const email = config.credentials['email'];
    if (!apiToken || !domain) {
      throw new Error('Jira connector requires api_token and domain credentials');
    }
    if (!email) {
      throw new Error('Jira connector requires email credential');
    }
    if (!JIRA_DOMAIN_PATTERN.test(domain)) {
      throw new Error('Jira domain must contain only alphanumeric characters and hyphens');
    }
    this.baseUrl = `https://${domain}.atlassian.net/rest/api/3`;
    this.authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.baseUrl = '';
    this.authHeader = '';
  }

  listTools(): ToolDefinition[] {
    return JIRA_TOOLS;
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.connected || !this.authHeader) {
      return { output: { message: 'Jira not connected. Configure in Settings.' } };
    }

    const headers = {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    switch (toolName) {
      case 'jira_create_issue': {
        try {
          const project = input.project as string;
          const summary = input.summary as string;
          const description = input.description as string | undefined;
          const issueType = (input.issueType as string) ?? 'Task';

          const body: Record<string, unknown> = {
            fields: {
              project: { key: project },
              summary,
              issuetype: { name: issueType },
              ...(description
                ? {
                    description: {
                      type: 'doc',
                      version: 1,
                      content: [
                        {
                          type: 'paragraph',
                          content: [{ type: 'text', text: description }],
                        },
                      ],
                    },
                  }
                : {}),
            },
          };

          const res = await fetch(`${this.baseUrl}/issue`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          });
          const data = (await res.json()) as Record<string, unknown>;
          if (!res.ok) {
            return { output: { message: `Jira API error: ${JSON.stringify(data)}` } };
          }
          return { output: { message: 'Issue created', key: data.key, id: data.id } };
        } catch (err) {
          logger.error({ err }, 'Failed to create Jira issue');
          return { output: { message: 'Failed to create issue' }, error: String(err) };
        }
      }

      case 'jira_search': {
        try {
          const jql = input.jql as string;
          const maxResults = (input.maxResults as number) ?? 20;
          const url = new URL(`${this.baseUrl}/search`);
          url.searchParams.set('jql', jql);
          url.searchParams.set('maxResults', String(maxResults));

          const res = await fetch(url.toString(), { headers });
          const data = (await res.json()) as Record<string, unknown>;
          if (!res.ok) {
            return { output: { message: `Jira API error: ${JSON.stringify(data)}` } };
          }
          const issues = (data.issues as Array<Record<string, unknown>>) ?? [];
          return {
            output: {
              total: data.total,
              issues: issues.map((i) => ({
                key: i.key,
                fields: i.fields,
              })),
            },
          };
        } catch (err) {
          logger.error({ err }, 'Failed to search Jira');
          return { output: { message: 'Failed to search issues' }, error: String(err) };
        }
      }

      case 'jira_get_issue': {
        try {
          const issueKey = input.issueKey as string;
          if (!JIRA_ISSUE_KEY_PATTERN.test(issueKey)) {
            return { output: { message: 'Invalid issue key format (expected e.g. PROJ-123)' } };
          }
          const res = await fetch(`${this.baseUrl}/issue/${issueKey}`, { headers });
          const data = (await res.json()) as Record<string, unknown>;
          if (!res.ok) {
            return { output: { message: `Jira API error: ${JSON.stringify(data)}` } };
          }
          return { output: { key: data.key, fields: data.fields } };
        } catch (err) {
          logger.error({ err }, 'Failed to get Jira issue');
          return { output: { message: 'Failed to get issue' }, error: String(err) };
        }
      }

      default:
        return { output: { message: `Unknown tool: ${toolName}` } };
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.connected || !this.authHeader) return false;
    try {
      const res = await fetch(`${this.baseUrl}/myself`, {
        headers: { Authorization: this.authHeader, Accept: 'application/json' },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
