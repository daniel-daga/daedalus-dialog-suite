import { test, expect } from '@playwright/test';
import { launchApp, readMainLog, type AppFixture } from './harness';

/**
 * Real-Electron E2E spec #9 (fix-08 §5). Force an uncaught renderer error;
 * `main.tsx`'s window.onerror forwards it over the `log:rendererError` IPC to
 * LogService, which appends it to `<userData>/logs/main.log`. Asserts the
 * forwarded entry reaches the main-process log file on disk.
 */

test.describe('Crash logging (renderer -> main log file)', () => {
  let fixture: AppFixture;

  test.beforeEach(async () => {
    fixture = await launchApp();
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
  });

  test('an uncaught renderer error is forwarded to the main log', async () => {
    const { page, userDataDir } = fixture;

    await page.evaluate(() =>
      setTimeout(() => {
        throw new Error('e2e-probe');
      }, 0)
    );

    await expect(async () => {
      const log = readMainLog(userDataDir);
      expect(log).toContain('e2e-probe');
      expect(log).toContain('[renderer]');
    }).toPass({ timeout: 15000 });
  });
});
