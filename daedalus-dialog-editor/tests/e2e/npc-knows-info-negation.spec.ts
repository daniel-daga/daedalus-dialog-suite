import { test, expect } from '@playwright/test';

/**
 * Browser mock-harness spec: an "NPC Knows Dialog" condition can be negated,
 * so a dialog can require that an earlier one was NOT heard — the second
 * first-meeting a modder writes for an NPC met elsewhere (`!Npc_KnowsInfo`).
 * The model and codegen supported it; the card had no switch.
 */

const PROJECT_FILE_PATH = 'project/DIA_Albert.d';

const PROJECT_FILE_CONTENT = `INSTANCE DIA_Albert_Hallo1(C_INFO)
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
\tif (Npc_KnowsInfo(self, DIA_Albert_Hallo1))
\t{
\t\treturn TRUE;
\t};
};

FUNC VOID DIA_Albert_Hallo3_Info()
{
};
`;

test('an NPC Knows Dialog condition can be switched to NOT', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  await page.evaluate(({ path, content }) => {
    localStorage.setItem('mockapi_file_' + path, content);
  }, { path: PROJECT_FILE_PATH, content: PROJECT_FILE_CONTENT });
  page.on('dialog', async (dialog) => {
    if (dialog.message().includes('project folder path')) {
      await dialog.accept('project');
    } else {
      await dialog.dismiss();
    }
  });
  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await page.getByText('VLK_99107_Albert').click();
  await page.getByRole('button', { name: /DIA_Albert_Hallo3/ }).click();
  await expect(page.getByRole('heading', { name: 'DIA_Albert_Hallo3', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Expand conditions' }).click();
  await page.getByRole('button', { name: 'Add Condition' }).first().click();
  await page.getByRole('menuitem', { name: 'NPC Knows Dialog', exact: true }).click();
  const dialogField = page.getByRole('combobox', { name: 'Dialog', exact: true });
  await dialogField.fill('DIA_Albert_Hallo1');
  await page.keyboard.press('Escape');
  await dialogField.blur();
  await expect(page.locator('.MuiChip-label', { hasText: /^NPC Knows Dialog$/ })).toBeVisible();
  await page.getByRole('checkbox', { name: 'NOT' }).check();
  await expect(page.locator('.MuiChip-label', { hasText: /^NPC Does Not Know Dialog$/ })).toBeVisible();

  // The negation is the condition's own state, not the card's: it survives
  // leaving the dialog and coming back. (The harness's mock codegen emits no
  // condition bodies, so the `!Npc_KnowsInfo` text is asserted in Jest against
  // the real generator.)
  await page.getByRole('button', { name: /DIA_Albert_Hallo1/ }).click();
  await expect(page.getByRole('heading', { name: 'DIA_Albert_Hallo1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'DIA_Albert_Hallo3 DIA_Albert_Hallo3', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'DIA_Albert_Hallo3', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand conditions' }).click();
  await expect(page.getByRole('checkbox', { name: 'NOT' })).toBeChecked();
  await expect(page.locator('.MuiChip-label', { hasText: /^NPC Does Not Know Dialog$/ })).toBeVisible();
});
