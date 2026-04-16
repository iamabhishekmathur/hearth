import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { error: vi.fn() },
}));

import { prisma } from '../lib/prisma.js';
import { getFeed, generateDigest } from './activity-feed-service.js';

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

  describe('generateDigest', () => {
    it('returns summary of activity', async () => {
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
