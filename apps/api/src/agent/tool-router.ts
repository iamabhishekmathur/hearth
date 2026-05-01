import type { ArtifactType } from '@prisma/client';
import type { LLMMessage } from '@hearth/shared';
import type { AgentTool, ToolResult } from './types.js';
import { sandboxManager } from '../sandbox/sandbox-manager.js';
import { mcpGateway } from '../mcp/gateway.js';
import { createMemory, searchMemory } from '../services/memory-service.js';
import { generateEmbedding } from '../services/embedding-service.js';
import { webSearch, webFetch } from '../services/web-service.js';
import * as artifactService from '../services/artifact-service.js';
import { createProposedSkill } from '../services/experience-service.js';
import { getContextItem } from '../services/task-context-service.js';
import { emitToSessionEvent } from '../ws/socket-manager.js';
import { prisma } from '../lib/prisma.js';
import { checkToolRateLimit } from '../middleware/rate-limiter.js';
import { logger } from '../lib/logger.js';

interface ToolRouterContext {
  userId: string;
  orgId: string;
  teamId: string | null;
  sessionId: string;
  routineId?: string;
  visionEnabled?: boolean;
}

/**
 * Creates the tool router — a map of tool name to handler.
 * Includes built-in tools (memory, sandbox, web, productivity, artifacts)
 * and MCP tools from connected integrations.
 */
