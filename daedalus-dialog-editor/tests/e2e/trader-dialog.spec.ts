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

// Feature-suggestions item 5: create the standard merchant/trader dialog
// boilerplate for an NPC from a small form (description only).
test.describe('Trader dialog creation', () => {
  test('creates the trade dialog file for the selected NPC', async ({ page }) => {
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
    await expect(page.getByText('SLD_11111_Existing').first()).toBeVisible({ timeout: 15000 });
    await page.getByText('SLD_11111_Existing').first().click();

    // Open the trader form; the description defaults to the vanilla line
    await page.getByRole('button', { name: 'Create Trader Dialog' }).click();
    await expect(page.getByLabel('Description')).toHaveValue('Zeig mir Deine Waren.');

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // The new dialog shows up in the dialog tree for the NPC
    await expect(page.getByText('DIA_Existing_Trade', { exact: true }).first()).toBeVisible({ timeout: 15000 });

    // The generated file carries the full trade boilerplate
    await expect(async () => {
      const content = await page.evaluate(() =>
        localStorage.getItem('mockapi_file_project/dialogs/DIA_Existing_Trade.d')
      );
      expect(content).not.toBeNull();
      expect(content).toContain('INSTANCE DIA_Existing_Trade (C_INFO)');
      expect(content).toContain('npc\t\t\t= SLD_11111_Existing;');
      expect(content).toContain('permanent\t= TRUE;');
      expect(content).toContain('trade\t\t= TRUE;');
      expect(content).toContain('B_GiveTradeInv (self);');
      expect(content).toContain('FUNC VOID DIA_Existing_Trade_Info()');
    }).toPass({ timeout: 5000 });
  });
});
