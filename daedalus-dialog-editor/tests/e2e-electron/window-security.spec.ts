import { test, expect } from '@playwright/test';
import { launchApp, type AppFixture } from './harness';

/**
 * Real-Electron E2E spec #8 (fix-08 §2, delegated by fix-06 §3). In the real
 * app, `window.open` is denied by the window-open handler and `will-navigate`
 * to an external URL is blocked (see src/main/windowSecurity.ts). Asserts the
 * deny-by-default behavior end to end.
 */

test.describe('Window security (deny by default)', () => {
  let fixture: AppFixture;

  test.beforeEach(async () => {
    fixture = await launchApp();
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
  });

  test('window.open is denied', async () => {
    const { page } = fixture;
    // setWindowOpenHandler({ action: 'deny' }) makes window.open return null.
    const opened = await page.evaluate(() => window.open('https://example.com/', '_blank'));
    expect(opened).toBeNull();
  });

  test('navigation to an external URL is blocked', async () => {
    const { page } = fixture;
    const before = page.url();
    expect(before).toContain('index.html');

    await page.evaluate(() => {
      window.location.href = 'https://example.com/';
    });

    // Give the (prevented) navigation a moment to NOT happen, then confirm the
    // app never left its own page.
    await page.waitForTimeout(1000);
    expect(page.url()).toBe(before);
    // The aborted navigation leaves Playwright's frame bookkeeping "waiting
    // for navigation to finish", so locator auto-waiting would hang here —
    // assert on the live DOM directly instead (CI run 28659971523).
    const welcomeVisible = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).some((h) =>
        (h.textContent ?? '').includes('Welcome to Dandelion')
      )
    );
    expect(welcomeVisible).toBe(true);
  });
});
