import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  launchApp,
  seedProjectDir,
  stubOpenDialog,
  reparse,
  type AppFixture,
} from './harness';

/**
 * Real-Electron E2E spec #2 (fix-08 §2). Open a real project folder via the
 * stubbed native dialog, let the real metadata workers populate the tree, edit
 * a dialog line, and let auto-save write to disk. Then read the bytes from the
 * test process and assert the edit is present and the file reparses cleanly
 * through the real parser package.
 */

const NPC = 'SLD_99005_Arog';
const DIALOG = 'DIA_Arog_EntscheidungKillAlchemist';
const EDIT_MARKER = 'E2E_PROJECT_EDIT_MARKER_A1B2C3';

test.describe('Open project -> edit -> save (disk truth)', () => {
  let fixture: AppFixture;
  let projectDir: string;

  test.beforeEach(async () => {
    projectDir = seedProjectDir(['sample-dialog.d']);
    fixture = await launchApp();
    await stubOpenDialog(fixture.app, [projectDir]);
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
  });

  test('project tree populates and an edited dialog line lands on disk', async () => {
    const { page } = fixture;
    const savedFile = path.join(projectDir, 'sample-dialog.d');

    // Open the project (real folder dialog is stubbed to return projectDir).
    await page.getByRole('button', { name: /Open Project/i }).first().click();

    // Tree populates from the real ProjectService metadata worker pool.
    await expect(page.getByText(NPC)).toBeVisible({ timeout: 20000 });
    await page.getByText(NPC).click();
    await page.getByRole('button', { name: new RegExp(DIALOG) }).click();
    await expect(page.getByRole('heading', { name: DIALOG, exact: true })).toBeVisible();

    // Edit the first dialog line's text and flush the debounced edit.
    const firstLine = page.getByLabel('Text').first();
    await expect(firstLine).toBeVisible();
    await firstLine.click();
    await firstLine.fill(EDIT_MARKER);
    await page.keyboard.press('Tab');

    // Auto-save (2 s debounce) writes real codegen to disk. Poll the bytes.
    await expect(async () => {
      const disk = fs.readFileSync(savedFile, 'latin1');
      expect(disk).toContain(EDIT_MARKER);
    }).toPass({ timeout: 20000 });

    // The saved bytes must reparse cleanly through the real parser package.
    const disk = fs.readFileSync(savedFile, 'latin1');
    const { hasErrors, model } = reparse(disk);
    expect(hasErrors).toBe(false);
    expect(Object.keys(model.dialogs)).toContain(DIALOG);
  });
});
