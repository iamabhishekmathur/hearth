import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock web-service
vi.mock('./web-service.js', () => ({
  webFetch: vi.fn(),
}));

// Mock logger
vi.mock('../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock MCP gateway (dynamic import)
vi.mock('../mcp/gateway.js', () => ({
  mcpGateway: {
    executeTool: vi.fn(),
  },
}));

import { webFetch } from './web-service.js';
import { extractContent } from './task-context-extractor.js';

describe('task-context-extractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('note type', () => {
    it('passes through rawValue as extractedText', async () => {
      const result = await extractContent({
        type: 'note',
        rawValue: 'This is a note',
        mimeType: null,
        storagePath: null,
        mcpIntegrationId: null,
        mcpResourceType: null,
        mcpResourceId: null,
      });

      expect(result.extractedText).toBe('This is a note');
      expect(result.extractedTitle).toBeNull();
      expect(result.error).toBeUndefined();
    });
  });

  describe('text_block type', () => {
    it('passes through rawValue as extractedText', async () => {
      const longText = 'Spec content '.repeat(100);
      const result = await extractContent({
        type: 'text_block',
        rawValue: longText,
        mimeType: null,
        storagePath: null,
        mcpIntegrationId: null,
        mcpResourceType: null,
        mcpResourceId: null,
      });

      expect(result.extractedText).toBe(longText);
    });
  });

  describe('link type', () => {
    it('fetches URL content via webFetch', async () => {
      (webFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Fetched page content',
        title: 'Example Page',
      });

      const result = await extractContent({
        type: 'link',
        rawValue: 'https://example.com/article',
        mimeType: null,
        storagePath: null,
        mcpIntegrationId: null,
        mcpResourceType: null,
        mcpResourceId: null,
      });

      expect(result.extractedText).toBe('Fetched page content');
      expect(result.extractedTitle).toBe('Example Page');
      expect(webFetch).toHaveBeenCalledWith('https://example.com/article', { maxLength: 50000 });
    });

    it('returns error when webFetch fails', async () => {
      (webFetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('HTTP 404'));

      const result = await extractContent({
        type: 'link',
        rawValue: 'https://example.com/missing',
        mimeType: null,
        storagePath: null,
        mcpIntegrationId: null,
        mcpResourceType: null,
        mcpResourceId: null,
      });

      expect(result.extractedText).toBeNull();
      expect(result.error).toBe('HTTP 404');
    });
  });

  describe('image type', () => {
    it('returns null for images (vision analysis is opt-in)', async () => {
      const result = await extractContent({
        type: 'image',
        rawValue: 'screenshot.png',
        mimeType: 'image/png',
        storagePath: '2026-04/uuid-screenshot.png',
        mcpIntegrationId: null,
        mcpResourceType: null,
        mcpResourceId: null,
      });

      expect(result.extractedText).toBeNull();
      expect(result.extractedTitle).toBeNull();
    });
  });

  describe('file type', () => {
    it('returns error for files with no storage path', async () => {
      const result = await extractContent({
        type: 'file',
        rawValue: 'doc.txt',
        mimeType: 'text/plain',
        storagePath: null,
        mcpIntegrationId: null,
        mcpResourceType: null,
        mcpResourceId: null,
      });

      expect(result.error).toBe('No storage path');
    });
  });

  describe('mcp_reference type', () => {
    it('returns error when missing MCP data', async () => {
      const result = await extractContent({
        type: 'mcp_reference',
        rawValue: 'notion:page123',
        mimeType: null,
        storagePath: null,
        mcpIntegrationId: null,
        mcpResourceType: null,
        mcpResourceId: null,
      });

      expect(result.error).toBe('Missing MCP reference data');
    });
  });

  describe('unknown type', () => {
    it('returns error for unknown types', async () => {
      const result = await extractContent({
        type: 'unknown_type',
        rawValue: 'test',
        mimeType: null,
        storagePath: null,
        mcpIntegrationId: null,
        mcpResourceType: null,
        mcpResourceId: null,
      });

      expect(result.error).toContain('Unknown type');
    });
  });
});
