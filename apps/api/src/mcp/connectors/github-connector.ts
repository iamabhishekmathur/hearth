import type { ToolDefinition } from '@hearth/shared';
import type { ToolResult } from '../../agent/types.js';
import type { ConnectorConfig, MCPConnector } from './base-connector.js';
import { logger } from '../../lib/logger.js';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_SLUG_PATTERN = /^[a-zA-Z0-9._-]+$/;

function validateSlug(value: string, label: string): string | null {
  if (!GITHUB_SLUG_PATTERN.test(value) || value === '..' || value === '.') {
    return `Invalid ${label}: must contain only alphanumeric characters, dots, hyphens, and underscores`;
  }
  return null;
}

const GITHUB_TOOLS: ToolDefinition[] = [
  {
    name: 'github_search_code',
    description: 'Search code across GitHub repositories',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (GitHub code search syntax)' },
        perPage: { type: 'number', description: 'Results per page', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'github_list_prs',
    description: 'List pull requests for a repository',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        state: {
          type: 'string',
          description: 'PR state (open, closed, all)',
          default: 'open',
        },
        perPage: { type: 'number', description: 'Results per page', default: 10 },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'github_create_issue',
    description: 'Create a new GitHub issue',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue body (markdown)' },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Labels to apply',
        },
      },
      required: ['owner', 'repo', 'title'],
    },
  },
  {
    name: 'github_get_repo',
    description: 'Get repository information',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
      },
      required: ['owner', 'repo'],
    },
  },
];

export class GitHubConnector implements MCPConnector {
  readonly provider = 'github';
  private connected = false;
  private accessToken = '';

  async connect(config: ConnectorConfig): Promise<void> {
    if (!config.credentials['access_token']) {
      throw new Error('GitHub connector requires access_token credential');
    }
    this.accessToken = config.credentials['access_token'];
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.accessToken = '';
  }

  listTools(): ToolDefinition[] {
    return GITHUB_TOOLS;
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.connected || !this.accessToken) {
      return { output: { message: 'GitHub not connected. Configure in Settings.' } };
    }

    const headers = this.getHeaders();

    switch (toolName) {
      case 'github_search_code': {
        try {
          const query = input.query as string;
          const perPage = (input.perPage as number) ?? 10;
          const url = new URL(`${GITHUB_API_BASE}/search/code`);
          url.searchParams.set('q', query);
          url.searchParams.set('per_page', String(perPage));

          const res = await fetch(url.toString(), { headers });
          const data = (await res.json()) as Record<string, unknown>;
          if (!res.ok) {
            return { output: { message: `GitHub API error: ${JSON.stringify(data)}` } };
          }
          return { output: { total_count: data.total_count, items: data.items } };
        } catch (err) {
          logger.error({ err }, 'Failed to search GitHub code');
          return { output: { message: 'Failed to search code' }, error: String(err) };
        }
      }

      case 'github_list_prs': {
        try {
          const owner = input.owner as string;
          const repo = input.repo as string;
          const ownerErr = validateSlug(owner, 'owner') ?? validateSlug(repo, 'repo');
          if (ownerErr) return { output: { message: ownerErr } };
          const state = (input.state as string) ?? 'open';
          const perPage = (input.perPage as number) ?? 10;
          const url = new URL(`${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls`);
          url.searchParams.set('state', state);
          url.searchParams.set('per_page', String(perPage));

          const res = await fetch(url.toString(), { headers });
          const data = (await res.json()) as unknown;
          if (!res.ok) {
            return { output: { message: `GitHub API error: ${JSON.stringify(data)}` } };
          }
          const prs = data as Array<Record<string, unknown>>;
          return {
            output: {
              pullRequests: prs.map((pr) => ({
                number: pr.number,
                title: pr.title,
                state: pr.state,
                user: (pr.user as Record<string, unknown>)?.login,
                created_at: pr.created_at,
                updated_at: pr.updated_at,
              })),
            },
          };
        } catch (err) {
          logger.error({ err }, 'Failed to list GitHub PRs');
          return { output: { message: 'Failed to list pull requests' }, error: String(err) };
        }
      }

      case 'github_create_issue': {
        try {
          const owner = input.owner as string;
          const repo = input.repo as string;
          const slugErr = validateSlug(owner, 'owner') ?? validateSlug(repo, 'repo');
          if (slugErr) return { output: { message: slugErr } };
          const title = input.title as string;
          const body = input.body as string | undefined;
          const labels = input.labels as string[] | undefined;

          const res = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/issues`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body, labels }),
          });
          const data = (await res.json()) as Record<string, unknown>;
          if (!res.ok) {
            return { output: { message: `GitHub API error: ${JSON.stringify(data)}` } };
          }
          return {
            output: { message: 'Issue created', number: data.number, url: data.html_url },
          };
        } catch (err) {
          logger.error({ err }, 'Failed to create GitHub issue');
          return { output: { message: 'Failed to create issue' }, error: String(err) };
        }
      }

      case 'github_get_repo': {
        try {
          const owner = input.owner as string;
          const repo = input.repo as string;
          const slugErr = validateSlug(owner, 'owner') ?? validateSlug(repo, 'repo');
          if (slugErr) return { output: { message: slugErr } };
          const res = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, { headers });
          const data = (await res.json()) as Record<string, unknown>;
          if (!res.ok) {
            return { output: { message: `GitHub API error: ${JSON.stringify(data)}` } };
          }
          return {
            output: {
              name: data.name,
              full_name: data.full_name,
              description: data.description,
              language: data.language,
              stargazers_count: data.stargazers_count,
              forks_count: data.forks_count,
              open_issues_count: data.open_issues_count,
              default_branch: data.default_branch,
              html_url: data.html_url,
            },
          };
        } catch (err) {
          logger.error({ err }, 'Failed to get GitHub repo');
          return { output: { message: 'Failed to get repository' }, error: String(err) };
        }
      }

      default:
        return { output: { message: `Unknown tool: ${toolName}` } };
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.connected || !this.accessToken) return false;
    try {
      const res = await fetch(`${GITHUB_API_BASE}/user`, {
        headers: this.getHeaders(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
