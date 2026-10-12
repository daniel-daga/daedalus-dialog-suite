import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the browser mock-harness UI suite.
 *
 * This is NOT end-to-end: it never launches Electron. It runs the renderer in
 * plain Chromium against the mock API (mock parser/codegen, localStorage-backed
 * fake main process) for fast, isolated UI-flow testing. The word "E2E" is
 * reserved for the real-Electron suite (tests/e2e-electron/). See
 * tests/e2e/README.md for the harness contract.
 */
export default defineConfig({
  testDir: './tests/e2e',

  // Maximum time one test can run
  timeout: 30 * 1000,

  // Default timeout for expect() assertions (raised from 5 s to handle slow CI runners)
  expect: { timeout: 10 * 1000 },
  // Test execution settings
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries, so a flake fails the run instead of passing on a second try;
  // two workers on CI's 4-core runner. Three CI runs at 2 workers had no
  // failure and took 1.3-1.9 min a shard against 1.9-2.4 at one (#359).
  retries: 0,
  workers: process.env.CI ? 2 : undefined,

  // Reporter to use
  reporter: 'html',

  use: {
    // Base URL for the dev server
    baseURL: 'http://localhost:5173',

    // Keep the trace of a failed test (there is no retry to record one on)
    trace: 'retain-on-failure',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Run dev server before starting tests
  webServer: {
    command: 'npm run dev:browser',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
