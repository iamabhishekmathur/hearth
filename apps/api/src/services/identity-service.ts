import type { AgentFileType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface IdentityScope {
  orgId: string;
  userId: string;
  role: string;
}

/**
 * Get an identity document. Org-level identities have no userId.
 */
export async function getIdentity(
  scope: IdentityScope,
  fileType: AgentFileType,
  level: 'org' | 'user',
) {
  if (level === 'org') {
    return prisma.agentIdentity.findFirst({
      where: { orgId: scope.orgId, userId: null, fileType },
    });
  }
  return prisma.agentIdentity.findFirst({
    where: { orgId: scope.orgId, userId: scope.userId, fileType },
  });
}

/**
 * Upsert an identity document.
 * - Org-level SOUL.md: admin only
 * - User-level SOUL.md / IDENTITY.md: self-service
 */
export async function upsertIdentity(
  scope: IdentityScope,
  fileType: AgentFileType,
  level: 'org' | 'user',
  content: string,
) {
  if (level === 'org' && scope.role !== 'admin') {
    throw new Error('Only admins can edit org-level identity');
  }

  // Identity.md is user-only
  if (fileType === 'identity' && level === 'org') {
    throw new Error('IDENTITY.md is only available at user level');
  }

  const existing = await getIdentity(scope, fileType, level);

  if (existing) {
    return prisma.agentIdentity.update({
      where: { id: existing.id },
      data: { content, source: 'manual' },
    });
  }

  return prisma.agentIdentity.create({
    data: {
      orgId: scope.orgId,
      userId: level === 'user' ? scope.userId : null,
      fileType,
      content,
      source: 'manual',
    },
  });
}

/**
 * Get the full identity chain for prompt assembly:
 * org SOUL.md → user SOUL.md → user IDENTITY.md
 */
export async function getIdentityChain(orgId: string, userId: string) {
  const [orgSoul, userSoul, userIdentity] = await Promise.all([
    prisma.agentIdentity.findFirst({
      where: { orgId, userId: null, fileType: 'soul' },
    }),
    prisma.agentIdentity.findFirst({
      where: { orgId, userId, fileType: 'soul' },
    }),
    prisma.agentIdentity.findFirst({
      where: { orgId, userId, fileType: 'identity' },
    }),
  ]);

  return {
    orgSoul: orgSoul?.content ?? null,
    userSoul: userSoul?.content ?? null,
    userIdentity: userIdentity?.content ?? null,
  };
}
