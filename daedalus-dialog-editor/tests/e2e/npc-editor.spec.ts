import { test, expect, type Page } from '@playwright/test';

/**
 * Browser mock-harness spec for the NPC editor (docs/plans/npc-editor.md,
 * Phase 2; NOT end-to-end). UI state only, per tests/e2e/README.md: the mock
 * stands in for the parser's NPC reader/writer, so what this proves is the
 * flow — open from the NPC list, the form shows the NPC, an edit survives a
 * save and a reopen, Cancel discards. Byte-level save fidelity is the
 * parser's own suite (daedalus-parser/test/npc-definition.test.js).
 */

const NPC_FILE = `INSTANCE BAU_900_Onar (C_NPC)
{
	name = "Onar";
	guild = GIL_BAU;
	level = 20;
	B_SetNpcVisual (self, MALE, "Hum_Head_Fatbald", Face_N_Weak_Orry, BodyTex_N, ITAR_Vlk_H);
	EquipItem (self, ItMw_1h_Bau_Mace);
	daily_routine = Rtn_Start_900;
};
`;

async function openProject(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  await page.evaluate((content) => {
    localStorage.setItem('mockapi_file_project/NPC/BAU_900_Onar.d', content);
  }, NPC_FILE);
  page.on('dialog', async (dialog) => {
    if (dialog.message().includes('project folder path')) {
      await dialog.accept('project');
    } else {
      await dialog.dismiss();
    }
  });
  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await expect(page.getByText('BAU_900_Onar')).toBeVisible({ timeout: 15000 });
}

async function openEditor(page: Page) {
  await page.getByRole('button', { name: 'Edit NPC BAU_900_Onar' }).click();
  const editor = page.getByRole('dialog', { name: /BAU_900_Onar/ });
  await expect(editor).toBeVisible();
  return editor;
}

test.describe('NPC editor', () => {
  test.beforeEach(async ({ page }) => {
    await openProject(page);
  });

  test('shows the NPC as its script declares it', async ({ page }) => {
    const editor = await openEditor(page);

    await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Onar');
    await expect(editor.getByLabel('Guild')).toHaveValue('GIL_BAU');
    await expect(editor.getByLabel('Level')).toHaveValue('20');
    await expect(editor.getByLabel('Daily routine')).toHaveValue('Rtn_Start_900');
    await expect(editor.getByLabel('Head mesh')).toHaveValue('Hum_Head_Fatbald');
    await expect(editor.getByLabel('Armor')).toHaveValue('ITAR_Vlk_H');
    await expect(editor.getByLabel('Melee weapon')).toHaveValue('ItMw_1h_Bau_Mace');
    await expect(editor.getByLabel('Ranged weapon')).toHaveValue('');
    // Absent from the script, so empty — not a default the editor invented.
    await expect(editor.getByLabel('Strength')).toHaveValue('');
  });

  test('an edit survives save and reopen', async ({ page }) => {
    let editor = await openEditor(page);
    await editor.getByLabel('Guild').fill('GIL_SLD');
    await editor.getByLabel('Level').fill('25');
    await editor.getByLabel('Strength').fill('80');
    await editor.getByLabel('Armor').fill('ITAR_Sld_M');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();

    editor = await openEditor(page);
    await expect(editor.getByLabel('Guild')).toHaveValue('GIL_SLD');
    await expect(editor.getByLabel('Level')).toHaveValue('25');
    await expect(editor.getByLabel('Strength')).toHaveValue('80');
    await expect(editor.getByLabel('Armor')).toHaveValue('ITAR_Sld_M');
    await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Onar');
  });

  test('a second weapon is added beside the first, and each keeps its own call', async ({ page }) => {
    let editor = await openEditor(page);
    await editor.getByLabel('Ranged weapon').fill('ItRw_Sld_Bow');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();

    editor = await openEditor(page);
    await expect(editor.getByLabel('Melee weapon')).toHaveValue('ItMw_1h_Bau_Mace');
    await expect(editor.getByLabel('Ranged weapon')).toHaveValue('ItRw_Sld_Bow');

    // Editing the ranged weapon must not touch the melee one's call.
    await editor.getByLabel('Ranged weapon').fill('ItRw_Crossbow_L_01');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();

    editor = await openEditor(page);
    await expect(editor.getByLabel('Melee weapon')).toHaveValue('ItMw_1h_Bau_Mace');
    await expect(editor.getByLabel('Ranged weapon')).toHaveValue('ItRw_Crossbow_L_01');
  });

  test('Cancel discards the edit', async ({ page }) => {
    let editor = await openEditor(page);
    await editor.getByLabel('Name', { exact: true }).fill('Someone else');
    await editor.getByRole('button', { name: 'Cancel' }).click();
    await expect(editor).toBeHidden();

    editor = await openEditor(page);
    await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Onar');
  });
});
