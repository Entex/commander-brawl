import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: '*.spec.ts',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    launchOptions: {
      // Set CB_CHROMIUM to use an installed Chromium instead of Playwright's (npx playwright install chromium).
      executablePath: process.env.CB_CHROMIUM || undefined,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  webServer: {
    command: 'npx vite --config tests/browser/harness/vite.config.ts',
    cwd: root,
    url: 'http://localhost:5180',
    reuseExistingServer: !process.env.CI,
  },
});
