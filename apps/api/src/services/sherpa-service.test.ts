import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    userSkill: { findMany: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    skill: { findMany: vi.fn() },
    integration: { findMany: vi.fn() },
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { error: vi.fn() },
}));

import { prisma } from '../lib/prisma.js';
import { getRecommendations } from './sherpa-service.js';

describe('sherpa-service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty when no published skills are available', async () => {
    (prisma.userSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ teamId: 't1' });
    (prisma.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.integration.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await getRecommendations('u1', 'org1');
    expect(result).toEqual([]);
  });

  it('excludes already installed skills', async () => {
    (prisma.userSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { skillId: 's1' },
    ]);
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ teamId: 't1' });
    (prisma.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 's2', name: 'Available', description: 'desc', installCount: 5, requiredIntegrations: [], createdAt: new Date(), _count: { users: 5 } },
    ]);
    (prisma.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.integration.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await getRecommendations('u1', 'org1');

    // Should only include s2, not s1
    expect(result.length).toBe(1);
    expect(result[0].skillId).toBe('s2');
  });

  it('boosts skills used by teammates', async () => {
    (prisma.userSkill.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // user's installed
      .mockResolvedValueOnce([{ skillId: 's1' }, { skillId: 's1' }]); // team installs

    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ teamId: 't1' });
    (prisma.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 's1', name: 'Popular', description: 'desc', installCount: 10, requiredIntegrations: [], createdAt: new Date(), _count: { users: 10 } },
      { id: 's2', name: 'Niche', description: 'desc', installCount: 1, requiredIntegrations: [], createdAt: new Date(), _count: { users: 1 } },
    ]);
    (prisma.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'u2' }, { id: 'u3' }]);
    (prisma.integration.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await getRecommendations('u1', 'org1');

    // Popular skill should be ranked first
    expect(result[0].skillId).toBe('s1');
    expect(result[0].reasons).toContain('Used by 2 teammates');
  });
});