export async function createToolRouter(ctx: ToolRouterContext): Promise<Map<string, AgentTool>> {
  const tools = new Map<string, AgentTool>();

  // ── Sandbox: code execution ──
  tools.set('code_execution', {
    name: 'code_execution',
    description:
      'Execute Python or Node.js code in an isolated sandbox. Returns stdout, stderr, and exit code.',
    isAvailable: () => sandboxManager.isAvailable(),
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

  // ── Sandbox: read file ──
  tools.set('read_file', {
    name: 'read_file',
    description:
      'Read a file from the sandbox environment. Use when you need to inspect files created by code execution, or read uploaded files.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or relative file path inside the sandbox',
        },
      },
      required: ['path'],
    },
    handler: async (input) => {
      if (!sandboxManager.isAvailable()) {
        return {
          output: { error: 'Sandbox is unavailable — Docker is not running.' },
          error: 'Sandbox unavailable',
        };
      }

      const filePath = input.path as string;

      // Sanitize: reject path traversal
      if (filePath.includes('..')) {
        return {
          output: { error: 'Path traversal ("..") is not allowed.' },
          error: 'Invalid path',
        };
      }

      // Escape single quotes for safe interpolation into JS string
      const safePath = filePath.replace(/'/g, "\\'");

      const MAX_BYTES = 100 * 1024; // 100 KB
      const code = [
        `const fs = require('fs');`,
        `const path = '${safePath}';`,
        `const stat = fs.statSync(path);`,
        `if (stat.size > ${MAX_BYTES}) {`,
        `  console.log(JSON.stringify({ error: 'File too large', sizeBytes: stat.size, maxBytes: ${MAX_BYTES} }));`,
        `} else {`,
        `  const content = fs.readFileSync(path, 'utf-8');`,
        `  console.log(JSON.stringify({ content, sizeBytes: stat.size }));`,
        `}`,
      ].join('\n');

      const result = await sandboxManager.execute({ language: 'node', code });

      if (result.exitCode !== 0) {
        return {
          output: { error: result.stderr || 'Failed to read file', path: filePath },
          error: result.stderr || 'read_file failed',
        };
      }

      try {
        const parsed = JSON.parse(result.stdout.trim());
        if (parsed.error) {
          return { output: { error: parsed.error, ...parsed }, error: parsed.error };
        }
        return { output: { content: parsed.content, path: filePath, sizeBytes: parsed.sizeBytes } };
      } catch {
        // Stdout wasn't valid JSON — return raw
        return { output: { content: result.stdout, path: filePath } };
      }
    },
  });

  // ── Sandbox: write file ──
  tools.set('write_file', {
    name: 'write_file',
    description:
      'Write content to a file in the sandbox environment. Use when you need to create files for later use, save generated content, or prepare files for download.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path inside the sandbox to write to',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
    handler: async (input) => {
      if (!sandboxManager.isAvailable()) {
        return {
          output: { error: 'Sandbox is unavailable — Docker is not running.' },
          error: 'Sandbox unavailable',
        };
      }

      const filePath = input.path as string;
      const content = input.content as string;

      // Sanitize: reject path traversal
      if (filePath.includes('..')) {
        return {
          output: { error: 'Path traversal ("..") is not allowed.' },
          error: 'Invalid path',
        };
      }

      // Encode content as base64 to avoid any injection via string interpolation
      const contentBase64 = Buffer.from(content, 'utf-8').toString('base64');
      const safePath = filePath.replace(/'/g, "\\'");

      const code = [
        `const fs = require('fs');`,
        `const path = require('path');`,
        `const filePath = '${safePath}';`,
        `const dir = path.dirname(filePath);`,
        `if (dir && dir !== '.') { fs.mkdirSync(dir, { recursive: true }); }`,
        `const content = Buffer.from('${contentBase64}', 'base64').toString('utf-8');`,
        `fs.writeFileSync(filePath, content);`,
        `const stat = fs.statSync(filePath);`,
        `console.log(JSON.stringify({ bytesWritten: stat.size }));`,
      ].join('\n');

      const result = await sandboxManager.execute({ language: 'node', code });

      if (result.exitCode !== 0) {
        return {
          output: { error: result.stderr || 'Failed to write file', path: filePath },
          error: result.stderr || 'write_file failed',
        };
      }

      try {
        const parsed = JSON.parse(result.stdout.trim());
        return { output: { path: filePath, bytesWritten: parsed.bytesWritten, success: true } };
      } catch {
        return { output: { path: filePath, success: true } };
      }
    },
  });

  // ── Vision: analyze image ──
  tools.set('vision_analyze', {
    name: 'vision_analyze',
    description:
      'Analyze an image and describe its contents. Use when the user shares a screenshot, photo, diagram, or any image and wants you to understand or describe what it shows. Accepts image URLs or base64 data URIs.',
    isAvailable: () => ctx.visionEnabled !== false,
    inputSchema: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description: 'HTTP(S) URL to an image, or a base64 data URI (e.g. data:image/png;base64,...)',
        },
        question: {
          type: 'string',
          description: 'Optional question or focus area for the analysis',
        },
      },
      required: ['image_url'],
    },
    handler: async (input) => {
      const imageUrl = input.image_url as string;
      const question = (input.question as string) ?? 'Describe what you see in this image in detail.';

      let mimeType = 'image/png';
      let base64Data: string;

      try {
        if (imageUrl.startsWith('data:image/')) {
          // Parse data URI: data:image/png;base64,AAAA...
          const match = imageUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (!match) {
            return { output: { error: 'Invalid data URI format' }, error: 'Invalid data URI' };
          }
          mimeType = match[1];
          base64Data = match[2];
        } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
          const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
          if (!resp.ok) {
            return { output: { error: `Failed to fetch image: HTTP ${resp.status}` }, error: 'Image fetch failed' };
          }
          const contentType = resp.headers.get('content-type') ?? '';
          if (!contentType.startsWith('image/')) {
            return { output: { error: `URL does not point to an image (content-type: ${contentType})` }, error: 'Not an image' };
          }
          mimeType = contentType.split(';')[0].trim();
          const buffer = Buffer.from(await resp.arrayBuffer());
          base64Data = buffer.toString('base64');
        } else if (imageUrl.startsWith('/api/v1/uploads/')) {
          // Local upload — read from disk
          const fs = await import('node:fs/promises');
          const path = await import('node:path');
          const filePath = path.join(process.cwd(), imageUrl.replace('/api/v1/uploads/', 'uploads/'));
          const buffer = await fs.readFile(filePath);
          base64Data = buffer.toString('base64');
          // Guess mime type from extension
          const ext = path.extname(filePath).toLowerCase();
          const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
          mimeType = mimeMap[ext] ?? 'image/png';
        } else {
          return { output: { error: 'Invalid image URL. Provide an HTTP(S) URL or a base64 data URI.' }, error: 'Invalid image URL format' };
        }

        // Make a vision LLM call with the image
        const { providerRegistry } = await import('../llm/provider-registry.js');
        const visionMessages: import('@hearth/shared').LLMMessage[] = [
          {
            role: 'user',
            content: [
              { type: 'image', mimeType, data: base64Data },
              { type: 'text', text: question },
            ],
          },
        ];

        let analysis = '';
        const stream = providerRegistry.chatWithFallback({
          model: 'claude-sonnet-4-6',
          messages: visionMessages,
          maxTokens: 1024,
        });

        for await (const event of stream) {
          if (event.type === 'text_delta') {
            analysis += event.content;
          } else if (event.type === 'error') {
            return { output: { error: event.message }, error: event.message };
          }
        }

        return { output: { analysis, mimeType, question } };
      } catch (err) {
        return {
          output: { error: 'Vision analysis failed' },
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  // ── Memory: save (persistent, user-layer) ──
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

  // ── Memory: session note (ephemeral, auto-expires) ──
  tools.set('session_note', {
    name: 'session_note',
    description:
      'Save a short-term note for this conversation. Use when context is important for this session but not worth storing permanently — e.g., a file the user is working on, a constraint they mentioned, intermediate results. Session notes auto-expire after 24 hours.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The context to remember for this session',
        },
      },
      required: ['content'],
    },
    handler: async (input) => {
      const scope = {
        userId: ctx.userId,
        orgId: ctx.orgId,
        teamId: ctx.teamId,
        role: 'member',
      };
      const entry = await createMemory(scope, {
        layer: 'session',
        content: input.content as string,
        source: 'session',
        sourceRef: { sessionId: ctx.sessionId },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h TTL
      });
      return { output: { id: entry.id, saved: true, expiresIn: '24h' } };
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

  // ── Web: search ──
  tools.set('web_search', {
    name: 'web_search',
    description:
      'Search the web for current information. Use when you need to look up facts, documentation, recent events, or anything not in your training data.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (default 5)',
        },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const query = input.query as string;
      const maxResults = (input.max_results as number | undefined) ?? 5;
      const results = await webSearch(query, { maxResults });
      return {
        output: { results },
      };
    },
    isAvailable: () => true,
  });

  // ── Web: fetch ──
  tools.set('web_fetch', {
    name: 'web_fetch',
    description:
      'Fetch and extract readable content from a URL. Use when you need to read a webpage, documentation, article, or API response. Returns the text content, not raw HTML.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch',
        },
        max_length: {
          type: 'number',
          description: 'Maximum content length in characters (default 30000)',
        },
      },
      required: ['url'],
    },
    handler: async (input) => {
      const url = input.url as string;
      const maxLength = (input.max_length as number | undefined) ?? 30000;
      const result = await webFetch(url, { maxLength });
      return {
        output: result as unknown as Record<string, unknown>,
      };
    },
    isAvailable: () => true,
  });

  // ── Artifacts: create ──
  const VALID_ARTIFACT_TYPES: ArtifactType[] = ['code', 'document', 'diagram', 'table', 'html', 'image'];

  tools.set('create_artifact', {
    name: 'create_artifact',
    description:
      'Create a visual artifact (code file, document, diagram, table, or HTML preview) that appears in the artifact panel for the user. Use this when generating substantial content that benefits from a dedicated view — code files, formatted documents, data tables, diagrams, or interactive HTML. Small inline code snippets don\'t need artifacts.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: VALID_ARTIFACT_TYPES,
          description:
            'code: Source code with syntax highlighting. document: Markdown document. diagram: Mermaid diagram code. table: Markdown or HTML table. html: Interactive HTML/CSS/JS preview. image: Image artifact.',
        },
        title: {
          type: 'string',
          description: 'Descriptive name, e.g., "User Authentication Service" or "Database Schema Diagram"',
        },
        content: {
          type: 'string',
          description: 'The full artifact content',
        },
        language: {
          type: 'string',
          description: 'For code artifacts — e.g., "typescript", "python", "sql"',
        },
      },
      required: ['type', 'title', 'content'],
    },
    handler: async (input) => {
      const type = input.type as string;
      if (!VALID_ARTIFACT_TYPES.includes(type as ArtifactType)) {
        return {
          output: { message: `Invalid artifact type: ${type}` },
          error: `type must be one of: ${VALID_ARTIFACT_TYPES.join(', ')}`,
        };
      }

      const title = input.title as string;
      const content = input.content as string;
      const language = input.language as string | undefined;

      const artifact = await artifactService.createArtifact({
        sessionId: ctx.sessionId,
        type: type as ArtifactType,
        title,
        content,
        language,
        createdBy: ctx.userId,
      });

      emitToSessionEvent(
        ctx.sessionId,
        'artifact:created',
        artifact as unknown as Record<string, unknown>,
      );

      return {
        output: {
          success: true,
          artifactId: artifact.id,
          message: `Created artifact: ${title}`,
        },
      };
    },
  });

  // ── Artifacts: update ──
  tools.set('update_artifact', {
    name: 'update_artifact',
    description:
      'Update an existing artifact with new content. Use this when the user asks to modify, fix, or extend an artifact that was previously created. Always provide the complete updated content, not just a diff.',
    inputSchema: {
      type: 'object',
      properties: {
        artifact_id: {
          type: 'string',
          description: 'ID of the artifact to update',
        },
        title: {
          type: 'string',
          description: 'New title (optional)',
        },
        content: {
          type: 'string',
          description: 'The full updated content',
        },
        language: {
          type: 'string',
          description: 'Updated language (optional)',
        },
      },
      required: ['artifact_id', 'content'],
    },
    handler: async (input) => {
      const artifactId = input.artifact_id as string;
      const title = input.title as string | undefined;
      const content = input.content as string;
      const language = input.language as string | undefined;

      const artifact = await artifactService.updateArtifact({
        artifactId,
        title,
        content,
        language,
        editedBy: ctx.userId,
      });

      if (!artifact) {
        return {
          output: { message: `Artifact not found: ${artifactId}` },
          error: `Artifact not found: ${artifactId}`,
        };
      }

      emitToSessionEvent(
        ctx.sessionId,
        'artifact:updated',
        artifact as unknown as Record<string, unknown>,
      );

      return {
        output: {
          success: true,
          artifactId,
          version: artifact.version,
          message: `Updated artifact: ${artifact.title} (v${artifact.version})`,
        },
      };
    },
  });

  // ── Tasks: create ──
  // Use this when the user has clearly asked you to create a task.
  // For uncertain or speculative cases, use `propose_task` instead.
  tools.set('create_task', {
    name: 'create_task',
    description:
      "Create a task in the user's Kanban board immediately. Use when the user clearly asks to track work (e.g. 'add a task', 'remind me to', 'put this in my backlog'). The current chat session is auto-linked. For ambiguous cases where you're inferring intent, use `propose_task` instead so the user can confirm.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the task' },
        description: { type: 'string', description: 'Optional longer description' },
        target_status: {
          type: 'string',
          enum: ['backlog', 'planning'],
          description: '`backlog` (default) just stashes the task. `planning` kicks off the planning agent which auto-progresses to executing. Never set this without explicit user direction (e.g. "run it now").',
        },
        attach_recent_n: {
          type: 'number',
          description: 'How many recent chat messages to attach as context. Default 4. Set 1 for "just this exchange," set 0 to attach nothing.',
        },
        priority: {
          type: 'number',
          description: 'Priority level 0-3, where 3 is highest (default: 0)',
        },
      },
      required: ['title'],
    },
    handler: async (input) => {
      const title = input.title as string;
      const description = input.description as string | undefined;
      const targetStatus = ((input.target_status as string | undefined) ?? 'backlog') as 'backlog' | 'planning';
      const attachRecentN = (input.attach_recent_n as number | undefined) ?? 4;
      const priority = (input.priority as number | undefined) ?? 0;

      // Anchor on the latest user message in the session — that's the
      // request the agent is acting on. Falls back to the latest message
      // of any role.
      const anchor = await prisma.chatMessage.findFirst({
        where: { sessionId: ctx.sessionId, role: 'user' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }) ?? await prisma.chatMessage.findFirst({
        where: { sessionId: ctx.sessionId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      const chatService = await import('../services/chat-service.js');
      const result = await chatService.promoteMessageToTask({
        sessionId: ctx.sessionId,
        messageId: anchor?.id ?? '',
        userId: ctx.userId,
        title,
        description,
        attachRecentN,
        targetStatus,
        priority: Math.min(3, Math.max(0, priority)),
        provenance: 'agent_create',
      });

      // If planning was requested, kick off the planner.
      if (!result.existing && targetStatus === 'planning') {
        const { enqueuePlanning } = await import('../services/task-planner.js');
        enqueuePlanning(result.task.id, ctx.userId).catch(() => { /* best-effort */ });
      }

      const { emitToUser } = await import('../ws/socket-manager.js');
      emitToUser(ctx.userId, 'task:created_from_chat', {
        taskId: result.task.id,
        title: result.task.title,
        status: result.task.status,
        sessionId: ctx.sessionId,
        originatingMessageId: anchor?.id ?? null,
        messageCount: result.messageCount,
        existing: result.existing,
      });

      return {
        output: {
          taskId: result.task.id,
          title: result.task.title,
          status: result.task.status,
          contextItemCount: result.messageCount > 0 ? 1 : 0,
          deepLink: `/tasks?taskId=${result.task.id}`,
        },
      };
    },
  });

  // ── Tasks: propose ──
  // Use when the user hasn't explicitly asked for a task but you think
  // one would be useful. Creates a TaskSuggestion the user can accept.
  tools.set('propose_task', {
    name: 'propose_task',
    description:
      "Propose a task for the user to accept or dismiss, instead of creating it directly. Use when you've inferred a task-shaped intent from the conversation but the user hasn't given an explicit instruction — especially when YOUR OWN reply describes multi-step delegated work (e.g., 'I'll need to pull X, then synthesize Y, then publish Z'). If your response shape is itself a plan with three or more steps, you should usually call this. The user sees an inline card under your message and can accept/edit/dismiss. Prefer this over `create_task` for any speculative or AI-initiated suggestion.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Proposed task title' },
        description: { type: 'string', description: 'Optional longer description' },
        confidence: {
          type: 'number',
          description: 'Your confidence the user actually wants this task, 0.0–1.0. Below 0.5, consider not proposing at all.',
        },
        attach_recent_n: {
          type: 'number',
          description: 'How many recent messages to suggest attaching. Default 4.',
        },
      },
      required: ['title'],
    },
    handler: async (input) => {
      const title = input.title as string;
      const description = input.description as string | undefined;
      const confidence = Math.min(1, Math.max(0, (input.confidence as number | undefined) ?? 0.6));
      const attachRecentN = (input.attach_recent_n as number | undefined) ?? 4;

      const anchor = await prisma.chatMessage.findFirst({
        where: { sessionId: ctx.sessionId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true },
      });
      if (!anchor) {
        return { output: { error: 'No messages in session to anchor suggestion to' } };
      }

      // Pre-compute the suggested message slice so the UI can preview it.
      const slice = await prisma.chatMessage.findMany({
        where: {
          sessionId: ctx.sessionId,
          createdAt: { lte: anchor.createdAt },
          role: { in: ['user', 'assistant'] },
        },
        orderBy: { createdAt: 'desc' },
        take: attachRecentN,
        select: { id: true },
      });
      const suggestedIds = slice.map((m) => m.id).reverse();

      const suggestion = await prisma.taskSuggestion.create({
        data: {
          sessionId: ctx.sessionId,
          messageId: anchor.id,
          userId: ctx.userId,
          proposedTitle: title,
          proposedDescription: description ?? null,
          suggestedContextMessageIds: suggestedIds,
          confidence,
          status: 'pending',
        },
      });

      const { emitToUser } = await import('../ws/socket-manager.js');
      emitToUser(ctx.userId, 'task:suggested', {
        id: suggestion.id,
        sessionId: ctx.sessionId,
        messageId: anchor.id,
        proposedTitle: title,
        proposedDescription: description ?? null,
        suggestedContextMessageIds: suggestedIds,
        confidence,
        createdAt: suggestion.createdAt.toISOString(),
      });

      return {
        output: {
          suggestionId: suggestion.id,
          proposedTitle: title,
          messageCount: suggestedIds.length,
        },
      };
    },
  });

  // ── Tasks: update ──
  tools.set('update_task', {
    name: 'update_task',
    description:
      'Update an existing task — change its status, title, description, or priority. Use when the user asks to move a task, mark it done, update its details, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The ID of the task to update',
        },
        title: {
          type: 'string',
          description: 'New title for the task',
        },
        description: {
          type: 'string',
          description: 'New description for the task',
        },
        status: {
          type: 'string',
          enum: ['auto_detected', 'backlog', 'planning', 'executing', 'review', 'done', 'failed', 'archived'],
          description: 'New status for the task',
        },
        priority: {
          type: 'number',
          description: 'New priority level 0-3',
        },
      },
      required: ['task_id'],
    },
    handler: async (input) => {
      const taskId = input.task_id as string;

      // Verify the task belongs to the user
      const existing = await prisma.task.findFirst({
        where: { id: taskId, userId: ctx.userId },
      });
      if (!existing) {
        return { output: {}, error: 'Task not found or does not belong to you' };
      }

      const data: Record<string, unknown> = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.description !== undefined) data.description = input.description;
      if (input.status !== undefined) data.status = input.status;
      if (input.priority !== undefined) data.priority = Math.min(3, Math.max(0, input.priority as number));

      const task = await prisma.task.update({
        where: { id: taskId },
        data: data as never,
      });

      return {
        output: { taskId: task.id, title: task.title, status: task.status, updated: true },
      };
    },
  });

  // ── Tasks: list ──
  tools.set('list_tasks', {
    name: 'list_tasks',
    description:
      "List the user's tasks, optionally filtered by status. Use when the user asks about their to-dos, backlog, or task board.",
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['auto_detected', 'backlog', 'planning', 'executing', 'review', 'done', 'failed', 'archived'],
          description: 'Filter tasks by status',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of tasks to return (default: 20)',
        },
      },
    },
    handler: async (input) => {
      const status = input.status as string | undefined;
      const limit = Math.min((input.limit as number | undefined) ?? 20, 100);

      const where: Record<string, unknown> = { userId: ctx.userId };
      if (status) where.status = status;

      const [tasks, total] = await Promise.all([
        prisma.task.findMany({
          where: where as never,
          orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
          take: limit,
          select: { id: true, title: true, status: true, priority: true, createdAt: true },
        }),
        prisma.task.count({ where: where as never }),
      ]);

      return {
        output: {
          tasks: tasks.map((t: { id: string; title: string; status: string; priority: number; createdAt: Date }) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            createdAt: t.createdAt.toISOString(),
          })),
          total,
        },
      };
    },
  });

  // ── Task Context: drill-down into truncated context items ──
  tools.set('get_task_context', {
    name: 'get_task_context',
    description:
      'Retrieve the full extracted content of a task context item when the summary was truncated. Use when the planning or execution prompt indicates context items are available but were cut short.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: {
          type: 'string',
          description: 'Context item ID from the prompt summary',
        },
        max_length: {
          type: 'number',
          description: 'Max characters to return (default: 50000)',
        },
      },
      required: ['item_id'],
    },
    handler: async (input) => {
      const itemId = input.item_id as string;
      const maxLength = Math.min((input.max_length as number | undefined) ?? 50_000, 100_000);

      const item = await getContextItem(itemId);
      if (!item) {
        return { output: {}, error: 'Context item not found' };
      }

      return {
        output: {
          id: item.id,
          type: item.type,
          label: item.label,
          rawValue: item.rawValue,
          extractedTitle: item.extractedTitle,
          extractedText: item.extractedText?.slice(0, maxLength) ?? null,
          visionAnalysis: item.visionAnalysis,
          extractionStatus: item.extractionStatus,
        },
      };
    },
  });

  // ── Routines: create ──
  tools.set('create_routine', {
    name: 'create_routine',
    description:
      'Create a scheduled routine that runs automatically. Routines are prompts executed on a cron schedule. Use when the user wants recurring automated tasks like "summarize my emails every morning" or "check deploy status every hour".',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the routine',
        },
        prompt: {
          type: 'string',
          description: 'The instruction to execute on each run',
        },
        schedule: {
          type: 'string',
          description: 'Cron expression (e.g. "0 9 * * 1-5" for weekdays at 9am)',
        },
        description: {
          type: 'string',
          description: 'Optional description of what the routine does',
        },
        delivery: {
          type: 'object',
          description: 'Delivery configuration (default: {type:"in_app"})',
        },
      },
      required: ['name', 'prompt', 'schedule'],
    },
    handler: async (input) => {
      const name = input.name as string;
      const prompt = input.prompt as string;
      const schedule = input.schedule as string;
      const description = input.description as string | undefined;
      const delivery = (input.delivery as Record<string, unknown> | undefined) ?? { type: 'in_app' };

      const routine = await prisma.routine.create({
        data: {
          userId: ctx.userId,
          name,
          prompt,
          schedule,
          description,
          delivery: delivery as never,
          context: {},
          createdVia: 'agent',
          enabled: true,
        },
      });

      return {
        output: { routineId: routine.id, name: routine.name, schedule: routine.schedule, enabled: routine.enabled },
      };
    },
  });

  // ── Routines: update ──
  tools.set('update_routine', {
    name: 'update_routine',
    description:
      'Update an existing routine — change its schedule, prompt, name, or enable/disable it.',
    inputSchema: {
      type: 'object',
      properties: {
        routine_id: {
          type: 'string',
          description: 'The ID of the routine to update',
        },
        name: {
          type: 'string',
          description: 'New name for the routine',
        },
        prompt: {
          type: 'string',
          description: 'New prompt for the routine',
        },
        schedule: {
          type: 'string',
          description: 'New cron schedule',
        },
        description: {
          type: 'string',
          description: 'New description',
        },
        enabled: {
          type: 'boolean',
          description: 'Enable or disable the routine',
        },
      },
      required: ['routine_id'],
    },
    handler: async (input) => {
      const routineId = input.routine_id as string;

      // Verify the routine belongs to the user
      const existing = await prisma.routine.findFirst({
        where: { id: routineId, userId: ctx.userId },
      });
      if (!existing) {
        return { output: {}, error: 'Routine not found or does not belong to you' };
      }

      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.prompt !== undefined) data.prompt = input.prompt;
      if (input.schedule !== undefined) data.schedule = input.schedule;
      if (input.description !== undefined) data.description = input.description;
      if (input.enabled !== undefined) data.enabled = input.enabled;

      const routine = await prisma.routine.update({
        where: { id: routineId },
        data: data as never,
      });

      return {
        output: {
          routineId: routine.id,
          name: routine.name,
          schedule: routine.schedule,
          enabled: routine.enabled,
          updated: true,
        },
      };
    },
  });

  // ── Routines: list ──
  tools.set('list_routines', {
    name: 'list_routines',
    description:
      "List the user's routines. Use when the user asks about their automations, scheduled tasks, or recurring jobs.",
    inputSchema: {
      type: 'object',
      properties: {
        enabled_only: {
          type: 'boolean',
          description: 'If true, only return enabled routines (default: false)',
        },
      },
    },
    handler: async (input) => {
      const enabledOnly = (input.enabled_only as boolean | undefined) ?? false;

      const where: Record<string, unknown> = { userId: ctx.userId };
      if (enabledOnly) where.enabled = true;

      const routines = await prisma.routine.findMany({
        where: where as never,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          schedule: true,
          enabled: true,
          lastRunAt: true,
          lastRunStatus: true,
        },
      });

      return {
        output: {
          routines: routines.map((r: { id: string; name: string; schedule: string | null; enabled: boolean; lastRunAt: Date | null; lastRunStatus: string | null }) => ({
            id: r.id,
            name: r.name,
            schedule: r.schedule,
            enabled: r.enabled,
            lastRunAt: r.lastRunAt?.toISOString() ?? null,
            lastRunStatus: r.lastRunStatus,
          })),
          total: routines.length,
        },
      };
    },
  });

  // ── Clarify: ask user a structured question ──
  tools.set('clarify', {
    name: 'clarify',
    description:
      'Ask the user a structured question when you need clarification before proceeding. Use this instead of guessing when the request is ambiguous. Supports multiple-choice or open-ended questions.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the user',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of choices for multiple-choice questions',
        },
        allow_freeform: {
          type: 'boolean',
          description: 'Whether the user can also type a free-form answer (default: true)',
        },
      },
      required: ['question'],
    },
    handler: async (input) => {
      const question = input.question as string;
      const options = input.options as string[] | undefined;
      const allowFreeform = (input.allow_freeform as boolean | undefined) ?? true;

      return {
        output: {
          question,
          options: options ?? null,
          allow_freeform: allowFreeform,
          awaiting_response: true,
        },
      };
    },
  });

  // ── Session search: search chat history ──
  tools.set('session_search', {
    name: 'session_search',
    description:
      'Search across chat conversation history for past discussions, decisions, or context. Use when the user asks "what did we discuss about X" or needs to recall something from a previous conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The text to search for in conversation history',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10)',
        },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const query = input.query as string;
      const limit = Math.min((input.limit as number | undefined) ?? 10, 50);

      const results = await prisma.chatMessage.findMany({
        where: {
          session: { userId: ctx.userId },
          content: { contains: query, mode: 'insensitive' },
        },
        include: { session: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return {
        output: {
          results: results.map((r: { sessionId: string; session: { title: string | null }; content: string; role: string; createdAt: Date }) => ({
            sessionId: r.sessionId,
            sessionTitle: r.session.title,
            content: r.content.length > 200 ? r.content.slice(0, 200) + '...' : r.content,
            role: r.role,
            createdAt: r.createdAt.toISOString(),
          })),
          total: results.length,
        },
      };
    },
  });

  // ── Artifacts: list artifacts in current session ──
  tools.set('list_artifacts', {
    name: 'list_artifacts',
    description:
      'List all artifacts in the current chat session. Use to check what artifacts already exist before creating new ones, or when the user asks about existing artifacts.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      try {
        // The artifact model may not exist yet if migrations haven't run
        const artifacts = await (prisma as never as Record<string, { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> }>)
          .artifact.findMany({
            where: { sessionId: ctx.sessionId },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              type: true,
              title: true,
              language: true,
              version: true,
              createdAt: true,
            },
          });

        return {
          output: {
            artifacts: artifacts.map((a: Record<string, unknown>) => ({
              id: a.id,
              type: a.type,
              title: a.title,
              language: a.language ?? null,
              version: a.version,
              createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
            })),
          },
        };
      } catch {
        return {
          output: { artifacts: [], message: 'Artifact storage is not yet available' },
        };
      }
    },
  });

  // ── Schedule action: one-time or recurring scheduled action ──
  tools.set('schedule_action', {
    name: 'schedule_action',
    description:
      'Schedule a one-time or recurring action. Creates a routine that will execute the given prompt at the specified time. Use for reminders, scheduled checks, or deferred tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'What to do when the schedule fires',
        },
        schedule: {
          type: 'string',
          description: 'Cron expression for when to run (e.g. "0 9 * * 1-5")',
        },
        name: {
          type: 'string',
          description: 'Optional name for the scheduled action (auto-generated if not provided)',
        },
      },
      required: ['action', 'schedule'],
    },
    handler: async (input) => {
      const action = input.action as string;
      const schedule = input.schedule as string;
      const name = (input.name as string | undefined) ?? `Scheduled: ${action.slice(0, 50)}`;

      const routine = await prisma.routine.create({
        data: {
          userId: ctx.userId,
          name,
          prompt: action,
          schedule,
          delivery: { type: 'in_app' },
          context: {},
          createdVia: 'agent',
          enabled: true,
        },
      });

      return {
        output: {
          routineId: routine.id,
          name: routine.name,
          schedule: routine.schedule,
          message: 'Scheduled action created',
        },
      };
    },
  });

  // ── Delegate task: run a sub-agent for focused work ──
  tools.set('delegate_task', {
    name: 'delegate_task',
    description:
      'Delegate a subtask to a focused sub-agent. The sub-agent will work on the task independently and return a result. Use for complex multi-step work that benefits from focused attention, or when you want to work on multiple things in parallel.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Description of what the sub-agent should do',
        },
        context: {
          type: 'string',
          description: 'Additional context for the sub-agent',
        },
      },
      required: ['task'],
    },
    handler: async (input) => {
      const { buildAgentContext } = await import('./context-builder.js');
      const { agentLoop } = await import('./agent-runtime.js');

      const task = input.task as string;
      const extraContext = input.context as string | undefined;
      const subContext = await buildAgentContext(ctx.userId, ctx.sessionId, task);

      // Run sub-agent with focused prompt
      const messages: LLMMessage[] = [
        { role: 'user', content: extraContext ? `${task}\n\nAdditional context: ${extraContext}` : task },
      ];

      let result = '';
      for await (const event of agentLoop(subContext, messages)) {
        if (event.type === 'text_delta') {
          result += event.content;
        }
      }

      return { output: { result, completed: true } };
    },
  });

  // ── Propose skill: save a reusable approach as a draft skill ──
  tools.set('propose_skill', {
    name: 'propose_skill',
    description:
      'Propose a reusable skill based on a successful approach you used in this session. The skill is saved as a draft for the user to review and install. Use when you solved a multi-step problem that would be useful again.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Short name for the skill (e.g., "Jira Sprint Summary")',
        },
        description: {
          type: 'string',
          description: 'One-line description of what the skill does',
        },
        content: {
          type: 'string',
          description: 'Markdown skill content with instructions, approach, and optionally executable code',
        },
      },
      required: ['name', 'description', 'content'],
    },
    handler: async (input) => {
      const name = input.name as string;
      const description = input.description as string;
      const content = input.content as string;

      try {
        const skill = await createProposedSkill(ctx.userId, ctx.orgId, name, description, content);
        return {
          output: {
            skillId: skill.id,
            name: skill.name,
            status: 'draft',
            message: 'Skill proposed! The user can review and install it from the Skills page.',
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to propose skill';
        return { output: { error: message }, error: message };
      }
    },
  });

  // ── Decision Graph: capture decision ──
  tools.set('capture_decision', {
    name: 'capture_decision',
    description:
      'Capture a decision made during this conversation. Use when you detect that the user has made or is communicating a decision — e.g., choosing a technology, prioritizing work, setting a policy. Records the decision in the organizational decision graph for future reference.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Clear, concise title of the decision (e.g., "Adopted TypeScript for backend")',
        },
        reasoning: {
          type: 'string',
          description: 'Why this decision was made — the rationale and key factors',
        },
        alternatives: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              pros: { type: 'string' },
              cons: { type: 'string' },
            },
            required: ['label'],
          },
          description: 'Alternatives that were considered',
        },
        stakeholders: {
          type: 'array',
          items: { type: 'string' },
          description: 'People involved in or affected by this decision',
        },
        domain: {
          type: 'string',
          description: 'Domain: engineering, product, hiring, design, operations, marketing, finance, legal, strategy, other',
        },
        scope: {
          type: 'string',
          enum: ['org', 'team', 'personal'],
          description: 'Scope of the decision (default: org)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
      },
      required: ['title', 'reasoning'],
    },
    handler: async (input) => {
      const { createDecision } = await import('../services/decision-service.js');
      const user = await prisma.user.findUnique({
        where: { id: ctx.userId },
        select: { role: true },
      });
      const decision = await createDecision(
        { orgId: ctx.orgId, userId: ctx.userId, teamId: ctx.teamId, role: user?.role ?? 'member' },
        {
          title: input.title as string,
          reasoning: input.reasoning as string,
          alternatives: (input.alternatives as Array<{ label: string; pros?: string; cons?: string }>) ?? [],
          participants: (input.stakeholders as string[]) ?? [],
          domain: input.domain as string | undefined,
          scope: (input.scope as 'org' | 'team' | 'personal') ?? 'org',
          tags: (input.tags as string[]) ?? [],
          source: 'chat',
          sourceRef: { sessionId: ctx.sessionId },
          sessionId: ctx.sessionId,
        },
      );
      return {
        output: {
          decisionId: decision.id,
          title: decision.title,
          message: `Decision captured: "${decision.title}"`,
        },
      };
    },
  });

  // ── Decision Graph: recall decisions ──
  tools.set('recall_decisions', {
    name: 'recall_decisions',
    description:
      'Search organizational decision history. Use when the user asks "what did we decide about X?" or when you need to find relevant past decisions for context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for in decision history',
        },
        domain: {
          type: 'string',
          description: 'Optional domain filter',
        },
        limit: {
          type: 'number',
          description: 'Max results (default 5)',
        },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const { searchDecisions } = await import('../services/decision-service.js');
      const user = await prisma.user.findUnique({
        where: { id: ctx.userId },
        select: { role: true },
      });
      const scope = { orgId: ctx.orgId, userId: ctx.userId, teamId: ctx.teamId, role: user?.role ?? 'member' };
      const result = await searchDecisions(scope, {
        query: input.query as string,
        domain: input.domain as string | undefined,
        limit: (input.limit as number) ?? 5,
      });
      return {
        output: {
          decisions: result.decisions.map(d => ({
            id: d.id,
            title: d.title,
            reasoning: d.reasoning.slice(0, 200),
            domain: d.domain,
            status: d.status,
            confidence: d.confidence,
            createdAt: d.createdAt,
          })),
          total: result.total,
        },
      };
    },
  });

  // ── Decision Graph: get decision context ──
  tools.set('get_decision_context', {
    name: 'get_decision_context',
    description:
      'Get the full context around a specific decision — including its rationale, alternatives, outcomes, and related decisions. Use when the user wants details about a past decision.',
    inputSchema: {
      type: 'object',
      properties: {
        decision_id: {
          type: 'string',
          description: 'ID of the decision to get context for',
        },
      },
      required: ['decision_id'],
    },
    handler: async (input) => {
      const { getDecision, getDecisionGraph } = await import('../services/decision-service.js');
      const decisionId = input.decision_id as string;
      const decision = await getDecision(decisionId, ctx.orgId);
      if (!decision) {
        return { output: {}, error: 'Decision not found' };
      }
      const graph = await getDecisionGraph(decisionId, ctx.orgId, 1);
      return {
        output: {
          decision,
          relatedDecisions: graph.nodes.filter(n => n.id !== decisionId).slice(0, 5),
          edges: graph.edges,
        },
      };
    },
  });

  // ── Decision Graph: suggest precedent ──
  tools.set('suggest_precedent', {
    name: 'suggest_precedent',
    description:
      'Find similar past decisions that could serve as precedent for a current decision being discussed. Use proactively when the user is in the process of making a decision.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Description of the current decision context',
        },
        domain: {
          type: 'string',
          description: 'Optional domain filter',
        },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const { findPrecedents } = await import('../services/decision-service.js');
      const user = await prisma.user.findUnique({
        where: { id: ctx.userId },
        select: { role: true },
      });
      const scope = { orgId: ctx.orgId, userId: ctx.userId, teamId: ctx.teamId, role: user?.role ?? 'member' };
      const precedents = await findPrecedents(scope, input.query as string, {
        domain: input.domain as string | undefined,
        limit: 3,
      });
      return {
        output: {
          precedents: precedents.map(d => ({
            id: d.id,
            title: d.title,
            reasoning: d.reasoning.slice(0, 300),
            domain: d.domain,
            status: d.status,
            confidence: d.confidence,
            quality: d.quality,
          })),
          found: precedents.length,
        },
      };
    },
  });

  // ── Decision Graph: update outcome ──
  tools.set('update_decision_outcome', {
    name: 'update_decision_outcome',
    description:
      'Record the outcome of a past decision — whether it worked out well or not. Use when the user reports on how a past decision turned out.',
    inputSchema: {
      type: 'object',
      properties: {
        decision_id: {
          type: 'string',
          description: 'ID of the decision to update',
        },
        verdict: {
          type: 'string',
          enum: ['positive', 'negative', 'mixed', 'neutral', 'too_early'],
          description: 'How the decision worked out',
        },
        description: {
          type: 'string',
          description: 'Description of the outcome',
        },
      },
      required: ['decision_id', 'verdict', 'description'],
    },
    handler: async (input) => {
      const { recordOutcome } = await import('../services/decision-service.js');
      const outcome = await recordOutcome(
        input.decision_id as string,
        ctx.userId,
        ctx.orgId,
        {
          verdict: input.verdict as any,
          description: input.description as string,
        },
      );
      if (!outcome) {
        return { output: {}, error: 'Decision not found' };
      }
      return {
        output: {
          outcomeId: outcome.id,
          verdict: outcome.verdict,
          message: 'Outcome recorded',
        },
      };
    },
  });

  // ── Feature 1: Routine State tool — only available during routine runs ──
  if (ctx.routineId) {
    tools.set('routine_state', {
      name: 'routine_state',
      description:
        'Get, set, or delete key-value pairs in the routine\'s persistent state. State persists across runs, enabling delta tracking and deduplication. Use "get" to read a key, "set" to write, "delete" to remove, "list" to see all keys.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['get', 'set', 'delete', 'list'],
            description: 'The action to perform',
          },
          key: {
            type: 'string',
            description: 'The state key (not required for "list")',
          },
          value: {
            description: 'The value to set (only for "set" action)',
          },
        },
        required: ['action'],
      },
      handler: async (input) => {
        const action = input.action as string;
        const key = input.key as string | undefined;

        const routine = await prisma.routine.findUnique({
          where: { id: ctx.routineId },
          select: { state: true },
        });
        const state = (routine?.state as Record<string, unknown>) ?? {};

        switch (action) {
          case 'get':
            if (!key) return { output: { error: 'key is required for get' } };
            return { output: { key, value: state[key] ?? null, exists: key in state } };

          case 'set': {
            if (!key) return { output: { error: 'key is required for set' } };
            const newState = { ...state, [key]: input.value };
            await prisma.routine.update({
              where: { id: ctx.routineId },
              data: { state: newState as never },
            });
            return { output: { key, value: input.value, saved: true } };
          }

          case 'delete': {
            if (!key) return { output: { error: 'key is required for delete' } };
            const { [key]: _, ...rest } = state;
            await prisma.routine.update({
              where: { id: ctx.routineId },
              data: { state: rest as never },
            });
            return { output: { key, deleted: true } };
          }

          case 'list':
            return { output: { keys: Object.keys(state), count: Object.keys(state).length } };

          default:
            return { output: { error: `Unknown action: ${action}` } };
        }
      },
    });

    // ── Feature 6: set_delivery_tag — lets agent tag output for conditional routing ──
    tools.set('set_delivery_tag', {
      name: 'set_delivery_tag',
      description:
        'Tag the current run output for conditional delivery routing. For example, tag as "critical" so delivery rules can route critical output to Slack while normal output stays in-app.',
      inputSchema: {
        type: 'object',
        properties: {
          tag: {
            type: 'string',
            description: 'The tag to apply (e.g., "critical", "summary", "error")',
          },
        },
        required: ['tag'],
      },
      handler: async (input) => {
        const tag = input.tag as string;
        // Store tags in routine state under a special key
        const routine = await prisma.routine.findUnique({
          where: { id: ctx.routineId },
          select: { state: true },
        });
        const state = (routine?.state as Record<string, unknown>) ?? {};
        const existingTags = (state._delivery_tags as string[]) ?? [];
        if (!existingTags.includes(tag)) {
          existingTags.push(tag);
        }
        await prisma.routine.update({
          where: { id: ctx.routineId },
          data: { state: { ...state, _delivery_tags: existingTags } as never },
        });
        return { output: { tag, applied: true, allTags: existingTags } };
      },
    });
  }

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

