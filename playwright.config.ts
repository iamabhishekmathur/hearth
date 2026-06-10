import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 4,
  reporter: [
    ['list'],
    ['./e2e/reporters/markdown-reporter.ts'],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    actionTimeout: 10_000,
  },
  projects: [
    // Setup: seed data + auth states
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
    },
    // Auth tests (no seed dependency — uses own fixtures)
    {
      name: 'auth',
      testMatch: /auth\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    // Feature tests (parallel)
    {
      name: 'chat',
      // Top-level chat spec only — not e2e/ui/chat.spec.ts (the 'ui' project).
      testMatch: /[\\/]e2e[\\/]chat\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'tasks',
      // Top-level tasks spec only — not e2e/ui/kanban.tasks.spec.ts ('ui').
      testMatch: /[\\/]e2e[\\/]tasks\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chat-to-task',
      testMatch: /chat-to-task\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'decisions',
      testMatch: /decisions\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'memory',
      testMatch: /memory\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'routines',
      testMatch: /routines\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'skills',
      testMatch: /skills\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'activity',
      testMatch: /activity\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'settings',
      // Scope to the top-level settings spec so it doesn't also pick up
      // e2e/ui/settings.spec.ts (which belongs to the 'ui' project below).
      testMatch: /[\\/]e2e[\\/]settings\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'governance',
      testMatch: /governance\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'compliance',
      testMatch: /compliance\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'cognitive',
      testMatch: /cognitive\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mcp',
      testMatch: /mcp\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    // Workflow tests (serial, after features)
    {
      name: 'personas',
      testMatch: /personas\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'workflows',
      testMatch: /workflows\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'pipelines',
      testMatch: /pipelines\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    // DOM-driven UI specs (e2e/ui/*.spec.ts) — click the real frontend.
    {
      name: 'ui',
      testMatch: /[\\/]e2e[\\/]ui[\\/].*\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    // Concurrency / race specs (e2e/concurrency/*.spec.ts) — parallel API races.
    {
      name: 'concurrency',
      testMatch: /[\\/]e2e[\\/]concurrency[\\/].*\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
