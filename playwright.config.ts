import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  webServer: {
    command: 'node fixtures/serve.mjs',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
  },
});