const MAX_RESULT_SIZE = 50_000; // 50KB

/**
 * Executes a tool call by name using the provided tool map.
 * Returns a stub result if the tool is not found.
 * Truncates results exceeding MAX_RESULT_SIZE to prevent context window bloat.
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  tools: Map<string, AgentTool>,
  userId?: string,
): Promise<ToolResult> {
  const tool = tools.get(toolName);

  if (!tool) {
    return {
      output: { message: `Tool "${toolName}" not yet implemented` },
      error: `Unknown tool: ${toolName}`,
    };
  }

  // Per-tool rate limit check
  if (userId) {
    const rateLimitError = checkToolRateLimit(userId, toolName);
    if (rateLimitError) {
      return {
        output: { error: rateLimitError },
        error: rateLimitError,
      };
    }
  }

  try {
    let result = await tool.handler(input);

    // Truncate oversized results to prevent context window bloat
    const serialized = JSON.stringify(result.output);
    if (serialized.length > MAX_RESULT_SIZE) {
      result = {
        output: {
          truncatedResult: serialized.slice(0, MAX_RESULT_SIZE),
          _truncated: true,
          _originalSize: serialized.length,
        },
        error: result.error,
      };
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Tool execution failed';
    logger.error({ toolName, input, err }, 'Tool execution error');
    return {
      output: {},
      error: message,
    };
  }
}
