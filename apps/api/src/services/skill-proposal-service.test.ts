import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    taskExecutionStep: { count: vi.fn() },
    skill: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    task: { findUnique: vi.fn() },
  },
}));

import { prisma } from '../lib/prisma.js';
import * as proposalService from './skill-proposal-service.js';

describe('skill-proposal-service', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('shouldPropose', () => {
    it('returns true when task has >3 steps', async () => {
      (prisma.taskExecutionStep.count as ReturnType<typeof vi.fn>).mockResolvedValue(5);
      expect(await proposalService.shouldPropose('t1')).toBe(true);
    });

    it('returns false when task has <=3 steps', async () => {
      (prisma.taskExecutionStep.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);
      expect(await proposalService.shouldPropose('t1')).toBe(false);
    });
  });

  describe('hasProposal', () => {
    it('returns true when proposal exists', async () => {
      (prisma.skill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1' });
      expect(await proposalService.hasProposal('t1')).toBe(true);
    });

    it('returns false when no proposal exists', async () => {
      (prisma.skill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      expect(await proposalService.hasProposal('t1')).toBe(false);
    });
  });

  describe('generateProposal', () => {
    it('generates proposal from task with execution steps', async () => {
      (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 't1',
        title: 'Fix the bug',
        description: 'There is a bug in auth',
        executionSteps: [
          { stepNumber: 1, description: 'Read code', toolUsed: 'read_file', status: 'completed' },
          { stepNumber: 2, description: 'Fix issue', toolUsed: 'edit_file', status: 'completed' },
        ],
      });

      const result = await proposalService.generateProposal('t1');

      expect(result).not.toBeNull();
      expect(result?.name).toContain('Fix the bug');
      expect(result?.content).toContain('Read code');
      expect(result?.content).toContain('Fix issue');
    });

    it('returns null for missing task', async () => {
      (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      expect(await proposalService.generateProposal('t1')).toBeNull();
    });
  });

  describe('submitForReview', () => {
    it('transitions draft to pending_review', async () => {
      (prisma.skill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1', status: 'draft' });
      (prisma.skill.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1', status: 'pending_review' });

      const result = await proposalService.submitForReview('s1', 'u1');
      expect(result?.status).toBe('pending_review');
    });

    it('returns null for non-draft skill', async () => {
      (prisma.skill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      expect(await proposalService.submitForReview('s1', 'u1')).toBeNull();
    });
  });
});
