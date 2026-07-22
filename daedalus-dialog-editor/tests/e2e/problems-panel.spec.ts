import { test, expect } from '@playwright/test';

/**
 * E2E for the project-wide Problems panel.
 *
 * The fixture is crafted to produce exactly one problem: the dialog's `npc`
 * (SLD_MissingNpc) is never declared as a C_NPC, so the `npc-not-found` lint
 * fires. Its condition/info functions are referenced by the dialog (not
 * orphaned) and its voice id is well-formed, so no other lint triggers.
 */
const PROJECT_FILE_CONTENT = `INSTANCE DIA_Prob_Test(C_INFO)
{
\tnpc = SLD_MissingNpc;
\tnr = 1;
\tcondition = DIA_Prob_Test_Condition;
\tinformation = DIA_Prob_Test_Info;
\timportant = FALSE;
};

FUNC INT DIA_Prob_Test_Condition()
{
\treturn TRUE;
};

FUNC VOID DIA_Prob_Test_Info()
{
\tAI_Output(self, other, "DIA_Prob_Test_15_00"); //A test line.
};
`;

test.describe('Problems panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();

    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_probtest/dia.d', content);
    }, PROJECT_FILE_CONTENT);

    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('project folder path')) {
        await dialog.accept('probtest');
      } else {
        await dialog.dismiss();
      }
    });

    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await expect(page.getByText('SLD_MissingNpc')).toBeVisible({ timeout: 15000 });
  });

  test('lists a project-wide problem and navigates to the offending dialog', async ({ page }) => {
    await page.getByTestId('problems-toggle').click();
    await expect(page.getByTestId('problems-panel')).toBeVisible();

    const firstRow = page.getByTestId('problem-row-0');
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    await expect(firstRow).toContainText('SLD_MissingNpc');
    await expect(firstRow).toContainText('Missing NPC');

    // Clicking the problem jumps to the dialog view with the dialog selected.
    await firstRow.click();
    await expect(page.getByRole('heading', { name: 'DIA_Prob_Test', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('Rescan keeps the problem after a manual re-scan', async ({ page }) => {
    await page.getByTestId('problems-toggle').click();
    await expect(page.getByTestId('problem-row-0')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('problems-rescan').click();
    await expect(page.getByTestId('problem-row-0')).toContainText('SLD_MissingNpc');
  });
});
