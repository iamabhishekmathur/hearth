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
  },
) {
  // Determine initial extraction status
  const skipExtraction = data.type === 'note' || data.type === 'text_block';

  // Get next sort order
  const lastItem = await prisma.taskContextItem.findFirst({
    where: { taskId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  const item = await prisma.taskContextItem.create({
    data: {
      taskId,
      type: data.type,
      label: data.label ?? null,
      rawValue: data.rawValue,
      mimeType: data.mimeType ?? null,
      sizeBytes: data.sizeBytes ?? null,
      storagePath: data.storagePath ?? null,
      extractionStatus: skipExtraction ? 'completed' : 'pending',
      extractedText: skipExtraction ? data.rawValue : null,
      mcpIntegrationId: data.mcpIntegrationId ?? null,
      mcpResourceType: data.mcpResourceType ?? null,
      mcpResourceId: data.mcpResourceId ?? null,
      sortOrder: (lastItem?.sortOrder ?? -1) + 1,
      createdBy,
    },
  });

  // For passthrough types, generate embedding immediately
  if (skipExtraction && data.rawValue) {
    generateEmbeddingForItem(item.id, data.rawValue).catch((err) => {
      logger.warn({ err, itemId: item.id }, 'Failed to generate embedding for context item');
    });
  }

  return item;
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
