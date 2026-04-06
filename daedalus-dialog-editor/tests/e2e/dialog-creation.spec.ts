import { test, expect } from '@playwright/test';

const EXISTING_DIALOG_FILE = `INSTANCE DIA_Existing_Greeting(C_INFO)
{
\tnpc = SLD_11111_Existing;
\tnr = 1;
\tcondition = DIA_Existing_Greeting_Condition;
\tinformation = DIA_Existing_Greeting_Info;
\timportant = FALSE;
};

FUNC INT DIA_Existing_Greeting_Condition()
{
\treturn TRUE;
};

FUNC VOID DIA_Existing_Greeting_Info()
{
\tAI_Output(self, other, "DIA_Existing_Greeting_15_00");
};
`;

test.describe('Dialog creation flow', () => {
  test('creates a dedicated file when adding a new NPC in project mode', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();

    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_project/dialogs/existing.d', content);
    }, EXISTING_DIALOG_FILE);

    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('project folder path')) {
        await dialog.accept('project/dialogs');
      } else {
        await dialog.dismiss();
      }
    });

    await page.getByRole('button', { name: /Open Project/i }).first().click();
    // The NPC list item shows "SLD_11111_Existing  N dialog(s)"; take first to avoid
    // strict mode if the name also appears elsewhere in the UI
    await expect(page.getByText('SLD_11111_Existing').first()).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Add NPC' }).click();
    await page.getByLabel('NPC Name').fill('SLD_12345_TestNpc');
    await page.getByRole('button', { name: 'Create' }).click();

    // The new NPC should appear in the NPC list (left panel, body1 span comes first
    // in DOM order; other occurrences are in chips / breadcrumbs / speaker selects)
    await expect(page.getByText('SLD_12345_TestNpc').first()).toBeVisible({ timeout: 15000 });
    // The editor should have auto-navigated to the new dialog
    await expect(page.getByRole('heading', { name: 'DIA_SLD_12345_TestNpc_Start', exact: true })).toBeVisible({ timeout: 15000 });

    // The new NPC's dialog file should have been written to the mock filesystem.
    // Use a retrying assertion because the file write is part of an async chain.
    await expect(async () => {
      const storageState = await page.evaluate(() => ({
        npcFile: localStorage.getItem('mockapi_file_project/dialogs/DIA_SLD_12345_TestNpc.d'),
        existingFile: localStorage.getItem('mockapi_file_project/dialogs/existing.d')
      }));
      expect(storageState.npcFile).not.toBeNull();
      expect(storageState.existingFile).not.toContain('DIA_SLD_12345_TestNpc_Start');
    }).toPass({ timeout: 5000 });
  });
});
