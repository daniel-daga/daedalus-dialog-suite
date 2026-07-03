import { test, expect, type ElectronApplication } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { launchApp, seedProjectDir, stubOpenDialog, type AppFixture } from './harness';

/**
 * Real-Electron E2E spec #10 (fix-08 §2, deferred from slice-2 fix-02 E1/E5).
 * The mock harness cannot exercise a real OS window close; this suite drives the
 * actual `close` event so the full main<->renderer close-guard handshake runs
 * (main.ts:125-135 veto + `app:closeRequested`; useWindowCloseGuard.tsx ack /
 * dialog / save / cancel; main.ts:492-508 ack/approve/cancel + the 3 s
 * force-destroy timer).
 */

const NPC = 'SLD_99005_Arog';
const DIALOG = 'DIA_Arog_EntscheidungKillAlchemist';
// Distinctive ASCII substring of the fixture's first-line subtitle comment —
// the Text field renders DialogLine `text` (the //comment), not the AI_Output
// id (same technique as undo-redo-save.spec.ts).
const ORIGINAL_TEXT = 'Du hast ihn einfach umgebracht';
const SAVE_MARKER = 'DIA_Arog_CLOSEGUARD_SAVE_MARKER';

/** Fire the real OS window close (vetoed by the main-process guard). */
function triggerWindowClose(app: ElectronApplication): Promise<void> {
  return app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].close();
  });
}

test.describe('Window close guard (real OS close, disk truth)', () => {
  let fixture: AppFixture;
  let savedFile: string;

  test.beforeEach(async () => {
    const projectDir = seedProjectDir(['sample-dialog.d']);
    savedFile = path.join(projectDir, 'sample-dialog.d');
    fixture = await launchApp();
    await stubOpenDialog(fixture.app, [savedFile]);

    const { page } = fixture;
    await page.getByRole('button', { name: /Open Single File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 20000 });
    await page.getByText(NPC).click();
    await page.getByRole('button', { name: new RegExp(DIALOG) }).click();
    await expect(page.getByRole('heading', { name: DIALOG, exact: true })).toBeVisible();
    await expect(page.getByLabel('Text').first()).toHaveValue(new RegExp(ORIGINAL_TEXT));
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
  });

  async function makeDirty(): Promise<void> {
    const { page } = fixture;
    const appBar = page.getByRole('banner');
    const firstLine = page.getByLabel('Text').first();
    await firstLine.click();
    await firstLine.fill(SAVE_MARKER);
    await page.keyboard.press('Tab');
    // Wait for the edit to commit to the store/history (Undo enabled) so the
    // file is model-dirty when we close — still well within the 2 s auto-save
    // debounce, so auto-save cannot have cleaned it yet.
    await expect(async () => {
      await expect(appBar.getByRole('button', { name: 'Undo' })).toBeEnabled();
    }).toPass({ timeout: 10000 });
  }

  test('"Cancel" keeps the window open', async () => {
    const { app, page } = fixture;
    await makeDirty();
    await triggerWindowClose(app);

    await expect(page.getByTestId('close-guard-dialog')).toBeVisible();
    await page.getByTestId('close-guard-cancel').click();
    await expect(page.getByTestId('close-guard-dialog')).toBeHidden();

    // The window was not closed.
    expect(app.windows().length).toBe(1);
    expect(page.isClosed()).toBe(false);
  });

  test('"Save and close" writes to disk and closes the window', async () => {
    const { app, page } = fixture;
    await makeDirty();
    await triggerWindowClose(app);

    await expect(page.getByTestId('close-guard-dialog')).toBeVisible();
    await page.getByTestId('close-guard-save').click();

    // The guard's save wrote the edited bytes to disk before approving close.
    await expect(async () => {
      expect(fs.readFileSync(savedFile, 'latin1')).toContain(SAVE_MARKER);
    }).toPass({ timeout: 20000 });

    // The window actually closed.
    await expect.poll(() => app.windows().length, { timeout: 20000 }).toBe(0);
  });

  test('the 3 s force-destroy fires when the renderer never ACKs', async () => {
    const { app } = fixture;

    // Simulate a hung/crashed renderer by dropping the main-side ack/approve
    // handlers: the renderer still sends them, but main ignores them, so the
    // ACK safety timer is never cleared and never superseded by an approve.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeAllListeners('app:ackCloseRequest');
      ipcMain.removeAllListeners('app:approveClose');
    });

    await triggerWindowClose(app);

    // Still open shortly after the close request (the timer is 3 s).
    await new Promise((r) => setTimeout(r, 1000));
    expect(app.windows().length).toBe(1);

    // The force-destroy timer fires and the window is gone.
    await expect.poll(() => app.windows().length, { timeout: 8000 }).toBe(0);
  });

  // Atomic-write crash (E5): killing the write mid-flight deterministically from
  // Playwright is not achievable — `app.process().kill()` during an in-flight
  // save is inherently racy and there is no seam to pause between the temp-file
  // write and the atomic rename. The temp+fsync+rename mechanism is covered
  // deterministically by the Jest suites (tests/FileService.atomicWrite.test.ts,
  // FileService.conflictGuard.test.ts, FileService.encodingRoundtrip.test.ts).
  // Documented fixme rather than a flaky kill-timing test.
  test.fixme('atomic write keeps original bytes when killed mid-write', async () => {
    // Intentionally empty — see comment above; covered by Jest.
  });
});
