import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for the real-Electron E2E suite (fix-08 §2).
 *
 * Unlike playwright.config.ts (the browser mock harness), this suite launches
 * the actual packaged app via `_electron.launch` — real preload bridge, real
 * IPC, real native parser, real disk writes. It therefore has NO webServer and
 * requires the editor to be built first (`npm run build`): production `main.ts`
 * loads `dist/renderer/index.html` and Electron resolves `dist/main/main.js`.
 *
 * On Linux, Electron needs a display — run under `xvfb-run` (CI does this).
 */
export default defineConfig({
  testDir: './tests/e2e-electron',

  // Cold-launching Electron + building the native parser worker pool is slow on
  // CI runners; give each test generous headroom.
  timeout: 60 * 1000,
  expect: { timeout: 15 * 1000 },

  // Real windows and shared temp state — never run these in parallel.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  reporter: [['html', { outputFolder: 'playwright-report-electron', open: 'never' }]],
  outputDir: 'test-results-electron',

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
