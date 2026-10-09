import { Prisma } from '@prisma/client';

/**
 * True if the error is a Prisma unique-constraint violation (P2002). Routes use
 * this to map a duplicate-row insert to 409 Conflict instead of a generic 500.
 */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * The constraint/index identifier of a P2002 unique violation, if present
 * (Prisma puts it in `meta.target`). Used to tell apart which unique constraint
 * was hit (e.g. skill name vs. command slug).
 */
export function uniqueViolationTarget(err: unknown): string | undefined {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return undefined;
  const target = err.meta?.target;
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) return target.join(',');
  return undefined;
}
