import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run the real API (in-memory adapters, developer sign-in) and the production
 * web build. Mobile projects use browser emulation, which is NOT real-device testing.
 */
const API_PORT = 8787;
const WEB_PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } },
      testIgnore: /mobile\.spec/,
    },
    { name: 'mobile-emulated', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ },
  ],
  webServer: [
    {
      command: 'pnpm --filter @chat360/api exec tsx dev/server.ts',
      url: `http://localhost:${API_PORT}/api/health`,
      env: { PORT: String(API_PORT), APP_ORIGIN: `http://localhost:${WEB_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm exec vite build && pnpm exec vite preview --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}/login`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
