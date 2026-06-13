import { Prisma } from '@prisma/client';

/**
 * True if the error is a Prisma unique-constraint violation (P2002). Routes use
 * this to map a duplicate-row insert to 409 Conflict instead of a generic 500.
 */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
