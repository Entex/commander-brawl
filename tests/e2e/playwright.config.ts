import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: '*.spec.ts',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
});
