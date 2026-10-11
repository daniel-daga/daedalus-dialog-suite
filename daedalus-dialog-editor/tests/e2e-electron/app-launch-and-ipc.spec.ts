import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { launchApp, seedProjectDir, stubOpenDialog, type AppFixture } from './harness';

/**
 * Real-Electron E2E spec #1 (fix-08 §2). Replaces the meaning of the old 8 s
 * "did it not exit" smoke: proves the window renders, the REAL preload bridge
 * is present (not the mock), and a parseSource IPC round-trip reaches the real
 * native parser and returns a semantic model.
 */

const EDITOR_PKG_VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8')
).version as string;

const SAMPLE_SOURCE = `INSTANCE DIA_Probe(C_INFO)
{
\tnpc = PC_Hero;
\tnr = 1;
\tcondition = DIA_Probe_Condition;
\tinformation = DIA_Probe_Info;
};

FUNC INT DIA_Probe_Condition()
{
};

FUNC VOID DIA_Probe_Info()
{
\tAI_Output(self, other, "DIA_Probe_15_00");
};
`;

test.describe('App launch + real IPC', () => {
  let fixture: AppFixture;

  test.beforeEach(async () => {
    fixture = await launchApp();
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
  });

  test('window opens and the document title renders', async () => {
    const { page } = fixture;
    await expect(page).toHaveTitle('Dandelion');
    await expect(page.getByRole('heading', { name: 'Welcome to Dandelion' })).toBeVisible();
  });

  test('window.editorAPI is the real preload bridge, not the mock', async () => {
    const { page } = fixture;

    // The mock reports '0.0.0-mock'; the real bridge returns app.getVersion(),
    // which reads the app's package.json version.
    const version = await page.evaluate(() => window.editorAPI.getAppVersion());
    expect(version).not.toBe('0.0.0-mock');
    expect(version).toBe(EDITOR_PKG_VERSION);
  });

  test('parseSource IPC round-trips through the real native parser', async () => {
    const { page } = fixture;

    const model = await page.evaluate(
      (source) => window.editorAPI.parseSource(source),
      SAMPLE_SOURCE
    );

    expect(model).toBeTruthy();
    expect(model.hasErrors).toBeFalsy();
    expect(Object.keys(model.dialogs)).toContain('DIA_Probe');
  });

  // Code review remediation item 1.1: `settings:addRecentProject` let a
  // renderer-supplied path be whitelisted and persisted into recents without
  // any validation — a compromised renderer could whitelist e.g. `C:\` and
  // read/write anywhere via file:read/file:write. The channel is removed
  // entirely; recents are now persisted main-side only.
  test('settings:addRecentProject IPC channel no longer exists', async () => {
    const { app } = fixture;

    // No production or preload code can invoke a removed channel directly (the
    // renderer only ever sees the preload-exposed surface). Prove the main
    // process has no handler registered for it by attempting to register a
    // probe handler on the same channel name: `ipcMain.handle` throws
    // "Attempted to register a second handler" if one is already registered.
    const slotWasFree = await app.evaluate(({ ipcMain }) => {
      try {
        ipcMain.handle('settings:addRecentProject', () => undefined);
        ipcMain.removeHandler('settings:addRecentProject');
        return true;
      } catch {
        return false;
      }
    });

    expect(slotWasFree).toBe(true);
  });

  test('opening a project folder persists it as a recent project (main-side)', async () => {
    const { app, page } = fixture;
    const projectDir = seedProjectDir([]);
    await stubOpenDialog(app, [projectDir]);

    const before = await page.evaluate(() => window.editorAPI.getRecentProjects());
    expect(before.some((p) => p.path === projectDir)).toBe(false);

    const opened = await page.evaluate(() => window.editorAPI.openProjectFolderDialog());
    expect(opened).toBe(projectDir);

    const after = await page.evaluate(() => window.editorAPI.getRecentProjects());
    expect(after.some((p) => p.path === projectDir)).toBe(true);
  });

  // Code review remediation item 1.2: `fileWatcher:start` was the only
  // path-accepting handler with no PathValidationService check, so a
  // compromised renderer could point the watcher at an arbitrary directory.
  test('fileWatcher:start rejects a directory that was never opened as a project', async () => {
    const { page } = fixture;
    const neverOpenedDir = seedProjectDir([]);

    await expect(
      page.evaluate((dir) => window.editorAPI.startFileWatcher(dir), neverOpenedDir)
    ).rejects.toThrow();
  });
});
