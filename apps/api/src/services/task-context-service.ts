import type {
  TaskContextItemType,
  ExtractionStatus,
} from '@hearth/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { generateEmbedding } from './embedding-service.js';
import { logger } from '../lib/logger.js';

// ── CRUD ──

export async function createContextItem(
  taskId: string,
  createdBy: string,
  data: {
    type: TaskContextItemType;
    rawValue: string;
    label?: string;
    mimeType?: string;
    sizeBytes?: number;
    storagePath?: string;
    mcpIntegrationId?: string;
    mcpResourceType?: string;
    mcpResourceId?: string;
    extractedText?: string;
    extractedTitle?: string;
    deepLink?: string;
  },
) {
  // Types that don't require background extraction.
  const skipExtraction =
    data.type === 'note' ||
    data.type === 'text_block' ||
    data.type === 'chat_excerpt';

  // Get next sort order + the parent task's orgId in parallel.
  const [task, lastItem] = await Promise.all([
    prisma.task.findUnique({ where: { id: taskId }, select: { orgId: true } }),
    prisma.taskContextItem.findFirst({
      where: { taskId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    }),
  ]);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const item = await prisma.taskContextItem.create({
    data: {
      orgId: task.orgId,
      taskId,
      type: data.type,
      label: data.label ?? null,
      rawValue: data.rawValue,
      mimeType: data.mimeType ?? null,
      sizeBytes: data.sizeBytes ?? null,
      storagePath: data.storagePath ?? null,
      deepLink: data.deepLink ?? null,
      extractionStatus: skipExtraction ? 'completed' : 'pending',
      extractedText: skipExtraction ? data.extractedText ?? data.rawValue : null,
      extractedTitle: data.extractedTitle ?? null,
      mcpIntegrationId: data.mcpIntegrationId ?? null,
      mcpResourceType: data.mcpResourceType ?? null,
      mcpResourceId: data.mcpResourceId ?? null,
      sortOrder: (lastItem?.sortOrder ?? -1) + 1,
      createdBy,
    },
  });

  // For passthrough types, generate embedding immediately from the
  // extracted text (which is rawValue for note/text_block, or the serialized
  // excerpt for chat_excerpt).
  if (skipExtraction && item.extractedText) {
    generateEmbeddingForItem(item.id, item.extractedText).catch((err) => {
      logger.warn({ err, itemId: item.id }, 'Failed to generate embedding for context item');
    });
  }

  return item;
}

/**
 * Builds a chat_excerpt context item from a slice of chat messages.
 * Idempotent across (taskId, messageIds) — if an item with the same
 * deepLink anchor already exists for the task, returns it instead of
 * creating a duplicate.
 *
 * messageIds may be empty, in which case the function pulls the most
 * recent `recentN` non-tool messages from the session.
 */
export async function attachChatExcerpt(
  taskId: string,
  createdBy: string,
  data: {
    sessionId: string;
    anchorMessageId: string;
    messageIds?: string[];
    recentN?: number;
  },
): Promise<{ itemId: string; messageCount: number }> {
  const { sessionId, anchorMessageId } = data;
  const recentN = data.recentN ?? 4;
  const explicitIds = data.messageIds ?? [];

  // Resolve the message slice
  let messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: Date;
    createdBy: string | null;
    author: { name: string } | null;
  }>;
  if (explicitIds.length > 0) {
    messages = await prisma.chatMessage.findMany({
      where: { id: { in: explicitIds }, sessionId },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { name: true } } },
    });
  } else {
    // Anchor + the recentN messages immediately preceding it (inclusive).
    const anchor = await prisma.chatMessage.findFirst({
      where: { id: anchorMessageId, sessionId },
      select: { createdAt: true },
    });
    if (!anchor) {
      throw new Error('Anchor message not found in session');
    }
    const tail = await prisma.chatMessage.findMany({
      where: {
        sessionId,
        createdAt: { lte: anchor.createdAt },
        role: { in: ['user', 'assistant'] },
      },
      orderBy: { createdAt: 'desc' },
      take: recentN,
      include: { author: { select: { name: true } } },
    });
    messages = tail.reverse();
  }

  if (messages.length === 0) {
    throw new Error('No messages to attach');
  }

  const deepLink = `/chat/${sessionId}?messageId=${anchorMessageId}`;

  // Idempotency: if an item with the same deepLink exists for the task, return it.
  const existing = await prisma.taskContextItem.findFirst({
    where: { taskId, type: 'chat_excerpt', deepLink },
    select: { id: true },
  });
  if (existing) {
    return { itemId: existing.id, messageCount: messages.length };
  }

  const serialized = messages
    .map((m) => {
      const who =
        m.role === 'assistant' ? 'Assistant' : m.author?.name ?? 'User';
      const ts = m.createdAt.toISOString();
      return `[${ts}] ${who}: ${m.content}`;
    })
    .join('\n\n');

  const titleSeed =
    messages.find((m) => m.role === 'user')?.content ??
    messages[0].content;
  const extractedTitle = titleSeed.slice(0, 80).replace(/\s+/g, ' ').trim();

  const item = await createContextItem(taskId, createdBy, {
    type: 'chat_excerpt',
    rawValue: JSON.stringify({
      sessionId,
      anchorMessageId,
      messageIds: messages.map((m) => m.id),
    }),
    label: 'From chat',
    extractedText: serialized,
    extractedTitle,
    deepLink,
  });

  return { itemId: item.id, messageCount: messages.length };
}

export async function listContextItems(taskId: string) {
  return prisma.taskContextItem.findMany({
    where: { taskId },
    orderBy: { sortOrder: 'asc' },
  });
}

