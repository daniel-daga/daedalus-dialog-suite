import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { launchApp, seedProjectDir, stubOpenDialog, type AppFixture } from './harness';

/**
 * Real-Electron E2E spec #6 (fix-08 §2). Exercises the REAL chokidar watcher end
 * to end (project mode starts it), covering the slice-2 E4 contract from
 * save-pipeline.md:
 *
 *  - Clean open file changed on disk -> `reloadFile` updates the UI in place.
 *  - Dirty open file changed on disk -> `markExternalConflict` + the conflict
 *    dialog (no silent clobber). Either the watcher path or the main-side mtime
 *    write precondition raises the conflict; both are asserted via the dialog.
 *
 * NOTE: the UI's Text field renders the DialogLine `text` — the human-readable
 * subtitle comment, not the AI_Output id (DialogLineRenderer binds `text`).
 */

const NPC = 'SLD_99005_Arog';
const DIALOG = 'DIA_Arog_EntscheidungKillAlchemist';
// Distinctive ASCII substring of the fixture's first-line subtitle comment
// (same technique as undo-redo-save.spec.ts).
const ORIGINAL_TEXT = 'Du hast ihn einfach umgebracht';
const RELOAD_MARKER = 'RELOAD_MARKER_FROM_DISK';

// A parseable replacement keeping the same NPC / dialog / function names so the
// currently-selected dialog stays mounted; only the first line's subtitle
// comment (the Text field's content) changes.
function externalContent(firstLineComment: string): string {
  return [
    `INSTANCE ${DIALOG}(C_INFO)`,
    '{',
    `\tnpc = ${NPC};`,
    '\tnr = 2;',
    `\tcondition = ${DIALOG}_Condition;`,
    `\tinformation = ${DIALOG}_Info;`,
    '\timportant = TRUE;',
    '};',
    '',
    `FUNC INT ${DIALOG}_Condition()`,
    '{',
    '};',
    '',
    `FUNC VOID ${DIALOG}_Info()`,
    '{',
    `\tAI_Output(self, other, "${DIALOG}_15_6"); //${firstLineComment}`,
    '};',
    '',
  ].join('\n');
}

async function openProjectDialog(fixture: AppFixture, projectDir: string): Promise<void> {
  const { app, page } = fixture;
  await stubOpenDialog(app, [projectDir]);
  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await expect(page.getByText(NPC)).toBeVisible({ timeout: 20000 });
  await page.getByText(NPC).click();
  await page.getByRole('button', { name: new RegExp(DIALOG) }).click();
  await expect(page.getByRole('heading', { name: DIALOG, exact: true })).toBeVisible();
  await expect(page.getByLabel('Text').first()).toHaveValue(new RegExp(ORIGINAL_TEXT));
}

test.describe('External change -> reload / conflict (real watcher, disk truth)', () => {
  let fixture: AppFixture;
  let projectDir: string;
  let savedFile: string;

  test.beforeEach(async () => {
    projectDir = seedProjectDir(['sample-dialog.d']);
    savedFile = path.join(projectDir, 'sample-dialog.d');
    fixture = await launchApp();
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
  });

  test('a clean open file is reloaded in place when it changes on disk', async () => {
    const { page } = fixture;
    await openProjectDialog(fixture, projectDir);

    // Modify the file from the test process (genuine external change — the
    // editor never called notifySelfWrite for it).
    fs.writeFileSync(savedFile, externalContent(RELOAD_MARKER), 'latin1');

    // The real chokidar watcher (awaitWriteFinish debounce) fires; the clean
    // file reloads in place. Poll the visible Text field for the new value.
    await expect(page.getByLabel('Text').first()).toHaveValue(RELOAD_MARKER, {
      timeout: 25000,
    });
  });

  test('a dirty open file changed on disk raises a conflict (no silent clobber)', async () => {
    const { page } = fixture;
    await openProjectDialog(fixture, projectDir);

    // Make an unsaved edit so the file is dirty, then immediately change it on
    // disk (well within the 2 s auto-save debounce). Either the watcher marks
    // the conflict directly, or the auto-save write is rejected by the mtime
    // precondition and routed to the same conflict — both surface the dialog.
    const firstLine = page.getByLabel('Text').first();
    await firstLine.click();
    await firstLine.fill('DIA_Arog_DIRTY_EDIT_MARKER');
    await page.keyboard.press('Tab');
    fs.writeFileSync(savedFile, externalContent('External edit while dirty'), 'latin1');

    await expect(page.getByTestId('external-conflict-dialog')).toBeVisible({ timeout: 25000 });
    await expect(page.getByTestId('external-conflict-keep-mine')).toBeVisible();
    await expect(page.getByTestId('external-conflict-reload')).toBeVisible();

    // Nothing was silently overwritten: the user's edit is still in the editor.
    await expect(firstLine).toHaveValue('DIA_Arog_DIRTY_EDIT_MARKER');
  });
});
