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
 * The write is detected via the file's mtime (not a content marker): every
 * fixture's first AI_Output line has no subtitle comment, so the UI's Text field
 * shows the id fallback and a text edit is invisible to codegen — EVERY write
 * this test can produce is expected to be byte-identical, which is exactly the
 * fidelity claim under test. (This also means the test must not poll for
 * changed content; a content poll on unchanged-content writes passes vacuously
 * before any write happens — the CI failure mode of the first version.)
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
  test.describe(`Save fidelity (no-edit / undo-to-clean, disk truth) — ${fixtureFile}`, () => {
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

    test('undo-to-clean auto-save writes bytes token-identical to the original', async () => {
      const { page } = fixture;
      const appBar = page.getByRole('banner');
      const firstLine = page.getByLabel('Text').first();
      await expect(firstLine).toHaveValue(expectedTextValue);

      // No write can have happened yet — the file was only opened (read).
      const mtimeBefore = fs.statSync(savedFile).mtimeMs;

      // Trivial edit, flushed into history (arms dirty state + undo).
      await firstLine.click();
      await firstLine.fill(EDIT_MARKER);
      await page.keyboard.press('Tab');
      await expect(async () => {
        await expect(appBar.getByRole('button', { name: 'Undo' })).toBeEnabled();
      }).toPass({ timeout: 10000 });

      // Undo back to the pristine model (still dirty, so auto-save will run).
      await page.keyboard.press('Control+z');
      await expect(firstLine).toHaveValue(expectedTextValue);

      // Auto-save (2 s debounce) serializes the model through the real codegen +
      // FileService write. Wait for the write to actually land (mtime change),
      // then assert the written bytes reproduce the original exactly (modulo
      // line-ending normalization, per Tier-1).
      await expect(async () => {
        expect(fs.statSync(savedFile).mtimeMs).not.toBe(mtimeBefore);
        const disk = fs.readFileSync(savedFile, 'latin1');
        expect(normalizeNewlines(disk)).toBe(normalizeNewlines(originalBytes));
      }).toPass({ timeout: 20000 });
    });
  });
}
