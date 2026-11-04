import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', fullyParallel: false, workers: 1,
  timeout: 90_000, expect: { timeout: 15_000 },
  use: { baseURL: process.env.MOJING_URL || 'http://127.0.0.1:5173', channel: 'chrome', headless: true, launchOptions: { args: ['--no-proxy-server'] }, viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', acceptDownloads: true },
  outputDir: 'test-results', reporter: [['list'], ['json', { outputFile: 'reports/playwright-results.json' }]],
});
