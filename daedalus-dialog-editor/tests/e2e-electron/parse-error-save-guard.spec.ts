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
 *  - UI surface: MainLayout.tsx renders a persistent "Opened with N parse
 *    error(s) — … will drop the content the parser could not read" banner
 *    (MainLayout.tsx:124-128).
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
    await expect(page.getByText(/Opened with \d+ parse error/i)).toBeVisible({
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
});
