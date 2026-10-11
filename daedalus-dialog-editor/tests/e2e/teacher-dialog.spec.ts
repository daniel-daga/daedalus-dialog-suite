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

// Issue #147: create the full teacher (Lehrer) dialog boilerplate for an NPC
// from a small form (skill + max level + description).
test.describe('Teacher dialog creation', () => {
  test('creates the teach dialog file for the selected NPC', async ({ page }) => {
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

    // Open the teacher form; the default skill is 1H with its description
    await page.getByRole('button', { name: 'Create Teacher Dialog' }).click();
    await expect(page.getByLabel('Description')).toHaveValue('Trainier mich im Schwertkampf!');

    // Raise the max level and create
    await page.getByLabel('Max Level').fill('60');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // The new dialog shows up in the dialog tree for the NPC
    await expect(page.getByText('DIA_Existing_Teach', { exact: true }).first()).toBeVisible({ timeout: 15000 });

    // The generated file carries the full teach boilerplate
    await expect(async () => {
      const content = await page.evaluate(() =>
        localStorage.getItem('mockapi_file_project/dialogs/DIA_Existing_Teach.d')
      );
      expect(content).not.toBeNull();
      expect(content).toContain('INSTANCE DIA_Existing_Teach (C_INFO)');
      expect(content).toContain('npc\t\t\t= SLD_11111_Existing;');
      expect(content).toContain('B_TeachFightTalentPercent (self, other, NPC_TALENT_1H, 1, 60);');
      expect(content).toContain('B_BuildLearnString(PRINT_Learn1h5, B_GetLearnCostTalent(other, NPC_TALENT_1H, 5))');
      expect(content).toContain('FUNC VOID DIA_Existing_Teach_Back()');
    }).toPass({ timeout: 5000 });
  });
});
