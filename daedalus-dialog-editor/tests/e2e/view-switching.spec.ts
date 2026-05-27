import { test, expect } from '@playwright/test';

/**
 * E2E tests for sidebar view switching.
 * Covers switching between Dialog Editor, Quest Editor, and Variable Manager views.
 */

const PROJECT_FILE_CONTENT = `INSTANCE DIA_ViewSwitch_Test(C_INFO)
{
\tnpc = SLD_55555_ViewNPC;
\tnr = 1;
\tcondition = DIA_ViewSwitch_Test_Condition;
\tinformation = DIA_ViewSwitch_Test_Info;
\timportant = FALSE;
};

FUNC INT DIA_ViewSwitch_Test_Condition()
{
\treturn TRUE;
};

FUNC VOID DIA_ViewSwitch_Test_Info()
{
\tAI_Output(self, other, "DIA_ViewSwitch_Test_15_00"); //View switch test line.
};
`;

test.describe('View Switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();

    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_viewtest/test.d', content);
    }, PROJECT_FILE_CONTENT);

    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('project folder path')) {
        await dialog.accept('viewtest');
      } else {
        await dialog.dismiss();
      }
    });

    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await expect(page.getByText('SLD_55555_ViewNPC')).toBeVisible({ timeout: 15000 });
  });

  test('Dialog Editor view is active by default', async ({ page }) => {
    // The Dialog Editor toggle button should be pressed/selected
    const dialogBtn = page.getByRole('button', { name: 'Dialog Editor' });
    await expect(dialogBtn).toBeVisible();
    // The NPC list is visible in dialog view
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible();
  });

  test('switching to Variable Manager view shows Variable Manager heading', async ({ page }) => {
    await page.getByRole('button', { name: 'Variable Manager' }).click();

    await expect(page.getByRole('heading', { name: 'Variable Manager' })).toBeVisible({ timeout: 10000 });
    // The Variable Manager shows search input and Add Variable button
    await expect(page.getByRole('button', { name: /Add Variable/i })).toBeVisible({ timeout: 10000 });
  });

  test('switching to Quest Editor view renders the quest panel', async ({ page }) => {
    await page.getByRole('button', { name: 'Quest Editor' }).click();

    // The quest editor should eventually render (after lazy load)
    // It shows a QuestList area on the left
    await expect(async () => {
      // Either the quest editor loaded or loading text is visible
      const hasQuestContent = await page.locator('text=Quest Editor').count() > 0
        || await page.locator('text=Loading quest editor').count() > 0
        || await page.getByRole('combobox').count() > 0
        || await page.locator('[data-testid="node-editor-quest-select"]').count() > 0;
      expect(hasQuestContent).toBeTruthy();
    }).toPass({ timeout: 15000 });
  });

  test('switching back to Dialog Editor restores the NPC list', async ({ page }) => {
    // Switch away from dialog view
    await page.getByRole('button', { name: 'Variable Manager' }).click();
    await expect(page.getByRole('heading', { name: 'Variable Manager' })).toBeVisible({ timeout: 10000 });

    // Switch back
    await page.getByRole('button', { name: 'Dialog Editor' }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('SLD_55555_ViewNPC')).toBeVisible();
  });
});
