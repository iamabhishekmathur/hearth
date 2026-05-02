import { PrismaClient } from '@prisma/client';
import { applyTenantExtension } from './prisma-tenant-extension.js';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

const baseClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = baseClient;
}

/**
 * The exported `prisma` is the base client wrapped in the tenant extension.
 * Every query auto-runs inside a transaction with `SET LOCAL app.org_id` so
 * RLS policies see the right tenant. See `prisma-tenant-extension.ts` and
 * `tenant-context.ts` for the design.
 */
export const prisma = applyTenantExtension(baseClient);
