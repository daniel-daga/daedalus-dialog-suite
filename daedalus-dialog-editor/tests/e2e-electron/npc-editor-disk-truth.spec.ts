import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { launchApp, seedProjectDir, stubOpenDialog, reparse, type AppFixture } from './harness';

const NPC = 'BAU_900_Onar';

test.describe('NPC editor (disk truth)', () => {
  let fixture: AppFixture;
  let projectDir: string;

  test.beforeEach(async () => {
    projectDir = seedProjectDir(['sample-dialog.d', 'npc-editor.d']);
    fixture = await launchApp();
    await stubOpenDialog(fixture.app, [projectDir]);
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
  });

  test('an edited NPC field is written to disk and reparses with the real parser', async () => {
    const { page } = fixture;
    const savedFile = path.join(projectDir, 'npc-editor.d');

    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await expect(page.getByText(NPC)).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: `Edit NPC ${NPC}` }).click();

    const editor = page.getByRole('dialog', { name: `NPC ${NPC}` });
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel('Level')).toHaveValue('20');
    await editor.getByLabel('Level').fill('25');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();

    await expect(async () => {
      const disk = fs.readFileSync(savedFile, 'latin1');
      expect(disk).toMatch(/level\s*=\s*25\s*;/i);
    }).toPass({ timeout: 20000 });

    const disk = fs.readFileSync(savedFile, 'latin1');
    expect(reparse(disk).hasErrors).toBe(false);
  });
});
