import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { NotionConnector } from './notion-connector.js';

describe('NotionConnector', () => {
  let connector: NotionConnector;

  beforeEach(() => {
    connector = new NotionConnector();
    mockFetch.mockReset();
  });

  describe('connect', () => {
    it('succeeds with valid credentials', async () => {
      await connector.connect({
        provider: 'notion',
        credentials: { api_key: 'ntn_test123' },
      });
      expect(connector.listTools().length).toBeGreaterThan(0);
    });

    it('throws with missing api_key', async () => {
      await expect(
        connector.connect({ provider: 'notion', credentials: {} }),
      ).rejects.toThrow('Notion connector requires api_key credential');
    });
  });

  describe('disconnect', () => {
    it('clears state', async () => {
      await connector.connect({
        provider: 'notion',
        credentials: { api_key: 'ntn_test123' },
      });
      await connector.disconnect();

      const result = await connector.executeTool('notion_search', { query: 'test' });
      expect(result.output.message).toContain('not connected');
    });
  });

  describe('listTools', () => {
    it('returns 3 tools', () => {
      const tools = connector.listTools();
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name)).toEqual([
        'notion_search',
        'notion_get_page',
        'notion_create_page',
      ]);
    });
  });

  describe('executeTool', () => {
    it('returns error when not connected', async () => {
      const result = await connector.executeTool('notion_search', { query: 'test' });
      expect(result.output.message).toContain('not connected');
    });

    describe('notion_search', () => {
      beforeEach(async () => {
        await connector.connect({
          provider: 'notion',
          credentials: { api_key: 'ntn_test123' },
        });
      });

      it('searches successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [
              { id: 'page-1', object: 'page' },
              { id: 'page-2', object: 'page' },
            ],
          }),
        });

        const result = await connector.executeTool('notion_search', { query: 'meeting' });
        const output = result.output as { results: Array<{ id: string }> };
        expect(output.results).toHaveLength(2);
      });

      it('searches with filter', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: [{ id: 'db-1', object: 'database' }] }),
        });

        const result = await connector.executeTool('notion_search', {
          query: 'tasks',
          filter: 'database',
        });

        const output = result.output as { results: Array<{ id: string }> };
        expect(output.results).toHaveLength(1);
        // Verify filter was sent in body
        const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
        expect(callBody.filter).toEqual({ value: 'database', property: 'object' });
      });

      it('handles API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ object: 'error', message: 'Unauthorized' }),
        });

        const result = await connector.executeTool('notion_search', { query: 'test' });
        expect(result.output.message).toContain('Notion API error');
      });

      it('handles fetch failure', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await connector.executeTool('notion_search', { query: 'test' });
        expect(result.output.message).toBe('Failed to search');
        expect(result.error).toContain('Network error');
      });
    });

    describe('notion_get_page', () => {
      beforeEach(async () => {
        await connector.connect({
          provider: 'notion',
          credentials: { api_key: 'ntn_test123' },
        });
      });

      it('gets page with blocks', async () => {
        // Page fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'page-1', object: 'page', properties: {} }),
        });
        // Blocks fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [
              { type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'Hello' } }] } },
            ],
          }),
        });

        const result = await connector.executeTool('notion_get_page', { pageId: 'page-1' });
        const output = result.output as {
          page: { id: string };
          blocks: Array<{ type: string }>;
        };
        expect(output.page.id).toBe('page-1');
        expect(output.blocks).toHaveLength(1);
      });

      it('handles API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ object: 'error', message: 'Not found' }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: [] }),
        });

        const result = await connector.executeTool('notion_get_page', { pageId: 'bad-id' });
        expect(result.output.message).toContain('Notion API error');
      });

      it('handles blocks fetch failure while page succeeds', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'page-1', properties: {} }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ object: 'error', message: 'Restricted' }),
        });

        const result = await connector.executeTool('notion_get_page', { pageId: 'page-1' });
        expect(result.output.message).toContain('Notion API error fetching blocks');
      });
    });

    describe('notion_create_page', () => {
      beforeEach(async () => {
        await connector.connect({
          provider: 'notion',
          credentials: { api_key: 'ntn_test123' },
        });
      });

      it('creates page successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'new-page-1',
            url: 'https://notion.so/new-page-1',
          }),
        });

        const result = await connector.executeTool('notion_create_page', {
          parentId: 'parent-1',
          title: 'My New Page',
          content: 'Line 1\nLine 2',
        });

        expect(result.output.message).toBe('Page created');
        expect(result.output.id).toBe('new-page-1');
        expect(result.output.url).toBe('https://notion.so/new-page-1');
      });

      it('creates page without content', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'new-page-2', url: 'https://notion.so/new-page-2' }),
        });

        const result = await connector.executeTool('notion_create_page', {
          parentId: 'parent-1',
          title: 'Empty Page',
        });

        expect(result.output.message).toBe('Page created');
        const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
        expect(callBody.children).toBeUndefined();
      });

      it('handles API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ object: 'error', message: 'Validation error' }),
        });

        const result = await connector.executeTool('notion_create_page', {
          parentId: 'bad-parent',
          title: 'Test',
        });

        expect(result.output.message).toContain('Notion API error');
      });
    });

    it('returns error for unknown tool', async () => {
      await connector.connect({
        provider: 'notion',
        credentials: { api_key: 'ntn_test123' },
      });

      const result = await connector.executeTool('notion_unknown', {});
      expect(result.output.message).toContain('Unknown tool');
    });
  });

  describe('healthCheck', () => {
    it('returns false when not connected', async () => {
      expect(await connector.healthCheck()).toBe(false);
    });

    it('returns true on successful API call', async () => {
      await connector.connect({
        provider: 'notion',
        credentials: { api_key: 'ntn_test123' },
      });

      mockFetch.mockResolvedValueOnce({ ok: true });
      expect(await connector.healthCheck()).toBe(true);
    });

    it('returns false on failed API call', async () => {
      await connector.connect({
        provider: 'notion',
        credentials: { api_key: 'ntn_test123' },
      });

      mockFetch.mockResolvedValueOnce({ ok: false });
      expect(await connector.healthCheck()).toBe(false);
    });

    it('returns false on network error', async () => {
      await connector.connect({
        provider: 'notion',
        credentials: { api_key: 'ntn_test123' },
      });

      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      expect(await connector.healthCheck()).toBe(false);
    });
  });

  it('has provider set to notion', () => {
    expect(connector.provider).toBe('notion');
  });
});
