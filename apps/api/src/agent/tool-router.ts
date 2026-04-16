import type { AgentTool, ToolResult } from './types.js';
import { sandboxManager } from '../sandbox/sandbox-manager.js';
import { mcpGateway } from '../mcp/gateway.js';
import { createMemory, searchMemory } from '../services/memory-service.js';
import { generateEmbedding } from '../services/embedding-service.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

interface ToolRouterContext {
  userId: string;
  orgId: string;
  teamId: string | null;
}

/**
 * Creates the tool router — a map of tool name to handler.
 * Includes built-in tools (memory, sandbox) and MCP tools from connected integrations.
 */
export async function createToolRouter(ctx: ToolRouterContext): Promise<Map<string, AgentTool>> {
  const tools = new Map<string, AgentTool>();

  // ── Sandbox: code execution ──
  tools.set('code_execution', {
    name: 'code_execution',
    description:
      'Execute Python or Node.js code in an isolated sandbox. Returns stdout, stderr, and exit code.',
    inputSchema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: ['python', 'node'],
          description: 'Programming language to use',
        },
        code: {
          type: 'string',
          description: 'The code to execute',
        },
      },
      required: ['language', 'code'],
    },
    handler: async (input) => {
      const language = input.language as 'python' | 'node';
      const code = input.code as string;

      if (!sandboxManager.isAvailable()) {
        return {
          output: {
            message: 'Code sandbox is unavailable — Docker is not running.',
          },
        };
      }

      const result = await sandboxManager.execute({ language, code });
      return {
        output: {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          durationMs: result.durationMs,
        },
      };
    },
  });

  // ── Memory: save ──
  tools.set('save_memory', {
    name: 'save_memory',
    description:
      'Save a piece of information to the user\'s persistent memory. Use this when the user explicitly asks you to remember something, or when you learn a preference, fact, or context that would be useful in future conversations.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The information to remember',
        },
        source: {
          type: 'string',
          description: 'Optional: where this came from (e.g. "user preference", "mentioned in chat")',
        },
      },
      required: ['content'],
    },
    handler: async (input) => {
      const user = await prisma.user.findUnique({
        where: { id: ctx.userId },
        select: { role: true },
      });
      const scope = {
        userId: ctx.userId,
        orgId: ctx.orgId,
        teamId: ctx.teamId,
        role: user?.role ?? 'member',
      };
      const entry = await createMemory(scope, {
        layer: 'user',
        content: input.content as string,
        source: (input.source as string | undefined) ?? 'assistant',
      });
      return { output: { id: entry.id, saved: true } };
    },
  });

  // ── Memory: recall ──
  tools.set('recall_memory', {
    name: 'recall_memory',
    description:
      'Search the user\'s memory for relevant information. Use this to retrieve context, preferences, or facts that may have been stored in previous conversations.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for in memory',
        },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const scope = {
        userId: ctx.userId,
        orgId: ctx.orgId,
        teamId: ctx.teamId,
        role: 'member',
      };
      const query = input.query as string;
      let embedding: number[] | undefined;
      try {
        const emb = await generateEmbedding(query);
        if (emb) embedding = emb;
      } catch {
        // Fall back to text search if embedding fails
      }
      const results = await searchMemory(scope, query, { embedding });
      return {
        output: {
          results: results
            .filter((r) => r != null)
            .map((r) => ({
              content: r!.content,
              layer: r!.layer,
              source: r!.source ?? null,
            })),
        },
      };
    },
  });

  // ── MCP integration tools ──
  const connectedIds = mcpGateway.getConnectedIntegrations();
  for (const integrationId of connectedIds) {
    try {
      const mcpTools = await mcpGateway.listTools(integrationId);
      for (const mcpTool of mcpTools) {
        tools.set(mcpTool.name, {
          name: mcpTool.name,
          description: mcpTool.description,
          inputSchema: mcpTool.inputSchema,
          handler: async (input) => {
            const result = await mcpGateway.executeTool(integrationId, mcpTool.name, input);
            return result;
          },
        });
      }
    } catch (err) {
      logger.warn({ integrationId, err }, 'Failed to load MCP tools');
    }
  }

  return tools;
}

/**
 * Executes a tool call by name using the provided tool map.
 * Returns a stub result if the tool is not found.
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  tools: Map<string, AgentTool>,
): Promise<ToolResult> {
  const tool = tools.get(toolName);

  if (!tool) {
    return {
      output: { message: `Tool "${toolName}" not yet implemented` },
      error: `Unknown tool: ${toolName}`,
    };
  }

  try {
    return await tool.handler(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Tool execution failed';
    logger.error({ toolName, input, err }, 'Tool execution error');
    return {
      output: {},
      error: message,
    };
  }
}
