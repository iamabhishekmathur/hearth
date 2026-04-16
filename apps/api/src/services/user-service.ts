import { prisma } from '../lib/prisma.js';
import type { User, Prisma } from '@prisma/client';
import type { UserRole } from '@hearth/shared';

export async function findById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

export async function findByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email } });
}

export async function listUsers(options?: {
  teamId?: string;
  role?: UserRole;
  page?: number;
  pageSize?: number;
}): Promise<{ users: User[]; total: number }> {
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 20;
  const where: Record<string, unknown> = {};

  if (options?.teamId) where.teamId = options.teamId;
  if (options?.role) where.role = options.role;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
  ]);

  return { users, total };
}

export async function updateUser(
  id: string,
  data: { name?: string; role?: UserRole; preferences?: Prisma.InputJsonValue },
): Promise<User> {
  return prisma.user.update({
    where: { id },
    data,
  });
}

export async function updateUserTeam(id: string, teamId: string): Promise<User> {
  return prisma.user.update({
    where: { id },
    data: { team: { connect: { id: teamId } } },
  });
}

export async function deleteUser(id: string): Promise<void> {
  await prisma.user.delete({ where: { id } });
}

/**
 * Sanitize user for API responses — strips passwordHash.
 */
export function sanitizeUser(user: User) {
  const { passwordHash: _, ...safe } = user;
  return safe;
}
