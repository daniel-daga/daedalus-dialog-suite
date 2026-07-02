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

test.describe('NPC list in project mode', () => {
  // Issue #141: the "+ Add NPC" button created NPCs with incorrect parameters
  // and was removed. NPCs are now added by dropping an NPC .d file into the
  // project folder (the editor auto-creates the EXIT dialog file for them).
  test('does not offer an Add NPC button', async ({ page }) => {
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

    // The NPC pane header is present, but the Add NPC affordance is gone
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add NPC' })).toHaveCount(0);
  });
});
