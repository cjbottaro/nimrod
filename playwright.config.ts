import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  workers: 1,
  fullyParallel: false,
  use: { headless: true, viewport: { width: 800, height: 520 }, deviceScaleFactor: 2, trace: 'retain-on-failure' },
  projects: [{ name: 'webkit', use: { browserName: 'webkit' } }],
});
