import type { Prisma, SkillScope, SkillStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { loadSkillsFromDisk } from './skill-loader.js';
import { validateSkill } from './skill-validator.js';

// ── Types ────────────────────────────────────────────────────────────

export interface SkillFilters {
  search?: string;
  scope?: SkillScope;
  status?: SkillStatus;
  installedByUser?: string;
}

export interface CreateSkillInput {
  orgId: string;
  authorId: string;
  name: string;
  description: string;
  content: string;
  scope?: SkillScope;
  teamId?: string;
  requiredIntegrations?: string[];
  requiredCapabilities?: string[];
  recommendedModel?: string;
  status?: SkillStatus;
}

// ── Queries ──────────────────────────────────────────────────────────

/**
 * Lists skills available in an org with optional search and filters.
 */
export async function listSkills(orgId: string, filters?: SkillFilters) {
  const where: Prisma.SkillWhereInput = { orgId };

  if (filters?.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  if (filters?.scope) {
    where.scope = filters.scope;
  }

  if (filters?.status) {
    where.status = filters.status;
  }

  const skills = await prisma.skill.findMany({
    where,
    orderBy: [{ installCount: 'desc' }, { name: 'asc' }],
    include: {
      author: { select: { id: true, name: true } },
      _count: { select: { users: true } },
    },
  });

  // Use _count.users as the source of truth for install counts
  const normalized = skills.map(({ _count, ...s }) => ({
    ...s,
    installCount: _count.users,
  }));

  // If we need to filter by installed user, annotate each skill
  if (filters?.installedByUser) {
    const installed = await prisma.userSkill.findMany({
      where: { userId: filters.installedByUser },
      select: { skillId: true },
    });
    const installedSet = new Set(installed.map((us) => us.skillId));
    return normalized.map((s) => ({ ...s, installed: installedSet.has(s.id) }));
  }

  return normalized;
}

/**
 * Gets a single skill by ID, including author info.
 */
export async function getSkill(id: string) {
  const skill = await prisma.skill.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true } },
      _count: { select: { users: true } },
    },
  });

  if (!skill) return null;

  const { _count, ...rest } = skill;
  return { ...rest, installCount: _count.users };
}

/**
 * Updates a skill's fields (status, name, description, content).
 */
export async function updateSkill(id: string, data: Record<string, unknown>) {
  const skill = await prisma.skill.update({
    where: { id },
    data: data as Prisma.SkillUpdateInput,
    include: {
      author: { select: { id: true, name: true } },
      _count: { select: { users: true } },
    },
  });

  const { _count, ...rest } = skill;
  return { ...rest, installCount: _count.users };
}

/**
 * Deletes a skill and its associated user_skills.
 */
export async function deleteSkill(id: string) {
  await prisma.$transaction([
    prisma.userSkill.deleteMany({ where: { skillId: id } }),
    prisma.skill.delete({ where: { id } }),
  ]);
}

/**
 * Installs a skill for a user — creates UserSkill record and increments install_count.
 */
export async function installSkill(userId: string, skillId: string) {
  // Check skill exists
  const skill = await prisma.skill.findUnique({ where: { id: skillId } });
  if (!skill) {
    throw new Error('Skill not found');
  }

  // Upsert to handle idempotent installs
  const [userSkill] = await prisma.$transaction([
    prisma.userSkill.upsert({
      where: { userId_skillId: { userId, skillId } },
      create: { userId, skillId },
      update: {},
    }),
    prisma.skill.update({
      where: { id: skillId },
      data: { installCount: { increment: 1 } },
    }),
  ]);

  return userSkill;
}

/**
 * Uninstalls a skill for a user — removes UserSkill record.
 */
export async function uninstallSkill(userId: string, skillId: string) {
  // Check that the user has this skill installed
  const existing = await prisma.userSkill.findUnique({
    where: { userId_skillId: { userId, skillId } },
  });

  if (!existing) {
    throw new Error('Skill is not installed');
  }

  await prisma.$transaction([
    prisma.userSkill.delete({
      where: { userId_skillId: { userId, skillId } },
    }),
    prisma.skill.update({
      where: { id: skillId },
      data: { installCount: { decrement: 1 } },
    }),
  ]);
}

/**
 * Gets all skills installed by a user.
 */
export async function getUserSkills(userId: string) {
  const userSkills = await prisma.userSkill.findMany({
    where: { userId },
    include: {
      skill: {
        include: {
          author: { select: { id: true, name: true } },
          _count: { select: { users: true } },
        },
      },
    },
    orderBy: { installedAt: 'desc' },
  });

  return userSkills.map((us) => {
    const { _count, ...skill } = us.skill;
    return {
      ...skill,
      installCount: _count.users,
      installedAt: us.installedAt,
      installed: true,
    };
  });
}

// Core skills to seed — curated subset of the full library
const SEED_SKILLS = new Set([
  'spec-driven-development',
  'planning-and-task-breakdown',
  'incremental-implementation',
  'test-driven-development',
  'code-review-and-quality',
  'debugging-and-error-recovery',
  'api-and-interface-design',
]);

/**
 * Seeds skills from the agent-skills/skills/ directory into the database.
 * Only seeds a curated subset of core skills (not the full library).
 * Upserts by name within the org so it can be run multiple times safely.
 */
export async function seedSkills(orgId: string, authorId: string) {
  const allDiskSkills = await loadSkillsFromDisk();
  const diskSkills = allDiskSkills.filter((s) => SEED_SKILLS.has(s.name));
  const results: Array<{ name: string; id: string; action: 'created' | 'updated' }> = [];

  for (const ds of diskSkills) {
    const skill = await prisma.skill.upsert({
      where: { orgId_name: { orgId, name: ds.name } },
      update: {
        description: ds.description,
        content: ds.content,
      },
      create: {
        orgId,
        authorId,
        name: ds.name,
        description: ds.description,
        content: ds.content,
        scope: 'org',
        status: 'published',
        requiredIntegrations: [],
        requiredCapabilities: [],
      },
    });

    results.push({ name: ds.name, id: skill.id, action: skill.createdAt.getTime() === skill.updatedAt.getTime() ? 'created' : 'updated' });
  }

  return results;
}

/**
 * Creates a custom skill. Validates format before saving.
 */
export async function createSkill(data: CreateSkillInput) {
  const validation = validateSkill({
    name: data.name,
    description: data.description,
    content: data.content,
  });

  if (!validation.valid) {
    throw new Error(`Invalid skill: ${validation.errors.join(', ')}`);
  }

  return prisma.skill.create({
    data: {
      orgId: data.orgId,
      authorId: data.authorId,
      name: data.name,
      description: data.description,
      content: data.content,
      scope: data.scope ?? 'personal',
      teamId: data.teamId ?? null,
      requiredIntegrations: data.requiredIntegrations ?? [],
      requiredCapabilities: data.requiredCapabilities ?? [],
      recommendedModel: data.recommendedModel ?? null,
      status: data.status ?? 'draft',
    },
    include: {
      author: { select: { id: true, name: true } },
    },
  });
}
