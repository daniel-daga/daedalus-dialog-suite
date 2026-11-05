import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { launchApp, seedProjectDir, stubOpenDialog, type AppFixture } from './harness';

/**
 * Real-Electron E2E spec #3 (fix-08 §2). Fidelity of the editor save path: open
 * a fixture, edit the first dialog line's subtitle, let auto-save write, and
 * assert the bytes on disk are the original with exactly that subtitle appended
 * as a `//` comment — nothing else moved (fix-01 Tier-1, #514). The second case
 * pins the other half of the same rule: undoing back to the pristine model
 * writes nothing at all.
 *
 * TRIGGER NOTE — "save with zero edits" is unreachable through the visual
 * editor UI: manual save (Ctrl+S / the app-bar Save button) is a no-op on a
 * clean file, and auto-save only fires on a dirty file. This spec used to reach
 * it as "a trivial edit, then an undo back to the pristine snapshot", which
 * relied on undo leaving the file model-dirty. Undo no longer does — a model
 * reference-equal to the one on disk is clean (`FileState.savedModel`) — so the
 * edit itself is the trigger, and the undo case asserts the absence of a write.
 *
 * The edit is the one the UI can commit without touching another field: every
 * fixture's first AI_Output line carries no `//` comment, so the Text field
 * shows the id fallback and typing a subtitle changes only `DialogLine.text`.
 * #514 made that text the single token the save path adds — it used to be
 * dropped when the source had no inline comment. Every other byte must come
 * back untouched. The write is detected via mtime, not by polling content (a
 * content poll passes vacuously before any write lands — the CI failure mode of
 * the first version).
 *
 * RATCHET — each row asserts on a fixture that is byte-identical through the
 * editor's DEFAULT code settings (`sectionHeaders: true`, `preserveSourceStyle:
 * true`), not merely raw parse->generate. The set of qualifying fixtures is
 * locked by the Jest ratchet `tests/saveFidelityCorpus.test.ts` (GREEN list);
 * this spec covers the subset that is ALSO drivable through this UI flow — i.e.
 * has an NPC entry and a dialog whose first AI_Output line is editable/undoable.
 *
 * The widener (fix-08 §2 #3) has run: `save-fidelity.d` is the `declaration-order`
 * corpus fixture; `case-drift.d` is the same-named corpus fixture. Both are
 * editor-path byte-green and UI-drivable. Corpus fixtures that are byte-green but
 * NOT UI-drivable — globals-only files (`globals.d`, `encoding-1252.d`) and
 * function-only files (`arity-variants.d`, `numeric-args.d`), which have no NPC
 * or dialog — are covered by the Jest ratchet only. Fixtures still in the Jest
 * KNOWN_GAP list (`class-prototype`, `comments`, `condition-idioms`,
 * `items-npcs-mds`, `quoting`) are not byte-green through the editor path yet and
 * are excluded here until fix-01 closes those parser/codegen gaps.
 *
 * Each per-fixture constant is derived from the fixture's content: `npc` is the
 * C_INFO `npc = ...` value, `dialog` is the instance name (rendered verbatim as
 * the detail heading and the tree button), and `expectedTextValue` is the
 * AI_Output id (no subtitle comment on the line -> DialogLine.text falls back to
 * the id, which is what the Text field renders — DialogLineRenderer binds `text`).
 */

interface FidelityFixture {
  fixtureFile: string;
  npc: string;
  dialog: string;
  expectedTextValue: string;
}

const FIXTURES: FidelityFixture[] = [
  // declaration-order corpus fixture (kept as save-fidelity.d for continuity).
  { fixtureFile: 'save-fidelity.d', npc: 'Some_NPC', dialog: 'DIA_Order', expectedTextValue: 'DIA_Order_15_00' },
  // case-drift corpus fixture: lowercase instance name exercises the tree/heading
  // rendering the raw name verbatim.
  { fixtureFile: 'case-drift.d', npc: 'Some_NPC', dialog: 'dia_case', expectedTextValue: 'DIA_Case_15_00' },
];

