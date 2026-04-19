import fs from 'node:fs/promises';
import path from 'node:path';
import { webFetch } from './web-service.js';
import { logger } from '../lib/logger.js';

interface ExtractionResult {
  extractedText: string | null;
  extractedTitle: string | null;
  error?: string;
}

/**
 * Extracts text content from a task context item based on its type.
 */
export async function extractContent(item: {
  type: string;
  rawValue: string;
  mimeType: string | null;
  storagePath: string | null;
  mcpIntegrationId: string | null;
  mcpResourceType: string | null;
  mcpResourceId: string | null;
}): Promise<ExtractionResult> {
  switch (item.type) {
    case 'note':
    case 'text_block':
      return { extractedText: item.rawValue, extractedTitle: null };

    case 'link':
      return extractLink(item.rawValue);

    case 'file':
      return extractFile(item.storagePath, item.mimeType);

    case 'image':
      // Images don't extract text by default; vision analysis is opt-in
      return { extractedText: null, extractedTitle: null };

    case 'mcp_reference':
      return extractMcpReference(item);

    default:
      return { extractedText: null, extractedTitle: null, error: `Unknown type: ${item.type}` };
  }
}

async function extractLink(url: string): Promise<ExtractionResult> {
  try {
    const result = await webFetch(url, { maxLength: 50_000 });
    return {
      extractedText: result.content,
      extractedTitle: result.title || null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Link fetch failed';
    logger.warn({ err, url }, 'Failed to fetch link for task context');
    return { extractedText: null, extractedTitle: null, error: message };
  }
}

async function extractFile(
  storagePath: string | null,
  mimeType: string | null,
): Promise<ExtractionResult> {
  if (!storagePath) {
    return { extractedText: null, extractedTitle: null, error: 'No storage path' };
  }

  const fullPath = path.resolve('uploads', storagePath);

  try {
    if (mimeType === 'application/pdf') {
      return extractPdf(fullPath);
    }

    // Text-based files
    if (
      mimeType?.startsWith('text/') ||
      mimeType === 'application/json'
    ) {
      const content = await fs.readFile(fullPath, 'utf-8');
      return {
        extractedText: content.slice(0, 100_000),
        extractedTitle: path.basename(storagePath),
      };
    }

    return {
      extractedText: null,
      extractedTitle: path.basename(storagePath),
      error: `Unsupported file type: ${mimeType}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'File read failed';
    logger.warn({ err, storagePath }, 'Failed to extract file content');
    return { extractedText: null, extractedTitle: null, error: message };
  }
}

async function extractPdf(fullPath: string): Promise<ExtractionResult> {
  try {
    const { PDFParse } = await import('pdf-parse');
    const buffer = await fs.readFile(fullPath);
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const textResult = await parser.getText();
    let title: string | null = null;
    try {
      const infoResult = await parser.getInfo();
      title = (infoResult?.info as Record<string, unknown>)?.Title as string ?? null;
    } catch {
      // info extraction is optional
    }
    await parser.destroy();
    return {
      extractedText: (textResult?.text ?? '').slice(0, 100_000) || null,
      extractedTitle: title ?? path.basename(fullPath),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'PDF parse failed';
    logger.warn({ err, fullPath }, 'Failed to extract PDF content');
    return { extractedText: null, extractedTitle: null, error: message };
  }
}

async function extractMcpReference(item: {
  mcpIntegrationId: string | null;
  mcpResourceType: string | null;
  mcpResourceId: string | null;
}): Promise<ExtractionResult> {
  if (!item.mcpIntegrationId || !item.mcpResourceId) {
    return { extractedText: null, extractedTitle: null, error: 'Missing MCP reference data' };
  }

  try {
    // Dynamic import to avoid circular dependency
    const { mcpGateway } = await import('../mcp/gateway.js');

    // Try to read the MCP resource content using available tools
    const toolName = getReadToolForResourceType(item.mcpResourceType);
    if (!toolName) {
      return {
        extractedText: null,
        extractedTitle: null,
        error: `No read tool for resource type: ${item.mcpResourceType}`,
      };
    }

    const result = await mcpGateway.executeTool(item.mcpIntegrationId, toolName, {
      resource_id: item.mcpResourceId,
    });

    const text =
      typeof result.output === 'string'
        ? result.output
        : JSON.stringify(result.output, null, 2);

    return {
      extractedText: text.slice(0, 100_000),
      extractedTitle: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'MCP fetch failed';
    logger.warn({ err, integrationId: item.mcpIntegrationId }, 'Failed to fetch MCP resource');
    return { extractedText: null, extractedTitle: null, error: message };
  }
}

function getReadToolForResourceType(resourceType: string | null): string | null {
  switch (resourceType) {
    case 'notion_page':
      return 'notion-fetch';
    case 'slack_thread':
      return 'slack_read_thread';
    default:
      return null;
  }
}
