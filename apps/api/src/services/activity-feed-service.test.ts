import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    skill: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    routineRun: {
      groupBy: vi.fn().mockResolvedValue([]),
    },
    taskExecutionStep: {
      groupBy: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../llm/provider-registry.js', () => ({
  providerRegistry: {
    // Simulate LLM failure to test template fallback
    chatWithFallback: vi.fn().mockImplementation(async function* () {
      yield { type: 'error', message: 'No providers' };
    }),
  },
}));

import { prisma } from '../lib/prisma.js';
import { getFeed, getFeedCursor, generateDigest } from './activity-feed-service.js';

describe('activity-feed-service', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('getFeed', () => {
    it('returns paginated feed events', async () => {
      const mockLogs = [
        {
          id: 'a1',
          userId: 'u1',
          action: 'task_completed',
          entityType: 'task',
          entityId: 't1',
          details: { title: 'Fix bug' },
          createdAt: new Date(),
          user: { id: 'u1', name: 'Alice' },
        },
      ];

      (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockLogs);
      (prisma.auditLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const result = await getFeed({ orgId: 'org1' });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].userName).toBe('Alice');
      expect(result.data[0].action).toBe('task_completed');
      expect(result.total).toBe(1);
    });

    it('filters by action type', async () => {
      (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.auditLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      await getFeed({ orgId: 'org1', action: 'skill_published' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            action: { equals: 'skill_published' },
          }),
        }),
      );
    });
  });

  describe('getFeedCursor', () => {
    it('returns cursor-paginated feed events', async () => {
      const now = new Date();
      const mockLogs = [
        {
          id: 'a1',
          userId: 'u1',
          action: 'task_completed',
          entityType: 'task',
          entityId: 't1',
          details: { title: 'Fix bug' },
          createdAt: now,
          user: { id: 'u1', name: 'Alice' },
        },
      ];

      (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockLogs);

      const result = await getFeedCursor({ orgId: 'org1' });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].userName).toBe('Alice');
      expect(result.hasMore).toBe(false);
      expect(result.cursor).toBe(`${now.toISOString()}_a1`);
    });

    it('returns hasMore when more results exist', async () => {
      const logs = Array.from({ length: 31 }, (_, i) => ({
        id: `a${i}`,
        userId: 'u1',
        action: 'task_completed',
        entityType: 'task',
        entityId: `t${i}`,
        details: { title: `Task ${i}` },
        createdAt: new Date(Date.now() - i * 1000),
        user: { id: 'u1', name: 'Alice' },
      }));

      (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(logs);

      const result = await getFeedCursor({ orgId: 'org1' });

      expect(result.data).toHaveLength(30);
      expect(result.hasMore).toBe(true);
    });

    it('applies cursor-based filtering', async () => {
      (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const cursorDate = new Date('2026-04-17T10:00:00.000Z');
      const cursor = `${cursorDate.toISOString()}_some-id`;

      await getFeedCursor({ orgId: 'org1', cursor });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { createdAt: { lt: cursorDate } },
              { createdAt: { equals: cursorDate }, id: { lt: 'some-id' } },
            ],
          }),
        }),
      );
    });

    it('applies since filter for reconnect catch-up', async () => {
      (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const since = new Date('2026-04-17T08:00:00.000Z');
      await getFeedCursor({ orgId: 'org1', since });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({ gt: since }),
          }),
        }),
      );
    });
  });

  describe('generateDigest', () => {
    it('returns summary of activity (template fallback)', async () => {
      (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { action: 'task_completed', details: { title: 'Fix auth' }, user: { name: 'Alice' } },
        { action: 'task_completed', details: { title: 'Add tests' }, user: { name: 'Bob' } },
      ]);

      const digest = await generateDigest('org1', new Date(Date.now() - 86400000));

      expect(digest.eventCount).toBe(2);
      expect(digest.summary).toContain('task completed');
      expect(digest.summary).toContain('Alice');
    });

    it('handles no activity', async () => {
      (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const digest = await generateDigest('org1', new Date());
      expect(digest.eventCount).toBe(0);
      expect(digest.summary).toContain('No notable activity');
    });
  });
});
