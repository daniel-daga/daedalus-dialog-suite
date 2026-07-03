import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { launchApp, seedProjectDir, stubOpenDialog, type AppFixture } from './harness';

/**
 * Real-Electron E2E spec #4 (fix-08 §2). Guards the slice-2 E6 encoding write
 * policy: a windows-1252-encoded fixture with umlauts is opened, a dialog line
 * is edited (typed text includes umlauts), and auto-save writes back. The
 * umlauts — both a pre-existing subtitle comment (line 2, untouched) and the
 * freshly typed text (line 1) — must survive on disk byte-for-byte in
 * windows-1252, never re-encoded as UTF-8.
 *
 * The UI's Text field renders the DialogLine `text` — the subtitle comment
 * (DialogLineRenderer binds `text`, which the parser fills from the //comment).
 * Editing it REPLACES line 1's comment, which is why the untouched umlaut
 * comment being preserved is asserted on line 2.
 *
 * The fixture `dialog-1252.d` holds real cp1252 bytes (0xF6 ö, 0xFC ü, 0xDF ß,
 * 0xC4 Ä, 0xD6 Ö, 0xDC Ü). FileService detects it (chardet) as an 8-bit Latin
 * encoding and caches it; for these code points cp1252 and ISO-8859-1 are
 * byte-identical, so the round-trip is lossless either way. The distinguishing
 * check below is the absence of 0xC3 (the UTF-8 lead byte these umlauts would
 * carry if the file were mistakenly written as UTF-8).
 */

const NPC = 'PC_Umlaut_NPC';
const DIALOG = 'DIA_Umlaut_Greet';
// Line 1's subtitle comment (what the first Text field shows).
const LINE1_ORIGINAL_TEXT = 'Willkommen, Fremder. Über Änderungen später.';
// Line 2's subtitle comment — untouched by the edit; must survive the save.
const LINE2_UMLAUT_COMMENT = 'Schöne Grüße, Söldner!';
// Typed replacement text containing umlauts (ß, ü, Ö, Ä, Ü).
const TYPED_MARKER = 'TESTMARKER_Straße_Grün_ÖÄÜ';

test.describe('Encoding roundtrip (windows-1252 umlauts, disk truth)', () => {
  let fixture: AppFixture;
  let savedFile: string;

  test.beforeEach(async () => {
    const projectDir = seedProjectDir(['dialog-1252.d']);
    savedFile = path.join(projectDir, 'dialog-1252.d');
    fixture = await launchApp();
    await stubOpenDialog(fixture.app, [savedFile]);

    const { page } = fixture;
    await page.getByRole('button', { name: /Open Single File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 20000 });
    await page.getByText(NPC).click();
    await page.getByRole('button', { name: new RegExp(DIALOG) }).click();
    await expect(page.getByRole('heading', { name: DIALOG, exact: true })).toBeVisible();
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
  });

  test('umlauts survive an edit + save byte-for-byte in windows-1252', async () => {
    const { page } = fixture;
    const firstLine = page.getByLabel('Text').first();
    await expect(firstLine).toHaveValue(LINE1_ORIGINAL_TEXT);

    await firstLine.click();
    await firstLine.fill(TYPED_MARKER);
    await page.keyboard.press('Tab');

    // Auto-save writes real codegen through the E6 encoding policy. Poll disk.
    await expect(async () => {
      // Bytes 0xA0-0xFF are identical between latin1 and windows-1252, so a
      // latin1 decode reproduces these umlauts exactly.
      const disk = fs.readFileSync(savedFile, 'latin1');
      expect(disk).toContain(TYPED_MARKER);
      expect(disk).toContain(LINE2_UMLAUT_COMMENT);
    }).toPass({ timeout: 20000 });

    // Raw-byte proof it was written as windows-1252, not UTF-8: the cp1252
    // umlaut bytes are present and no UTF-8 lead byte (0xC3) appears.
    const buf = fs.readFileSync(savedFile);
    expect(buf.includes(0xfc)).toBe(true); // ü (Grün / Grüße)
    expect(buf.includes(0xdf)).toBe(true); // ß (Straße / Grüße)
    expect(buf.includes(0xf6)).toBe(true); // ö (Schöne / Söldner)
    expect(buf.includes(0xc3)).toBe(false); // no UTF-8 multibyte lead

    // The bytes must still reparse cleanly through the real parser package.
    const disk = fs.readFileSync(savedFile, 'latin1');
    const model = await page.evaluate((src) => window.editorAPI.parseSource(src), disk);
    expect(model.hasErrors).toBeFalsy();
    expect(Object.keys(model.dialogs)).toContain(DIALOG);
  });
});
