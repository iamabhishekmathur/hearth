import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { GDriveConnector } from './gdrive-connector.js';

describe('GDriveConnector', () => {
  let connector: GDriveConnector;

  beforeEach(() => {
    connector = new GDriveConnector();
    mockFetch.mockReset();
  });

  describe('connect', () => {
    it('succeeds with valid credentials', async () => {
      await connector.connect({
        provider: 'gdrive',
        credentials: { access_token: 'test-token' },
      });
      expect(connector.listTools().length).toBeGreaterThan(0);
    });

    it('throws with missing access_token', async () => {
      await expect(
        connector.connect({ provider: 'gdrive', credentials: {} }),
      ).rejects.toThrow('Google Drive connector requires access_token credential');
    });
  });

  describe('disconnect', () => {
    it('clears state', async () => {
      await connector.connect({
        provider: 'gdrive',
        credentials: { access_token: 'test-token' },
      });
      await connector.disconnect();

      const result = await connector.executeTool('gdrive_search', { query: 'test' });
      expect(result.output.message).toContain('not connected');
    });
  });

  describe('listTools', () => {
    it('returns 3 tools', () => {
      const tools = connector.listTools();
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name)).toEqual([
        'gdrive_search',
        'gdrive_read_file',
        'gdrive_list_files',
      ]);
    });
  });

  describe('executeTool', () => {
    it('returns error when not connected', async () => {
      const result = await connector.executeTool('gdrive_search', { query: 'test' });
      expect(result.output.message).toContain('not connected');
    });

    describe('gdrive_search', () => {
      beforeEach(async () => {
        await connector.connect({
          provider: 'gdrive',
          credentials: { access_token: 'test-token' },
        });
      });

      it('searches files successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            files: [
              { id: 'file-1', name: 'Report.docx', mimeType: 'application/vnd.google-apps.document' },
            ],
          }),
        });

        const result = await connector.executeTool('gdrive_search', { query: 'report' });
        const output = result.output as { files: Array<{ id: string }> };
        expect(output.files).toHaveLength(1);
        expect(output.files[0].id).toBe('file-1');
      });

      it('handles API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: 'Unauthorized' } }),
        });

        const result = await connector.executeTool('gdrive_search', { query: 'test' });
        expect(result.output.message).toContain('Drive API error');
      });

      it('handles fetch failure', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await connector.executeTool('gdrive_search', { query: 'test' });
        expect(result.output.message).toBe('Failed to search files');
        expect(result.error).toContain('Network error');
      });
    });

    describe('gdrive_read_file', () => {
      beforeEach(async () => {
        await connector.connect({
          provider: 'gdrive',
          credentials: { access_token: 'test-token' },
        });
      });

      it('reads a regular file', async () => {
        // Metadata fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ mimeType: 'text/plain', name: 'readme.txt' }),
        });
        // Content fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          text: async () => 'Hello world content',
        });

        const result = await connector.executeTool('gdrive_read_file', { fileId: 'file-1' });
        const output = result.output as { name: string; content: string; mimeType: string };
        expect(output.name).toBe('readme.txt');
        expect(output.content).toBe('Hello world content');
        expect(output.mimeType).toBe('text/plain');
      });

      it('exports Google Docs files', async () => {
        // Metadata fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            mimeType: 'application/vnd.google-apps.document',
            name: 'My Doc',
          }),
        });
        // Export fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          text: async () => 'Exported plain text content',
        });

        const result = await connector.executeTool('gdrive_read_file', { fileId: 'doc-1' });
        const output = result.output as { name: string; content: string };
        expect(output.name).toBe('My Doc');
        expect(output.content).toBe('Exported plain text content');
        // Verify export URL was called
        expect(mockFetch).toHaveBeenCalledTimes(2);
        const exportCall = mockFetch.mock.calls[1][0] as string;
        expect(exportCall).toContain('/export');
      });

      it('rejects invalid fileId with path traversal', async () => {
        const result = await connector.executeTool('gdrive_read_file', { fileId: '../../etc/passwd' });
        expect(result.output.message).toContain('Invalid fileId');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('handles metadata API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: 'Not found' } }),
        });

        const result = await connector.executeTool('gdrive_read_file', { fileId: 'bad-id' });
        expect(result.output.message).toContain('Drive API error');
      });
    });

    describe('gdrive_list_files', () => {
      beforeEach(async () => {
        await connector.connect({
          provider: 'gdrive',
          credentials: { access_token: 'test-token' },
        });
      });

      it('lists files in root', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            files: [
              { id: 'f1', name: 'File1.txt' },
              { id: 'f2', name: 'File2.txt' },
            ],
          }),
        });

        const result = await connector.executeTool('gdrive_list_files', {});
        const output = result.output as { files: Array<{ id: string }> };
        expect(output.files).toHaveLength(2);
      });

      it('rejects invalid folderId', async () => {
        const result = await connector.executeTool('gdrive_list_files', {
          folderId: '../../../secrets',
        });
        expect(result.output.message).toContain('Invalid folderId');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('lists files in a folder', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ files: [{ id: 'f1', name: 'Nested.txt' }] }),
        });

        const result = await connector.executeTool('gdrive_list_files', {
          folderId: 'folder-123',
        });
        const output = result.output as { files: Array<{ id: string }> };
        expect(output.files).toHaveLength(1);
        // Verify folder filter in URL
        const calledUrl = mockFetch.mock.calls[0][0] as string;
        expect(calledUrl).toContain('folder-123');
      });

      it('handles API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: 'Forbidden' } }),
        });

        const result = await connector.executeTool('gdrive_list_files', {});
        expect(result.output.message).toContain('Drive API error');
      });
    });

    it('returns error for unknown tool', async () => {
      await connector.connect({
        provider: 'gdrive',
        credentials: { access_token: 'test-token' },
      });

      const result = await connector.executeTool('gdrive_unknown', {});
      expect(result.output.message).toContain('Unknown tool');
    });
  });

  describe('healthCheck', () => {
    it('returns false when not connected', async () => {
      expect(await connector.healthCheck()).toBe(false);
    });

    it('returns true on successful API call', async () => {
      await connector.connect({
        provider: 'gdrive',
        credentials: { access_token: 'test-token' },
      });

      mockFetch.mockResolvedValueOnce({ ok: true });
      expect(await connector.healthCheck()).toBe(true);
    });

    it('returns false on failed API call', async () => {
      await connector.connect({
        provider: 'gdrive',
        credentials: { access_token: 'test-token' },
      });

      mockFetch.mockResolvedValueOnce({ ok: false });
      expect(await connector.healthCheck()).toBe(false);
    });

    it('returns false on network error', async () => {
      await connector.connect({
        provider: 'gdrive',
        credentials: { access_token: 'test-token' },
      });

      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      expect(await connector.healthCheck()).toBe(false);
    });
  });

  it('has provider set to gdrive', () => {
    expect(connector.provider).toBe('gdrive');
  });
});
