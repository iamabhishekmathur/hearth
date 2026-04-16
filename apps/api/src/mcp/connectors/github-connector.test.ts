import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { GitHubConnector } from './github-connector.js';

describe('GitHubConnector', () => {
  let connector: GitHubConnector;

  beforeEach(() => {
    connector = new GitHubConnector();
    mockFetch.mockReset();
  });

  describe('connect', () => {
    it('succeeds with valid credentials', async () => {
      await connector.connect({
        provider: 'github',
        credentials: { access_token: 'ghp_test123' },
      });
      expect(connector.listTools().length).toBeGreaterThan(0);
    });

    it('throws with missing access_token', async () => {
      await expect(
        connector.connect({ provider: 'github', credentials: {} }),
      ).rejects.toThrow('GitHub connector requires access_token credential');
    });
  });

  describe('disconnect', () => {
    it('clears state', async () => {
      await connector.connect({
        provider: 'github',
        credentials: { access_token: 'ghp_test123' },
      });
      await connector.disconnect();

      const result = await connector.executeTool('github_search_code', { query: 'test' });
      expect(result.output.message).toContain('not connected');
    });
  });

  describe('listTools', () => {
    it('returns 4 tools', () => {
      const tools = connector.listTools();
      expect(tools).toHaveLength(4);
      expect(tools.map((t) => t.name)).toEqual([
        'github_search_code',
        'github_list_prs',
        'github_create_issue',
        'github_get_repo',
      ]);
    });
  });

  describe('executeTool', () => {
    it('returns error when not connected', async () => {
      const result = await connector.executeTool('github_search_code', { query: 'test' });
      expect(result.output.message).toContain('not connected');
    });

    describe('github_search_code', () => {
      beforeEach(async () => {
        await connector.connect({
          provider: 'github',
          credentials: { access_token: 'ghp_test123' },
        });
      });

      it('searches code successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            total_count: 42,
            items: [
              { name: 'index.ts', path: 'src/index.ts', repository: { full_name: 'org/repo' } },
            ],
          }),
        });

        const result = await connector.executeTool('github_search_code', {
          query: 'className',
          perPage: 5,
        });

        const output = result.output as { total_count: number; items: unknown[] };
        expect(output.total_count).toBe(42);
        expect(output.items).toHaveLength(1);
      });

      it('handles API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ message: 'Validation Failed' }),
        });

        const result = await connector.executeTool('github_search_code', { query: '' });
        expect(result.output.message).toContain('GitHub API error');
      });

      it('handles fetch failure', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await connector.executeTool('github_search_code', { query: 'test' });
        expect(result.output.message).toBe('Failed to search code');
        expect(result.error).toContain('Network error');
      });
    });

    describe('github_list_prs', () => {
      beforeEach(async () => {
        await connector.connect({
          provider: 'github',
          credentials: { access_token: 'ghp_test123' },
        });
      });

      it('lists PRs successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              number: 1,
              title: 'Fix bug',
              state: 'open',
              user: { login: 'dev1' },
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-02T00:00:00Z',
            },
            {
              number: 2,
              title: 'Add feature',
              state: 'open',
              user: { login: 'dev2' },
              created_at: '2024-01-03T00:00:00Z',
              updated_at: '2024-01-04T00:00:00Z',
            },
          ],
        });

        const result = await connector.executeTool('github_list_prs', {
          owner: 'org',
          repo: 'repo',
        });

        const output = result.output as {
          pullRequests: Array<{ number: number; user: string }>;
        };
        expect(output.pullRequests).toHaveLength(2);
        expect(output.pullRequests[0].number).toBe(1);
        expect(output.pullRequests[0].user).toBe('dev1');
      });

      it('handles API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ message: 'Not Found' }),
        });

        const result = await connector.executeTool('github_list_prs', {
          owner: 'bad',
          repo: 'repo',
        });

        expect(result.output.message).toContain('GitHub API error');
      });

      it('rejects owner with path traversal characters', async () => {
        const result = await connector.executeTool('github_list_prs', {
          owner: '../../../etc',
          repo: 'passwd',
        });
        expect(result.output.message).toContain('Invalid owner');
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    describe('github_create_issue', () => {
      beforeEach(async () => {
        await connector.connect({
          provider: 'github',
          credentials: { access_token: 'ghp_test123' },
        });
      });

      it('creates issue successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            number: 42,
            html_url: 'https://github.com/org/repo/issues/42',
          }),
        });

        const result = await connector.executeTool('github_create_issue', {
          owner: 'org',
          repo: 'repo',
          title: 'Bug report',
          body: 'Something is broken',
          labels: ['bug'],
        });

        expect(result.output.message).toBe('Issue created');
        expect(result.output.number).toBe(42);
        expect(result.output.url).toBe('https://github.com/org/repo/issues/42');
      });

      it('handles API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ message: 'Validation Failed' }),
        });

        const result = await connector.executeTool('github_create_issue', {
          owner: 'org',
          repo: 'repo',
          title: '',
        });

        expect(result.output.message).toContain('GitHub API error');
      });

      it('handles fetch failure', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await connector.executeTool('github_create_issue', {
          owner: 'org',
          repo: 'repo',
          title: 'Test',
        });

        expect(result.output.message).toBe('Failed to create issue');
        expect(result.error).toContain('Network error');
      });
    });

    describe('github_get_repo', () => {
      beforeEach(async () => {
        await connector.connect({
          provider: 'github',
          credentials: { access_token: 'ghp_test123' },
        });
      });

      it('gets repo info successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            name: 'repo',
            full_name: 'org/repo',
            description: 'A cool project',
            language: 'TypeScript',
            stargazers_count: 100,
            forks_count: 20,
            open_issues_count: 5,
            default_branch: 'main',
            html_url: 'https://github.com/org/repo',
          }),
        });

        const result = await connector.executeTool('github_get_repo', {
          owner: 'org',
          repo: 'repo',
        });

        const output = result.output as { name: string; stargazers_count: number };
        expect(output.name).toBe('repo');
        expect(output.stargazers_count).toBe(100);
      });

      it('handles API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ message: 'Not Found' }),
        });

        const result = await connector.executeTool('github_get_repo', {
          owner: 'bad',
          repo: 'repo',
        });

        expect(result.output.message).toContain('GitHub API error');
      });
    });

    it('returns error for unknown tool', async () => {
      await connector.connect({
        provider: 'github',
        credentials: { access_token: 'ghp_test123' },
      });

      const result = await connector.executeTool('github_unknown', {});
      expect(result.output.message).toContain('Unknown tool');
    });
  });

  describe('healthCheck', () => {
    it('returns false when not connected', async () => {
      expect(await connector.healthCheck()).toBe(false);
    });

    it('returns true on successful API call', async () => {
      await connector.connect({
        provider: 'github',
        credentials: { access_token: 'ghp_test123' },
      });

      mockFetch.mockResolvedValueOnce({ ok: true });
      expect(await connector.healthCheck()).toBe(true);
    });

    it('returns false on failed API call', async () => {
      await connector.connect({
        provider: 'github',
        credentials: { access_token: 'ghp_test123' },
      });

      mockFetch.mockResolvedValueOnce({ ok: false });
      expect(await connector.healthCheck()).toBe(false);
    });

    it('returns false on network error', async () => {
      await connector.connect({
        provider: 'github',
        credentials: { access_token: 'ghp_test123' },
      });

      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      expect(await connector.healthCheck()).toBe(false);
    });
  });

  it('has provider set to github', () => {
    expect(connector.provider).toBe('github');
  });
});
