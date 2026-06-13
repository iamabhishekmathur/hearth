/**
 * Mock MCP data source — a REAL JSON-RPC 2.0 over HTTP server that Hearth's
 * CustomMCPConnector connects to and pulls from through its normal MCP path.
 *
 * It implements exactly the two methods CustomMCPConnector calls:
 *   - tools/list  → advertises slack_search_messages, gmail_search,
 *                   granola_get_recent_transcripts
 *   - tools/call  → returns the fixtures in the shapes synthesis-service and the
 *                   work-intake backfill expect.
 *
 * Hearth does the pulling; this server only serves fixtures. That makes the
 * on-connect backfill genuinely turn this source into memory entries + tasks.
 *
 * A "broken" mode is supported so the sim can prove health goes to error: start
 * with MOCK_MCP_BROKEN=1 (or hit /__break) and tools/list starts failing, which
 * drives the custom connector's healthCheck() to false → status 'error'.
 *
 * Run standalone:
 *   MOCK_MCP_PORT=8777 ./apps/api/node_modules/.bin/tsx load/onboarding/mock-mcp/server.ts
 */
import http from 'node:http';
import { SLACK_MESSAGES, GMAIL_MESSAGES, GRANOLA_MEETINGS } from './fixtures.js';

interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: 'slack_search_messages',
    description: 'Search recent Slack messages',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'gmail_search',
    description: 'Search recent Gmail messages',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        maxResults: { type: 'number' },
      },
    },
  },
  {
    name: 'granola_get_recent_transcripts',
    description: 'Get recent Granola meeting transcripts',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
];

function callTool(name: string): Record<string, unknown> {
  switch (name) {
    case 'slack_search_messages':
      return { messages: SLACK_MESSAGES };
    case 'gmail_search':
      return { messages: GMAIL_MESSAGES };
    case 'granola_get_recent_transcripts':
      return { meetings: GRANOLA_MEETINGS };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export interface MockMcpServer {
  url: string;
  port: number;
  break(): void;
  fix(): void;
  close(): Promise<void>;
}

/**
 * Start the mock MCP server. Returns its URL + control handles.
 * `broken` makes tools/list (and thus the connector health probe) fail.
 */
export function startMockMcpServer(opts: { port?: number; broken?: boolean } = {}): Promise<MockMcpServer> {
  let broken = opts.broken ?? process.env.MOCK_MCP_BROKEN === '1';

  const server = http.createServer((req, res) => {
    // Control hooks for the sim to flip the source broken/healthy at runtime.
    if (req.url === '/__break') {
      broken = true;
      res.writeHead(200).end('broken');
      return;
    }
    if (req.url === '/__fix') {
      broken = false;
      res.writeHead(200).end('fixed');
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }

    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let rpc: JsonRpcRequest;
      try {
        rpc = JSON.parse(body) as JsonRpcRequest;
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        return;
      }

      // Broken mode: respond 500 so connector.healthCheck() (tools/list) fails.
      if (broken) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: 'data source unavailable (broken credential)' } }));
        return;
      }

      const reply = (result?: unknown, error?: { code: number; message: string }) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, ...(error ? { error } : { result }) }));
      };

      try {
        if (rpc.method === 'tools/list') {
          reply({ tools: TOOLS });
        } else if (rpc.method === 'tools/call') {
          const params = rpc.params ?? {};
          const name = params.name as string;
          reply(callTool(name));
        } else {
          reply(undefined, { code: -32601, message: `Method not found: ${rpc.method}` });
        }
      } catch (err) {
        reply(undefined, { code: -32000, message: err instanceof Error ? err.message : String(err) });
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0);
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        break: () => {
          broken = true;
        },
        fix: () => {
          broken = false;
        },
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

// Allow running standalone for manual poking.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.MOCK_MCP_PORT ?? 8777);
  startMockMcpServer({ port }).then((s) => {
    // eslint-disable-next-line no-console
    console.log(`[mock-mcp] listening on ${s.url} (broken=${process.env.MOCK_MCP_BROKEN === '1'})`);
  });
}
