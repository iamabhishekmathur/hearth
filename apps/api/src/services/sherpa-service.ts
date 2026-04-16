import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import type { SkillRecommendation } from '@hearth/shared';

/**
 * Generate personalized skill recommendations for a user.
 * Scoring: integration overlap (0.3) + team popularity (0.3) + recency (0.1) + base (0.3)
 */
export async function getRecommendations(
  userId: string,
  orgId: string,
  limit = 6,
): Promise<SkillRecommendation[]> {
  try {
    // Get user's installed skills
    const installed = await prisma.userSkill.findMany({
      where: { userId },
      select: { skillId: true },
    });
    const installedIds = new Set(installed.map((us) => us.skillId));

    // Get user's team
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { teamId: true },
    });

    // Get all published skills the user hasn't installed
    const skills = await prisma.skill.findMany({
      where: {
        orgId,
        status: 'published',
        id: { notIn: [...installedIds] },
      },
      include: {
        _count: { select: { users: true } },
      },
      orderBy: { installCount: 'desc' },
    });

    if (skills.length === 0) return [];

    // Get team members' installed skills for popularity scoring — single query
    const teamSkillCounts = new Map<string, number>();
    if (user?.teamId) {
      const teamInstalls = await prisma.userSkill.findMany({
        where: {
          user: { teamId: user.teamId, id: { not: userId } },
        },
        select: { skillId: true },
      });
      for (const ti of teamInstalls) {
        teamSkillCounts.set(ti.skillId, (teamSkillCounts.get(ti.skillId) ?? 0) + 1);
      }
    }

    // Get org integrations for overlap scoring
    const orgIntegrations = await prisma.integration.findMany({
      where: { orgId, enabled: true },
      select: { provider: true },
    });
    const activeProviders = new Set(orgIntegrations.map((i) => i.provider));

    // Score each skill
    const maxInstalls = Math.max(...skills.map((s) => s.installCount), 1);
    const now = Date.now();

    const scored: SkillRecommendation[] = skills.map((skill) => {
      let score = 0;
      const reasons: string[] = [];

      // Integration overlap (0.3)
      const requiredIntegrations = skill.requiredIntegrations ?? [];
      if (requiredIntegrations.length > 0) {
        const overlap = requiredIntegrations.filter((ri) => activeProviders.has(ri)).length;
        const integrationScore = overlap / requiredIntegrations.length;
        score += integrationScore * 0.3;
        if (integrationScore > 0) reasons.push('Works with your integrations');
      } else {
        score += 0.3; // No requirements = full score
      }

      // Team popularity (0.3)
      const teamCount = teamSkillCounts.get(skill.id) ?? 0;
      if (teamCount > 0) {
        score += 0.3;
        reasons.push(`Used by ${teamCount} teammate${teamCount > 1 ? 's' : ''}`);
      } else {
        // Fall back to org-wide popularity
        const popularityScore = skill.installCount / maxInstalls;
        score += popularityScore * 0.3;
        if (popularityScore > 0.5) reasons.push('Popular in your org');
      }

      // Recency (0.1)
      const ageMs = now - new Date(skill.createdAt).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const recencyScore = Math.max(0, 1 - ageDays / 90); // newer = higher
      score += recencyScore * 0.1;
      if (ageDays < 7) reasons.push('Recently added');

      // Base score (0.3) — always contributed
      score += 0.3;

      if (reasons.length === 0) reasons.push('Recommended');

      return {
        skillId: skill.id,
        name: skill.name,
        description: skill.description,
        score,
        reasons,
      };
    });

    // Sort by score descending and return top N
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  } catch (err) {
    logger.error({ err, userId }, 'Failed to generate recommendations');
    return [];
  }
}

/**
 * Get a contextual recommendation based on recent chat messages.
 * Returns a single best-match skill or null.
 */
export async function getContextualRecommendation(
  userId: string,
  orgId: string,
  recentMessages: string[],
): Promise<SkillRecommendation | null> {
  try {
    // Get recommendations first
    const recs = await getRecommendations(userId, orgId, 20);
    if (recs.length === 0) return null;

    // Simple keyword matching against recent messages
    const messageText = recentMessages.join(' ').toLowerCase();

    for (const rec of recs) {
      const nameWords = rec.name.toLowerCase().split(/\s+/);
      const descWords = (rec.description ?? '').toLowerCase().split(/\s+/);
      const keywords = [...nameWords, ...descWords].filter((w) => w.length > 3);

      const matches = keywords.filter((kw) => messageText.includes(kw));
      if (matches.length >= 2) {
        return { ...rec, reasons: ['Relevant to your conversation', ...rec.reasons] };
      }
    }

    return null;
  } catch (err) {
    logger.error({ err }, 'Failed to get contextual recommendation');
    return null;
  }
}
