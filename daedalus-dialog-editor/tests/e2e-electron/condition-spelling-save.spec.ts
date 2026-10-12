import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { launchApp, seedProjectDir, stubOpenDialog, reparse, type AppFixture } from './harness';

/**
 * Disk truth for a condition's spelling through the real editor (#395). The MDK
 * writes guards the condition rows cannot spell back — parenthesised clauses,
 * `== FALSE`, a space before the call's parenthesis. Saving must keep them:
 * untouched when another part of the dialog is edited, and, when one condition
 * is edited in the condition editor, rewritten in that clause alone.
 */

const FILE = 'DIA_Albert.d';
const GUARD = `\tif (Npc_IsDead(Engardo) == FALSE)
\t&& (Npc_KnowsInfo (other, DIA_Albert_Hallo1))
\t{
\t\treturn TRUE;
\t};`;

const SOURCE = `INSTANCE DIA_Albert_Hallo1(C_INFO)
{
\tnpc = VLK_99107_Albert;
\tnr = 1;
\tcondition = DIA_Albert_Hallo1_Condition;
\tinformation = DIA_Albert_Hallo1_Info;
};

FUNC INT DIA_Albert_Hallo1_Condition()
{
\treturn TRUE;
};

FUNC VOID DIA_Albert_Hallo1_Info()
{
\tAI_Output (self, other, "DIA_Albert_Hallo1_15_00"); //Hallo.
};

INSTANCE DIA_Albert_Hallo3(C_INFO)
{
\tnpc = VLK_99107_Albert;
\tnr = 3;
\tcondition = DIA_Albert_Hallo3_Condition;
\tinformation = DIA_Albert_Hallo3_Info;
};

FUNC INT DIA_Albert_Hallo3_Condition()
{
${GUARD}
};

FUNC VOID DIA_Albert_Hallo3_Info()
{
\tAI_Output (self, other, "DIA_Albert_Hallo3_15_00"); //Wieder da?
};
`;

const normalizeNewlines = (s: string): string => s.replace(/\r\n/g, '\n');
const readDisk = (file: string): string => normalizeNewlines(fs.readFileSync(file, 'latin1'));

test.describe('Condition spelling survives a save (disk truth, #395)', () => {
  let fixture: AppFixture;
  let savedFile: string;

  test.beforeEach(async () => {
    const projectDir = seedProjectDir([]);
    savedFile = path.join(projectDir, FILE);
    fs.writeFileSync(savedFile, SOURCE, 'latin1');

    fixture = await launchApp();
    await stubOpenDialog(fixture.app, [projectDir]);
    const { page } = fixture;
    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await expect(page.getByText('VLK_99107_Albert')).toBeVisible({ timeout: 20000 });
    await page.getByText('VLK_99107_Albert').click();
    await page.getByRole('button', { name: /DIA_Albert_Hallo3/ }).click();
    await expect(page.getByRole('heading', { name: 'DIA_Albert_Hallo3', exact: true })).toBeVisible();
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
  });

  test('editing a line elsewhere in the dialog leaves the guard as written', async () => {
    const { page } = fixture;
    const line = page.getByLabel('Text').first();
    await expect(line).toHaveValue('Wieder da?');
    await line.fill('Wieder hier?');
    await page.keyboard.press('Tab');

    await expect(async () => {
      expect(readDisk(savedFile)).toContain('//Wieder hier?');
    }).toPass({ timeout: 20000 });
    expect(readDisk(savedFile)).toContain(GUARD);
  });

  test('negating one condition rewrites that clause and keeps the other as written', async () => {
    const { page } = fixture;
    await page.getByRole('button', { name: 'Expand conditions' }).click();
    await expect(page.locator('.MuiChip-label', { hasText: /^NPC Knows Dialog$/ })).toBeVisible();
    // Cards follow clause order: `Npc_IsDead(...) == FALSE` reads as a negated
    // Is Dead (on), then the Knows Dialog this test negates (off).
    const notSwitches = page.getByRole('checkbox', { name: 'NOT' });
    await expect(notSwitches).toHaveCount(2);
    await expect(notSwitches.nth(0)).toBeChecked();
    await expect(notSwitches.nth(1)).not.toBeChecked();
    await notSwitches.nth(1).check();
    await expect(page.locator('.MuiChip-label', { hasText: /^NPC Does Not Know Dialog$/ })).toBeVisible();

    await expect(async () => {
      expect(readDisk(savedFile)).toMatch(/\(!Npc_KnowsInfo ?\(other, DIA_Albert_Hallo1\)\)/);
    }).toPass({ timeout: 20000 });
    const disk = readDisk(savedFile);
    expect(disk).toContain('\tif (Npc_IsDead(Engardo) == FALSE)\n\t&& (!Npc_KnowsInfo');
    expect(reparse(disk).hasErrors).toBe(false);
  });
});
