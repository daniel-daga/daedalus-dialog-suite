import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { launchApp, seedProjectDir, stubOpenDialog, type AppFixture } from './harness';

/**
 * Real-Electron E2E spec #7 (fix-08 §2). A file that fails to parse opens as a
 * partial model (`hasErrors`, empty dialogs — the semantic passes are skipped,
 * see parser.worker.ts). The app must NOT overwrite it with generated-from-
 * partial-model output, and must surface the error in the UI.
 *
 * Behaviour verified in source:
 *  - UI surface: the blocked file view names the parse errors and offers
 *    external editing and reload, without a second partial-model warning.
 *  - Auto-save gate (E3): `isAutoSaveCandidate` excludes `hasErrors` models
 *    (useAutoSave.ts:17-24) — the file is never auto-written.
 *  - Save-path guard (fix-01 P7 + slice-2 E3): the save IPC validates first and,
 *    for a `hasErrors` model without `forceOnErrors`, returns
 *    `{ success: false, validationResult }` with a `syntax_error` and writes
 *    nothing (ValidationService.validate:173-179, main.ts generator:saveFile).
 */

const DEFAULT_SETTINGS = {
  indentChar: '\t' as const,
  includeComments: true,
  sectionHeaders: true,
  uppercaseKeywords: true,
};

test.describe('Parse-error save guard (disk truth)', () => {
  let fixture: AppFixture;
  let savedFile: string;
  let originalBytes: string;

  test.beforeEach(async () => {
    const projectDir = seedProjectDir(['parse-error.d']);
    savedFile = path.join(projectDir, 'parse-error.d');
    originalBytes = fs.readFileSync(savedFile, 'latin1');

    fixture = await launchApp();
    await stubOpenDialog(fixture.app, [savedFile]);
    await fixture.page.getByRole('button', { name: /Open Single File/i }).click();
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
  });

  test('the parse error is surfaced and the file is never overwritten', async () => {
    const { page } = fixture;

    // Error surfaced in the UI.
    await expect(page.getByRole('heading', { name: /Parse errors \(\d+\)/i })).toBeVisible({
      timeout: 20000,
    });

    // Auto-save is gated off a parse-errored model: wait past the 2 s debounce
    // and confirm the bytes on disk are still the original (bounded negative).
    await page.waitForTimeout(4000);
    expect(fs.readFileSync(savedFile, 'latin1')).toBe(originalBytes);

    // The save IPC itself refuses the partial model (no forced consent): it
    // returns a syntax_error validation result and writes nothing.
    const model = await page.evaluate(
      (src) => window.editorAPI.parseSource(src),
      originalBytes
    );
    expect(model.hasErrors).toBeTruthy();

    const result = await page.evaluate(
      ({ p, m, s }) => window.editorAPI.saveFile(p, m, s),
      { p: savedFile, m: model, s: DEFAULT_SETTINGS }
    );
    expect(result.success).toBe(false);
    expect(result.validationResult?.isValid).toBe(false);
    expect(result.validationResult?.errors.some((e) => e.type === 'syntax_error')).toBe(true);

    // Disk is still byte-identical to the original after the refused save.
    expect(fs.readFileSync(savedFile, 'latin1')).toBe(originalBytes);
  });

  test('external editing crosses preload and IPC, then reload reads the repaired file', async () => {
    const { page, app } = fixture;
    await expect(page.getByRole('button', { name: 'Edit externally' })).toBeVisible();
    // Do not launch the user's associated application during an automated test.
    await app.evaluate(({ shell }) => {
      shell.openPath = async (filePath) => {
        process.env.TEST_EXTERNAL_SCRIPT = filePath;
        return '';
      };
    });
    await page.getByRole('button', { name: 'Edit externally' }).click();
    // Native realpath expands Windows 8.3 aliases in both the runner and Electron paths.
    await expect.poll(async () => {
      const opened = await app.evaluate(() => process.env.TEST_EXTERNAL_SCRIPT);
      return opened ? fs.realpathSync.native(opened) : undefined;
    }).toBe(fs.realpathSync.native(savedFile));
    expect(fs.readFileSync(savedFile, 'latin1')).toBe(originalBytes);
    fs.writeFileSync(savedFile, 'FUNC VOID Repaired() {};', 'latin1');
    await page.getByRole('button', { name: 'Reload file', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Parse errors \(\d+\)/i })).toBeHidden();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible();
  });
});
