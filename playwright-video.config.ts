import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /video-(tour|jtbd|gtm-demo)/,
  timeout: 300_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    headless: true,
    screenshot: 'on',
    video: {
      mode: 'on',
      size: { width: 1440, height: 900 },
    },
    viewport: { width: 1440, height: 900 },
    ...devices['Desktop Chrome'],
  },
  outputDir: 'test-results/videos',
});
