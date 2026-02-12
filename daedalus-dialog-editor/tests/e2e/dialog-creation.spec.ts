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
    await expect(page.getByText('SLD_11111_Existing')).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Add NPC' }).click();
    await page.getByLabel('NPC Name').fill('SLD_12345_TestNpc');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('SLD_12345_TestNpc')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'DIA_SLD_12345_TestNpc_Start', exact: true })).toBeVisible();

    const storageState = await page.evaluate(() => {
      return {
        npcFile: localStorage.getItem('mockapi_file_project/dialogs/DIA_SLD_12345_TestNpc.d'),
        existingFile: localStorage.getItem('mockapi_file_project/dialogs/existing.d')
      };
    });

    expect(storageState.npcFile).not.toBeNull();
    expect(storageState.existingFile).not.toContain('DIA_SLD_12345_TestNpc_Start');
  });
});
