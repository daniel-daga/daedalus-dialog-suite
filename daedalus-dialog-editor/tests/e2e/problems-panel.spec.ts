import { test, expect } from '@playwright/test';

/**
 * E2E for the project-wide Problems panel.
 *
 * The fixture produces exactly one problem: the info function's AI_Output voice
 * id ("BadVoiceId") does not match the vanilla `…_<n>_<n>` pattern, so the
 * `voice-id-malformed` lint fires. Because that function is the dialog's
 * `information`, the problem is enriched with the owning dialog and clicking it
 * navigates to DIA_Prob_Test. The dialog's condition/info functions are
 * referenced (not orphaned) and its NPC is indexed (no npc-not-found).
 */
const PROJECT_FILE_CONTENT = `INSTANCE DIA_Prob_Test(C_INFO)
{
\tnpc = SLD_ProbNpc;
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
\tAI_Output(self, other, "BadVoiceId"); //A test line.
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
    await expect(page.getByText('SLD_ProbNpc')).toBeVisible({ timeout: 15000 });
  });

  test('lists a project-wide problem and navigates to the offending dialog', async ({ page }) => {
    await page.getByTestId('problems-toggle').click();
    await expect(page.getByTestId('problems-panel')).toBeVisible();

    const firstRow = page.getByTestId('problem-row-0');
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    await expect(firstRow).toContainText('BadVoiceId');
    await expect(firstRow).toContainText('Malformed voice ID');

    // Clicking the problem jumps to the dialog view with the dialog selected.
    await firstRow.click();
    await expect(page.getByRole('heading', { name: 'DIA_Prob_Test', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('Rescan keeps the problem after a manual re-scan', async ({ page }) => {
    await page.getByTestId('problems-toggle').click();
    await expect(page.getByTestId('problem-row-0')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('problems-rescan').click();
    await expect(page.getByTestId('problem-row-0')).toContainText('BadVoiceId');
  });
});
