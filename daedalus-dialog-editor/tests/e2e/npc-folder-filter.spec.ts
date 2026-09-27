import { test, expect, type Page } from '@playwright/test';

/**
 * Browser mock-harness spec for the NPC column's folder filter. A mod opened
 * on its whole scripts tree (MDK base scripts + the mod's own folder) lists
 * every C_NPC — wolves and the base game's cast included. The modder works in
 * one folder, so the list can be narrowed to the NPCs declared there or given
 * a dialog there, while the whole tree stays loaded for symbols.
 */

const FILES: Record<string, string> = {
  'project/_mdk/Monster/Wolf.d': `INSTANCE Wolf (C_NPC)
{
	name = "Wolf";
};
`,
  'project/_mdk/NPC/BAU_900_Onar.d': `INSTANCE BAU_900_Onar (C_NPC)
{
	name = "Onar";
};
`,
  'project/Beppo/NPC/VLK_99101_Konstantin.d': `INSTANCE VLK_99101_Konstantin (C_NPC)
{
	name = "Konstantin";
};
`,
  // The mod gives a base-game NPC a new dialog: Onar belongs to the mod's list.
  'project/Beppo/Dialoge/DIA_Onar_Beppo.d': `INSTANCE DIA_Onar_Beppo(C_INFO)
{
	npc = BAU_900_Onar;
	nr = 1;
	condition = DIA_Onar_Beppo_Condition;
	information = DIA_Onar_Beppo_Info;
	important = FALSE;
};

FUNC INT DIA_Onar_Beppo_Condition()
{
	return TRUE;
};

FUNC VOID DIA_Onar_Beppo_Info()
{
};
`,
};

async function openProject(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  await page.evaluate((files) => {
    for (const [path, content] of Object.entries(files)) {
      localStorage.setItem(`mockapi_file_${path}`, content);
    }
  }, FILES);
  page.on('dialog', async (dialog) => {
    if (dialog.message().includes('project folder path')) {
      await dialog.accept('project');
    } else {
      await dialog.dismiss();
    }
  });
  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await expect(page.getByText('VLK_99101_Konstantin')).toBeVisible({ timeout: 15000 });
}

test.describe('NPC folder filter', () => {
  test('narrows the NPC list to one folder and remembers it', async ({ page }) => {
    await openProject(page);
    await expect(page.getByText('Wolf', { exact: true })).toBeVisible();

    await page.getByRole('combobox', { name: 'NPC folder' }).click();
    await page.getByRole('option', { name: 'Beppo', exact: true }).click();

    await expect(page.getByText('VLK_99101_Konstantin')).toBeVisible();
    await expect(page.getByText('BAU_900_Onar')).toBeVisible();
    await expect(page.getByText('Wolf', { exact: true })).toBeHidden();

    // Reopening the project keeps the folder.
    await page.reload();
    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await expect(page.getByText('VLK_99101_Konstantin')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Wolf', { exact: true })).toBeHidden();

    await page.getByRole('combobox', { name: 'NPC folder' }).click();
    await page.getByRole('option', { name: 'All folders' }).click();
    await expect(page.getByText('Wolf', { exact: true })).toBeVisible();
  });
});
