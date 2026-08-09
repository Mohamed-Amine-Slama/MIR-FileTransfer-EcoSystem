import { defineConfig, devices } from '@playwright/test';

const PORT = 3001;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,

  // A test that only passes locally is not a gate. Fail the build if someone
  // commits `test.only`.
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Libyan clinic staff and patients are overwhelmingly on mobile. The
    // upload and booking flows must be exercised at this viewport, not only at
    // desktop width.
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],

  webServer: {
    command: 'pnpm build && pnpm start',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    // The Next build is slow on a cold cache, and slower still when the repo
    // lives on a Windows drive mount under WSL.
    timeout: 300_000,
  },
});
