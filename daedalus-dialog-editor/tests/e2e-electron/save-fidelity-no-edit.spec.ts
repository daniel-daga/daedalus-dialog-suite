import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { launchApp, seedProjectDir, stubOpenDialog, type AppFixture } from './harness';

/**
 * Real-Electron E2E spec #3 (fix-08 §2). Fidelity of the editor save path: open
 * a fixture, drive it back to its pristine model, let auto-save write, and
 * assert the bytes on disk are token-identical to the original (fix-01 Tier-1).
 *
 * TRIGGER NOTE — "save with zero edits" is unreachable through the visual
 * editor UI: there is no manual Save button or Ctrl+S in the dialog view (the
 * SourceCodeEditor's Ctrl+S is unmounted, see save-pipeline.md), and auto-save
 * only fires on a dirty file. Per the plan this spec therefore uses the
 * sanctioned fallback — a trivial edit followed by an undo back to the pristine
 * snapshot — which leaves the file model-dirty (undo sets isDirty) with a model
 * reference-equal to the one produced by openFile. Auto-save then serializes
 * that pristine model: the effective "no-edit save".
 *
 * RATCHET — this asserts on a fixture that is already fidelity-clean through the
 * editor's DEFAULT code settings (`sectionHeaders: true`, `preserveSourceStyle:
 * true`), not merely through raw parse->generate. `save-fidelity.d` is the
 * `declaration-order` corpus fixture, verified byte-identical through the editor
 * codegen path. Not every corpus fixture qualifies: e.g. `comments.d` drops a
 * trailing inline comment on a non-AI_Output line under the editor path. Widen
 * this fixture set as **fix-01** closes those gaps (fix-01 owns the widener).
 */

const NPC = 'Some_NPC';
const DIALOG = 'DIA_Order';
const ORIGINAL_TEXT_ID = 'DIA_Order_15_00';
const EDIT_MARKER = 'DIA_Order_ZZZ_TEMP_MARKER';

const normalizeNewlines = (s: string): string => s.replace(/\r\n/g, '\n');

test.describe('Save fidelity (no-edit / undo-to-clean, disk truth)', () => {
  let fixture: AppFixture;
  let savedFile: string;
  let originalBytes: string;

  test.beforeEach(async () => {
    const projectDir = seedProjectDir(['save-fidelity.d']);
    savedFile = path.join(projectDir, 'save-fidelity.d');
    // Capture the pristine on-disk bytes before the app touches the file.
    originalBytes = fs.readFileSync(savedFile, 'latin1');

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

  test('undo-to-clean auto-save writes bytes token-identical to the original', async () => {
    const { page } = fixture;
    const appBar = page.getByRole('banner');
    const firstLine = page.getByLabel('Text').first();
    await expect(firstLine).toHaveValue(ORIGINAL_TEXT_ID);

    // Trivial edit, flushed into history.
    await firstLine.click();
    await firstLine.fill(EDIT_MARKER);
    await page.keyboard.press('Tab');
    await expect(async () => {
      await expect(appBar.getByRole('button', { name: 'Undo' })).toBeEnabled();
    }).toPass({ timeout: 10000 });

    // Undo back to the pristine model (still dirty, so auto-save will run).
    await page.keyboard.press('Control+z');
    await expect(firstLine).toHaveValue(ORIGINAL_TEXT_ID);

    // Auto-save serializes the pristine model. The write must reproduce the
    // original bytes exactly (modulo line-ending normalization, per Tier-1).
    await expect(async () => {
      const disk = fs.readFileSync(savedFile, 'latin1');
      expect(disk).not.toContain(EDIT_MARKER);
      expect(normalizeNewlines(disk)).toBe(normalizeNewlines(originalBytes));
    }).toPass({ timeout: 20000 });
  });
});
