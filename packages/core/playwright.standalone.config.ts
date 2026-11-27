import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/standalone',
  workers: 1,
  forbidOnly: !!process.env.CI,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], offline: true } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], offline: true } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
