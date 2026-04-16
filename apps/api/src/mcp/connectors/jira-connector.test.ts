import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { JiraConnector } from './jira-connector.js';

const VALID_CREDENTIALS = {
  api_token: 'test-token',
  domain: 'mycompany',
  email: 'user@example.com',
};

describe('JiraConnector', () => {
  let connector: JiraConnector;

  beforeEach(() => {
    connector = new JiraConnector();
    mockFetch.mockReset();
  });

  describe('connect', () => {
    it('succeeds with valid credentials', async () => {
      await connector.connect({ provider: 'jira', credentials: VALID_CREDENTIALS });
      expect(connector.listTools().length).toBeGreaterThan(0);
    });

    it('throws with missing api_token and domain', async () => {
      await expect(
        connector.connect({ provider: 'jira', credentials: {} }),
      ).rejects.toThrow('Jira connector requires api_token and domain credentials');
    });

    it('throws with missing email', async () => {
      await expect(
        connector.connect({
          provider: 'jira',
          credentials: { api_token: 'tok', domain: 'dom' },
        }),
      ).rejects.toThrow('Jira connector requires email credential');
    });

    it('throws with invalid domain characters', async () => {
      await expect(
        connector.connect({
          provider: 'jira',
          credentials: { api_token: 'tok', domain: 'evil/../hack', email: 'a@b.com' },
        }),
      ).rejects.toThrow('Jira domain must contain only alphanumeric');
    });
  });

  describe('disconnect', () => {
    it('clears state', async () => {
      await connector.connect({ provider: 'jira', credentials: VALID_CREDENTIALS });
      await connector.disconnect();

      const result = await connector.executeTool('jira_search', { jql: 'project=TEST' });
      expect(result.output.message).toContain('not connected');
    });
  });

  describe('listTools', () => {
    it('returns 3 tools', () => {
      const tools = connector.listTools();
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name)).toEqual([
        'jira_create_issue',
        'jira_search',
        'jira_get_issue',
      ]);
    });
  });

  describe('executeTool', () => {
    it('returns error when not connected', async () => {
      const result = await connector.executeTool('jira_search', { jql: 'test' });
      expect(result.output.message).toContain('not connected');
    });

    describe('jira_create_issue', () => {
      beforeEach(async () => {
        await connector.connect({ provider: 'jira', credentials: VALID_CREDENTIALS });
      });

      it('creates issue successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: '10001', key: 'PROJ-42' }),
        });

        const result = await connector.executeTool('jira_create_issue', {
          project: 'PROJ',
          summary: 'Fix bug',
          description: 'Something is broken',
          issueType: 'Bug',
        });

        expect(result.output.message).toBe('Issue created');
        expect(result.output.key).toBe('PROJ-42');
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/issue'),
          expect.objectContaining({ method: 'POST' }),
        );
      });

      it('creates issue without description', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: '10002', key: 'PROJ-43' }),
        });

        const result = await connector.executeTool('jira_create_issue', {
          project: 'PROJ',
          summary: 'Simple task',
        });

        expect(result.output.key).toBe('PROJ-43');
      });

      it('handles API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ errorMessages: ['Project not found'] }),
        });

        const result = await connector.executeTool('jira_create_issue', {
          project: 'BAD',
          summary: 'Test',
        });

        expect(result.output.message).toContain('Jira API error');
      });

      it('handles fetch failure', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await connector.executeTool('jira_create_issue', {
          project: 'PROJ',
          summary: 'Test',
        });

        expect(result.output.message).toBe('Failed to create issue');
        expect(result.error).toContain('Network error');
      });
    });

    describe('jira_search', () => {
      beforeEach(async () => {
        await connector.connect({ provider: 'jira', credentials: VALID_CREDENTIALS });
      });

      it('searches issues successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            total: 2,
            issues: [
              { key: 'PROJ-1', fields: { summary: 'First' } },
              { key: 'PROJ-2', fields: { summary: 'Second' } },
            ],
          }),
        });

        const result = await connector.executeTool('jira_search', {
          jql: 'project=PROJ',
          maxResults: 10,
        });

        const output = result.output as { total: number; issues: Array<{ key: string }> };
        expect(output.total).toBe(2);
        expect(output.issues).toHaveLength(2);
      });

      it('handles API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ errorMessages: ['Bad JQL'] }),
        });

        const result = await connector.executeTool('jira_search', { jql: 'bad query' });
        expect(result.output.message).toContain('Jira API error');
      });
    });

    describe('jira_get_issue', () => {
      beforeEach(async () => {
        await connector.connect({ provider: 'jira', credentials: VALID_CREDENTIALS });
      });

      it('gets issue successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            key: 'PROJ-123',
            fields: { summary: 'Test issue', status: { name: 'Open' } },
          }),
        });

        const result = await connector.executeTool('jira_get_issue', {
          issueKey: 'PROJ-123',
        });

        expect(result.output.key).toBe('PROJ-123');
        expect(result.output.fields).toBeDefined();
      });

      it('handles API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ errorMessages: ['Issue not found'] }),
        });

        const result = await connector.executeTool('jira_get_issue', {
          issueKey: 'BAD-999',
        });

        expect(result.output.message).toContain('Jira API error');
      });

      it('rejects invalid issue key with path traversal', async () => {
        const result = await connector.executeTool('jira_get_issue', {
          issueKey: '../../myself',
        });
        expect(result.output.message).toContain('Invalid issue key format');
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    it('returns error for unknown tool', async () => {
      await connector.connect({ provider: 'jira', credentials: VALID_CREDENTIALS });

      const result = await connector.executeTool('jira_unknown', {});
      expect(result.output.message).toContain('Unknown tool');
    });
  });

  describe('healthCheck', () => {
    it('returns false when not connected', async () => {
      expect(await connector.healthCheck()).toBe(false);
    });

    it('returns true on successful API call', async () => {
      await connector.connect({ provider: 'jira', credentials: VALID_CREDENTIALS });

      mockFetch.mockResolvedValueOnce({ ok: true });
      expect(await connector.healthCheck()).toBe(true);
    });

    it('returns false on failed API call', async () => {
      await connector.connect({ provider: 'jira', credentials: VALID_CREDENTIALS });

      mockFetch.mockResolvedValueOnce({ ok: false });
      expect(await connector.healthCheck()).toBe(false);
    });

    it('returns false on network error', async () => {
      await connector.connect({ provider: 'jira', credentials: VALID_CREDENTIALS });

      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      expect(await connector.healthCheck()).toBe(false);
    });
  });

  it('has provider set to jira', () => {
    expect(connector.provider).toBe('jira');
  });
});
