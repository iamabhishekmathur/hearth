import type { ToolDefinition } from '@hearth/shared';
import type { ToolResult } from '../../agent/types.js';
import type { ConnectorConfig, MCPConnector } from './base-connector.js';
import { logger } from '../../lib/logger.js';

const DRIVE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function validateDriveId(id: string, label: string): string | null {
  if (!DRIVE_ID_PATTERN.test(id)) {
    return `Invalid ${label}: must contain only alphanumeric characters, hyphens, and underscores`;
  }
  return null;
}

const GDRIVE_TOOLS: ToolDefinition[] = [
  {
    name: 'gdrive_search',
    description: 'Search Google Drive files by query',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        maxResults: { type: 'number', description: 'Max results to return', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'gdrive_read_file',
    description: 'Read the content of a Google Drive file',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: 'Google Drive file ID' },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'gdrive_list_files',
    description: 'List files in Google Drive',
    inputSchema: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'Folder ID (root if omitted)' },
        maxResults: { type: 'number', description: 'Max results to return', default: 20 },
      },
    },
  },
];

const GOOGLE_DOCS_MIME_TYPES: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

export class GDriveConnector implements MCPConnector {
  readonly provider = 'gdrive';
  private connected = false;
  private accessToken = '';

  async connect(config: ConnectorConfig): Promise<void> {
    if (!config.credentials['access_token']) {
      throw new Error('Google Drive connector requires access_token credential');
    }
    this.accessToken = config.credentials['access_token'];
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.accessToken = '';
  }

  listTools(): ToolDefinition[] {
    return GDRIVE_TOOLS;
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.connected || !this.accessToken) {
      return { output: { message: 'Google Drive not connected. Configure in Settings.' } };
    }

    const headers = { Authorization: `Bearer ${this.accessToken}` };

    switch (toolName) {
      case 'gdrive_search': {
        try {
          const query = input.query as string;
          const maxResults = (input.maxResults as number) ?? 10;
          const url = new URL('https://www.googleapis.com/drive/v3/files');
          // Escape backslashes and single quotes for Drive query DSL
          const escaped = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          url.searchParams.set('q', `fullText contains '${escaped}'`);
          url.searchParams.set('pageSize', String(maxResults));
          url.searchParams.set(
            'fields',
            'files(id,name,mimeType,modifiedTime,size,webViewLink)',
          );

          const res = await fetch(url.toString(), { headers });
          const data = (await res.json()) as Record<string, unknown>;
          if (!res.ok) {
            return { output: { message: `Drive API error: ${JSON.stringify(data)}` } };
          }
          return { output: { files: data.files } };
        } catch (err) {
          logger.error({ err }, 'Failed to search Drive');
          return { output: { message: 'Failed to search files' }, error: String(err) };
        }
      }

      case 'gdrive_read_file': {
        try {
          const fileId = input.fileId as string;
          const idErr = validateDriveId(fileId, 'fileId');
          if (idErr) return { output: { message: idErr } };

          // First get file metadata to check mime type
          const metaRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType,name`,
            { headers },
          );
          const meta = (await metaRes.json()) as Record<string, unknown>;
          if (!metaRes.ok) {
            return { output: { message: `Drive API error: ${JSON.stringify(meta)}` } };
          }

          const mimeType = meta.mimeType as string;
          const exportMime = GOOGLE_DOCS_MIME_TYPES[mimeType];

          let content: string;
          if (exportMime) {
            // Google Docs types need export
            const exportRes = await fetch(
              `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`,
              { headers },
            );
            content = await exportRes.text();
          } else {
            // Binary/regular files - download directly
            const dlRes = await fetch(
              `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
              { headers },
            );
            content = await dlRes.text();
          }

          return { output: { name: meta.name, mimeType, content } };
        } catch (err) {
          logger.error({ err }, 'Failed to read Drive file');
          return { output: { message: 'Failed to read file' }, error: String(err) };
        }
      }

      case 'gdrive_list_files': {
        try {
          const folderId = input.folderId as string | undefined;
          const maxResults = (input.maxResults as number) ?? 20;
          const url = new URL('https://www.googleapis.com/drive/v3/files');
          if (folderId) {
            const folderErr = validateDriveId(folderId, 'folderId');
            if (folderErr) return { output: { message: folderErr } };
            url.searchParams.set('q', `'${folderId}' in parents`);
          }
          url.searchParams.set('pageSize', String(maxResults));
          url.searchParams.set(
            'fields',
            'files(id,name,mimeType,modifiedTime,size,webViewLink)',
          );
          url.searchParams.set('orderBy', 'modifiedTime desc');

          const res = await fetch(url.toString(), { headers });
          const data = (await res.json()) as Record<string, unknown>;
          if (!res.ok) {
            return { output: { message: `Drive API error: ${JSON.stringify(data)}` } };
          }
          return { output: { files: data.files } };
        } catch (err) {
          logger.error({ err }, 'Failed to list Drive files');
          return { output: { message: 'Failed to list files' }, error: String(err) };
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
        'https://www.googleapis.com/drive/v3/about?fields=user',
        { headers: { Authorization: `Bearer ${this.accessToken}` } },
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