export async function getContextItem(itemId: string) {
  return prisma.taskContextItem.findUnique({
    where: { id: itemId },
  });
}

export async function updateContextItem(
  itemId: string,
  data: { label?: string; sortOrder?: number },
) {
  const updateData: Prisma.TaskContextItemUpdateInput = {};
  if (data.label !== undefined) updateData.label = data.label;
  if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;

  return prisma.taskContextItem.update({
    where: { id: itemId },
    data: updateData,
  });
}

export async function deleteContextItem(itemId: string) {
  return prisma.taskContextItem.delete({
    where: { id: itemId },
  });
}

export async function updateExtractionResult(
  itemId: string,
  data: {
    extractedText?: string | null;
    extractedTitle?: string | null;
    extractionStatus: ExtractionStatus;
    extractionError?: string | null;
    visionAnalysis?: string | null;
  },
) {
  return prisma.taskContextItem.update({
    where: { id: itemId },
    data: {
      extractedText: data.extractedText ?? null,
      extractedTitle: data.extractedTitle ?? null,
      extractionStatus: data.extractionStatus,
      extractionError: data.extractionError ?? null,
      visionAnalysis: data.visionAnalysis ?? null,
    },
  });
}

// ── Embedding ──

export async function generateEmbeddingForItem(itemId: string, text: string) {
  try {
    const embedding = await generateEmbedding(text);
    if (embedding) {
      const vecLiteral = `[${embedding.join(',')}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE task_context_items SET embedding = $1::vector WHERE id = $2`,
        vecLiteral,
        itemId,
      );
    }
  } catch (err) {
    logger.warn({ err, itemId }, 'Failed to store embedding for context item');
  }
}

// ── Token-budgeted context serializer ──

const CHARS_PER_TOKEN = 4; // rough approximation

export async function serializeTaskContext(
  taskId: string,
  options: {
    maxTokens?: number;
    query?: string;
  } = {},
): Promise<string> {
  const maxTokens = options.maxTokens ?? 4000;
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  // Load completed context items
  const items = await prisma.taskContextItem.findMany({
    where: {
      taskId,
      extractionStatus: 'completed',
    },
    orderBy: { sortOrder: 'asc' },
  });

  // Also load legacy context notes from task.context JSON
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { context: true },
  });
  const legacyContext = (task?.context as Record<string, unknown>) ?? {};
  const legacyEntries = Object.entries(legacyContext).filter(
    ([, v]) => v !== null && v !== undefined,
  );

  if (items.length === 0 && legacyEntries.length === 0) return '';

  const sections: string[] = [];
  let usedChars = 0;
  const headerLine = '## Task Context\n\n';
  usedChars += headerLine.length;
  sections.push(headerLine);

  // If we have embeddings and a query, rank by similarity
  // For now use sortOrder (simpler, and embeddings may not be available)
  const sortedItems = items;

  let included = 0;
  const totalItems = sortedItems.length + legacyEntries.length;

  // Serialize rich context items
  for (const item of sortedItems) {
    const section = formatContextItem(item);
    if (usedChars + section.length > maxChars) break;
    sections.push(section);
    usedChars += section.length;
    included++;
  }

  // Serialize legacy context entries
  for (const [key, value] of legacyEntries) {
    const label = key.startsWith('note_') ? formatNoteKey(key) : key;
    const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const section = `### [Legacy Note] ${label}\n${truncateText(content, 500)}\n\n`;
    if (usedChars + section.length > maxChars) break;
    sections.push(section);
    usedChars += section.length;
    included++;
  }

  // Indicate truncation
  const remaining = totalItems - included;
  if (remaining > 0) {
    sections.push(
      `\n[${remaining} more context item${remaining > 1 ? 's' : ''} available — use get_task_context tool to retrieve]\n`,
    );
  }

  return sections.join('');
}

// ── Helpers ──

const TYPE_LABELS: Record<string, string> = {
  note: 'Note',
  link: 'Link',
  file: 'File',
  image: 'Image',
  text_block: 'Text Block',
  mcp_reference: 'Integration',
};

function formatContextItem(item: {
  type: string;
  label: string | null;
  rawValue: string;
  extractedText: string | null;
  extractedTitle: string | null;
  visionAnalysis: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  mcpResourceType: string | null;
}): string {
  const typeLabel = TYPE_LABELS[item.type] ?? item.type;
  const title = item.extractedTitle ?? item.label ?? item.rawValue.slice(0, 80);
  const parts: string[] = [`### [${typeLabel}] ${title}`];

  if (item.type === 'link') {
    parts.push(`Source: ${item.rawValue}`);
  } else if (item.type === 'file' || item.type === 'image') {
    const size = item.sizeBytes
      ? ` (${(item.sizeBytes / 1024).toFixed(1)}KB)`
      : '';
    parts.push(`File: ${item.rawValue}${size}`);
  } else if (item.mcpResourceType) {
    parts.push(`Source: ${item.mcpResourceType}`);
  }

  if (item.visionAnalysis) {
    parts.push(`Analysis: ${truncateText(item.visionAnalysis, 500)}`);
  } else if (item.type === 'image') {
    parts.push('Analysis: No vision analysis — image available for review');
  }

  if (item.extractedText) {
    parts.push(`Content: ${truncateText(item.extractedText, 2000)}`);
  }

  return parts.join('\n') + '\n\n';
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

function formatNoteKey(key: string): string {
  const dateStr = key.replace('note_', '');
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return key;
    return `Note — ${date.toISOString().split('T')[0]}`;
  } catch {
    return key;
  }
}
