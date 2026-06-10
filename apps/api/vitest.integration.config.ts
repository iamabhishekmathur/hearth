import { defineConfig } from 'vitest/config';

// ─── Force the isolated test stack BEFORE any app module loads ────────────────
// This module is evaluated in the Vitest main process before worker forks are
// spawned, and forks inherit process.env — so config.ts (which reads process.env
// and never overrides already-set vars) sees these values in every worker.
//
// We FORCE the URLs (rather than `??=`) so an exported dev DATABASE_URL in the
// shell or root .env can never make integration tests run against dev data.
// Override only via the dedicated INTEGRATION_* vars.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.INTEGRATION_DATABASE_URL ?? 'postgresql://hearth:hearth@localhost:5433/hearth_test';
process.env.REDIS_URL = process.env.INTEGRATION_REDIS_URL ?? 'redis://localhost:6380';
process.env.SESSION_SECRET ??= 'integration-test-secret';
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
// The suite logs in hundreds of times per minute from one IP (every test seeds
// fresh and re-auths). Lift the auth rate limit so the limiter doesn't 429 the
// suite. The limiter reads this env var at module load (rate-limiter.ts). Tests
// that specifically assert 429 behavior should override it locally.
process.env.AUTH_RATE_LIMIT_MAX ??= '1000000';
// Suppress the chat route's fire-and-forget agent loop: with no LLM key it only
// persists an error assistant message *after* the 202, which races the next
// test's truncate and intermittently fails message-count assertions. Product
// code reads this var only (set nowhere else), so dev/prod are unaffected.
process.env.HEARTH_DISABLE_AGENT_DISPATCH ??= 'true';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['integration/**/*.itest.ts'],
    globalSetup: ['./integration/global-setup.ts'],
    // One DB, shared state — run integration files serially to avoid
    // cross-file truncation races. Within a file, tests share a fixture.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
