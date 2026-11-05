import { chromium, type FullConfig } from '@playwright/test';

/**
 * Load the app once before any worker starts (#524).
 *
 * Every spec opens with a page load, and the first page served by a cold Vite
 * server pays the whole one-time module-transform bill — around 8 s here — out
 * of its 30 s test budget. Locally `workers: undefined` runs 12 of those pages
 * at once, so every test paid it concurrently: the first run in a checkout put
 * all 12 world-surface tests in a 22-30 s band and timed one out, while warm
 * runs sat at 6-15 s. Paying it here, with no test timeout, leaves each test
 * the warm page it expects. It also moves a cold CI runner's cost into setup.
 */
export default async function warmUpApp(config: FullConfig): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(config.projects[0]?.use?.baseURL ?? 'http://localhost:5173');
    // The signal every spec opens with, so "ready" means ready for them.
    await page.getByText('Welcome to Dandelion').waitFor();
  } finally {
    await browser.close();
  }
}
