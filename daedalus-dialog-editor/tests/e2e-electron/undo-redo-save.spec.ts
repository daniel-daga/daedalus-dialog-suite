import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { launchApp, seedProjectDir, stubOpenDialog, type AppFixture } from './harness';

/**
 * Real-Electron E2E spec #5 (fix-08 §2). Edit a dialog line, undo, redo, and let
 * auto-save write to disk: the file reflects the REDONE state. Then undo back to
 * the original and let auto-save run again: the file reflects the original.
 * Both assertions read bytes directly from disk (real codegen, real write).
 */

const NPC = 'SLD_99005_Arog';
const DIALOG = 'DIA_Arog_EntscheidungKillAlchemist';
const REDO_MARKER = 'E2E_UNDO_REDO_MARKER_XYZ789';
// Distinctive ASCII substring of the original first-line comment in the fixture.
const ORIGINAL_MARKER = 'Du hast ihn einfach umgebracht';

test.describe('Undo / redo -> save (disk truth)', () => {
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
    await expect(page.getByLabel('Text').first()).toBeVisible();
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
  });

  test('redone edit is saved; undo-to-clean saves the original', async () => {
    const { page } = fixture;
    const appBar = page.getByRole('banner');
    const firstLine = page.getByLabel('Text').first();

    // Edit and flush into history.
    await firstLine.click();
    await firstLine.fill(REDO_MARKER);
    await page.keyboard.press('Tab');
    await expect(async () => {
      await expect(appBar.getByRole('button', { name: 'Undo' })).toBeEnabled();
    }).toPass({ timeout: 10000 });

    // Undo (back to original), then redo (back to the marker).
    await page.keyboard.press('Control+z');
    await expect(async () => {
      await expect(appBar.getByRole('button', { name: 'Redo' })).toBeEnabled();
    }).toPass({ timeout: 10000 });
    await page.keyboard.press('Control+y');
    await expect(firstLine).toHaveValue(REDO_MARKER);

    // Auto-save writes the redone state to disk.
    await expect(async () => {
      const disk = fs.readFileSync(savedFile, 'latin1');
      expect(disk).toContain(REDO_MARKER);
    }).toPass({ timeout: 20000 });

    // Undo back to the original and let auto-save run again.
    await page.keyboard.press('Control+z');
    await expect(firstLine).toHaveValue(new RegExp(ORIGINAL_MARKER));

    await expect(async () => {
      const disk = fs.readFileSync(savedFile, 'latin1');
      expect(disk).toContain(ORIGINAL_MARKER);
      expect(disk).not.toContain(REDO_MARKER);
    }).toPass({ timeout: 20000 });
  });
});
