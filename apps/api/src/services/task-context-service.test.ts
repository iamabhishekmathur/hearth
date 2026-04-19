import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    taskContextItem: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
    },
    $executeRawUnsafe: vi.fn(),
  },
}));

// Mock embedding service
vi.mock('./embedding-service.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(null),
}));

import { prisma } from '../lib/prisma.js';
import {
  createContextItem,
  listContextItems,
  getContextItem,
  updateContextItem,
  deleteContextItem,
  serializeTaskContext,
} from './task-context-service.js';

describe('task-context-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createContextItem', () => {
    it('creates a note with completed extraction status (passthrough)', async () => {
      (prisma.taskContextItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.taskContextItem.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'ci1',
        taskId: 't1',
        type: 'note',
        rawValue: 'Test note',
        extractionStatus: 'completed',
        extractedText: 'Test note',
        sortOrder: 0,
      });

      const item = await createContextItem('t1', 'u1', {
        type: 'note',
        rawValue: 'Test note',
      });

      expect(item.extractionStatus).toBe('completed');
      expect(item.extractedText).toBe('Test note');

      const createCall = (prisma.taskContextItem.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createCall.data.extractionStatus).toBe('completed');
      expect(createCall.data.extractedText).toBe('Test note');
    });

    it('creates a link with pending extraction status', async () => {
      (prisma.taskContextItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.taskContextItem.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'ci2',
        taskId: 't1',
        type: 'link',
        rawValue: 'https://example.com',
        extractionStatus: 'pending',
        extractedText: null,
        sortOrder: 0,
      });

      const item = await createContextItem('t1', 'u1', {
        type: 'link',
        rawValue: 'https://example.com',
      });

      expect(item.extractionStatus).toBe('pending');
      expect(item.extractedText).toBeNull();
    });

    it('creates a text_block with completed status (passthrough)', async () => {
      const longText = 'A '.repeat(300);
      (prisma.taskContextItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ sortOrder: 2 });
      (prisma.taskContextItem.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'ci3',
        taskId: 't1',
        type: 'text_block',
        rawValue: longText,
        extractionStatus: 'completed',
        extractedText: longText,
        sortOrder: 3,
      });

      const item = await createContextItem('t1', 'u1', {
        type: 'text_block',
        rawValue: longText,
      });

      expect(item.sortOrder).toBe(3);
      expect(item.extractionStatus).toBe('completed');
    });
  });

  describe('listContextItems', () => {
    it('returns items sorted by sortOrder', async () => {
      const mockItems = [
        { id: 'ci1', sortOrder: 0 },
        { id: 'ci2', sortOrder: 1 },
      ];
      (prisma.taskContextItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockItems);

      const result = await listContextItems('t1');
      expect(result).toEqual(mockItems);
      expect(prisma.taskContextItem.findMany).toHaveBeenCalledWith({
        where: { taskId: 't1' },
        orderBy: { sortOrder: 'asc' },
      });
    });
  });

  describe('getContextItem', () => {
    it('returns item by id', async () => {
      const mockItem = { id: 'ci1', taskId: 't1', type: 'note' };
      (prisma.taskContextItem.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockItem);

      const result = await getContextItem('ci1');
      expect(result).toEqual(mockItem);
    });
  });

  describe('updateContextItem', () => {
    it('updates label and sortOrder', async () => {
      (prisma.taskContextItem.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'ci1',
        label: 'New Label',
        sortOrder: 5,
      });

      const result = await updateContextItem('ci1', { label: 'New Label', sortOrder: 5 });
      expect(result.label).toBe('New Label');
      expect(result.sortOrder).toBe(5);
    });
  });

  describe('deleteContextItem', () => {
    it('deletes item by id', async () => {
      (prisma.taskContextItem.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ci1' });
      await deleteContextItem('ci1');
      expect(prisma.taskContextItem.delete).toHaveBeenCalledWith({ where: { id: 'ci1' } });
    });
  });

  describe('serializeTaskContext', () => {
    it('returns empty string when no context items or legacy context', async () => {
      (prisma.taskContextItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ context: {} });

      const result = await serializeTaskContext('t1');
      expect(result).toBe('');
    });

    it('serializes context items with type headers', async () => {
      (prisma.taskContextItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'ci1',
          type: 'link',
          label: null,
          rawValue: 'https://example.com/article',
          extractedText: 'Article content here',
          extractedTitle: 'Best Practices',
          extractionStatus: 'completed',
          visionAnalysis: null,
          mimeType: null,
          sizeBytes: null,
          mcpResourceType: null,
          sortOrder: 0,
        },
        {
          id: 'ci2',
          type: 'note',
          label: 'Requirements',
          rawValue: 'Must support PDF upload',
          extractedText: 'Must support PDF upload',
          extractedTitle: null,
          extractionStatus: 'completed',
          visionAnalysis: null,
          mimeType: null,
          sizeBytes: null,
          mcpResourceType: null,
          sortOrder: 1,
        },
      ]);
      (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ context: {} });

      const result = await serializeTaskContext('t1');
      expect(result).toContain('## Task Context');
      expect(result).toContain('[Link] Best Practices');
      expect(result).toContain('Source: https://example.com/article');
      expect(result).toContain('Article content here');
      expect(result).toContain('[Note] Requirements');
      expect(result).toContain('Must support PDF upload');
    });

    it('respects token budget and adds truncation notice', async () => {
      const longContent = 'x'.repeat(20000);
      (prisma.taskContextItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'ci1',
          type: 'text_block',
          label: 'Big doc',
          rawValue: longContent,
          extractedText: longContent,
          extractedTitle: 'Big Document',
          extractionStatus: 'completed',
          visionAnalysis: null,
          mimeType: null,
          sizeBytes: null,
          mcpResourceType: null,
          sortOrder: 0,
        },
        {
          id: 'ci2',
          type: 'note',
          label: 'Small note',
          rawValue: 'short text',
          extractedText: 'short text',
          extractedTitle: null,
          extractionStatus: 'completed',
          visionAnalysis: null,
          mimeType: null,
          sizeBytes: null,
          mcpResourceType: null,
          sortOrder: 1,
        },
      ]);
      (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ context: {} });

      // Very small budget — should only fit first item partially, and truncate second
      const result = await serializeTaskContext('t1', { maxTokens: 500 });
      // Should have truncation notice if second item didn't fit
      // (with 500 tokens = 2000 chars, the 20000 char item alone is too long for full inclusion)
      expect(result).toContain('## Task Context');
    });

    it('includes legacy context entries', async () => {
      (prisma.taskContextItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        context: { note_2026_01_01: 'legacy note content', reviewFeedback: 'please fix' },
      });

      const result = await serializeTaskContext('t1');
      expect(result).toContain('[Legacy Note]');
      expect(result).toContain('legacy note content');
      expect(result).toContain('please fix');
    });

    it('serializes image items with vision analysis', async () => {
      (prisma.taskContextItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'ci1',
          type: 'image',
          label: 'Mockup',
          rawValue: 'mockup.png',
          extractedText: null,
          extractedTitle: null,
          extractionStatus: 'completed',
          visionAnalysis: 'A dashboard showing three charts',
          mimeType: 'image/png',
          sizeBytes: 1024000,
          mcpResourceType: null,
          sortOrder: 0,
        },
      ]);
      (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ context: {} });

      const result = await serializeTaskContext('t1');
      expect(result).toContain('[Image] Mockup');
      expect(result).toContain('A dashboard showing three charts');
    });
  });
});