const EDIT_MARKER = 'ZZZ_TEMP_MARKER';
const normalizeNewlines = (s: string): string => s.replace(/\r\n/g, '\n');

for (const { fixtureFile, npc, dialog, expectedTextValue } of FIXTURES) {
  test.describe(`Save fidelity (edit through codegen, disk truth) — ${fixtureFile}`, () => {
    let fixture: AppFixture;
    let savedFile: string;
    let originalBytes: string;

    test.beforeEach(async () => {
      const projectDir = seedProjectDir([fixtureFile]);
      savedFile = path.join(projectDir, fixtureFile);
      // Capture the pristine on-disk bytes before the app touches the file.
      originalBytes = fs.readFileSync(savedFile, 'latin1');

      fixture = await launchApp();
      await stubOpenDialog(fixture.app, [savedFile]);

      const { page } = fixture;
      await page.getByRole('button', { name: /Open Single File/i }).click();
      await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 20000 });
      await page.getByText(npc).click();
      await page.getByRole('button', { name: new RegExp(dialog) }).click();
      await expect(page.getByRole('heading', { name: dialog, exact: true })).toBeVisible();
      await expect(page.getByLabel('Text').first()).toBeVisible();
    });

    test.afterEach(async () => {
      await fixture?.cleanup();
    });

    /** Edit the first line's subtitle and commit it. */
    const editFirstLine = async () => {
      const { page } = fixture;
      const firstLine = page.getByLabel('Text').first();
      await firstLine.click();
      await firstLine.fill(EDIT_MARKER);
      await page.keyboard.press('Tab');
      await expect(async () => {
        await expect(page.getByRole('banner').getByRole('button', { name: 'Undo' })).toBeEnabled();
      }).toPass({ timeout: 10000 });
    };

    /** The one byte change the save path is allowed to make (see the header). */
    const withEditedSubtitle = (): string =>
      originalBytes.replace(
        `AI_Output (self, other, "${expectedTextValue}");`,
        `AI_Output (self, other, "${expectedTextValue}"); //${EDIT_MARKER}`
      );

    test('an auto-save of the edited model writes the source plus that one subtitle', async () => {
      const firstLine = fixture.page.getByLabel('Text').first();
      await expect(firstLine).toHaveValue(expectedTextValue);

      // No write can have happened yet — the file was only opened (read).
      const mtimeBefore = fs.statSync(savedFile).mtimeMs;
      const expectedBytes = withEditedSubtitle();
      expect(expectedBytes).not.toBe(originalBytes);

      await editFirstLine();

      // Auto-save (2 s debounce) serializes the model through the real codegen +
      // FileService write. Wait for the write to actually land (mtime change),
      // then assert the written bytes are the original with the new subtitle and
      // nothing else (modulo line-ending normalization, per Tier-1).
      await expect(async () => {
        expect(fs.statSync(savedFile).mtimeMs).not.toBe(mtimeBefore);
        const disk = fs.readFileSync(savedFile, 'latin1');
        expect(normalizeNewlines(disk)).toBe(normalizeNewlines(expectedBytes));
      }).toPass({ timeout: 20000 });
    });

    test('undoing back to the pristine model writes nothing', async () => {
      const { page } = fixture;
      const firstLine = page.getByLabel('Text').first();
      await expect(firstLine).toHaveValue(expectedTextValue);
      const mtimeBefore = fs.statSync(savedFile).mtimeMs;

      await editFirstLine();

      // Undo returns the model to the one that came off disk, so the file is
      // clean again and auto-save has nothing to write.
      await page.keyboard.press('Control+z');
      await expect(firstLine).toHaveValue(expectedTextValue);

      // Past the 2 s auto-save debounce with room to spare.
      await page.waitForTimeout(3500);

      expect(fs.statSync(savedFile).mtimeMs).toBe(mtimeBefore);
      expect(normalizeNewlines(fs.readFileSync(savedFile, 'latin1')))
        .toBe(normalizeNewlines(originalBytes));
    });
  });
}
