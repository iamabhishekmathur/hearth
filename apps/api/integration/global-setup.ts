import { execSync } from 'node:child_process';

/**
 * Vitest globalSetup — runs once, in the main process, before any test file.
 * Applies all Prisma migrations to the isolated test database. DATABASE_URL is
 * already forced to the test stack by vitest.integration.config.ts (which is
 * evaluated before this hook), so `migrate deploy` targets hearth_test.
 *
 * Assumes the test stack is up:
 *   docker compose -f docker-compose.test.yml up -d
 * (the `test:integration` script does this for you).
 */
export default function globalSetup(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !/:(5433)\b|hearth_test/.test(databaseUrl)) {
    throw new Error(
      `Refusing to migrate: DATABASE_URL does not look like the test database (${databaseUrl}). ` +
        'Integration tests must target the docker-compose.test.yml stack.',
    );
  }

  // eslint-disable-next-line no-console
  console.log('[integration] applying migrations to', databaseUrl);
  execSync('pnpm exec prisma migrate deploy', {
    cwd: process.cwd(), // apps/api — where prisma/schema.prisma lives
    env: process.env,
    stdio: 'inherit',
  });
}
