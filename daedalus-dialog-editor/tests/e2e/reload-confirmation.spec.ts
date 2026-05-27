import { test, expect } from '@playwright/test';

/**
 * E2E tests for the "Reload" button with unsaved changes confirmation.
 * Covers the browser confirm dialog shown when reloading with unsaved changes.
 */

const DIALOG_FILE = `INSTANCE DIA_Reload_Test(C_INFO)
{
\tnpc = SLD_33333_ReloadNPC;
\tnr = 1;
\tcondition = DIA_Reload_Test_Condition;
\tinformation = DIA_Reload_Test_Info;
\timportant = FALSE;
};

FUNC INT DIA_Reload_Test_Condition()
{
\treturn TRUE;
};

FUNC VOID DIA_Reload_Test_Info()
{
\tAI_Output(self, other, "DIA_Reload_Test_15_00"); //Original line.
};
`;

test.describe('Reload with Unsaved Changes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_reload-test.d', content);
    }, DIALOG_FILE);

    page.once('dialog', async (d) => await d.accept('reload-test.d'));
    await page.getByRole('button', { name: /Open Single File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });

    await page.getByText('SLD_33333_ReloadNPC').click();
    await page.getByRole('button', { name: /DIA_Reload_Test/ }).click();
    await expect(
      page.getByRole('heading', { name: 'DIA_Reload_Test', exact: true })
    ).toBeVisible();
    await expect(page.getByLabel('Text').first()).toBeVisible();
  });

  test('"Reload" button is visible in the app bar', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
  });

  test('"Reload" is disabled when no file is open', async ({ page }) => {
    // This test checks the disabled state at app start (before opening a file)
    await page.goto('/');
    const reloadBtn = page.getByRole('button', { name: 'Reload', exact: true });
    await expect(reloadBtn).toBeDisabled();
  });

  test('"Reload" is enabled after opening a file', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeEnabled();
  });

  test('clicking "Reload" with no unsaved changes reloads without confirmation', async ({ page }) => {
    let confirmDialogShown = false;
    page.on('dialog', async (d) => {
      if (d.type() === 'confirm') {
        confirmDialogShown = true;
        await d.dismiss();
      } else {
        await d.dismiss();
      }
    });

    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await page.waitForTimeout(1000);
    // No unsaved changes → no confirmation prompt
    expect(confirmDialogShown).toBe(false);
  });

  test('clicking "Reload" with unsaved changes shows a confirmation dialog', async ({ page }) => {
    // Make an unsaved change
    const textField = page.getByLabel('Text').first();
    await textField.click();
    await textField.fill('Modified text that is unsaved');
    await page.keyboard.press('Tab');
    // Wait for state to reflect dirty status
    await page.waitForTimeout(500);

    let confirmMessage = '';
    page.on('dialog', async (d) => {
      if (d.type() === 'confirm') {
        confirmMessage = d.message();
        await d.dismiss(); // Dismiss to preserve changes
      }
    });

    await page.getByRole('button', { name: 'Reload', exact: true }).click();

    await expect(async () => {
      expect(confirmMessage).toContain('unsaved changes');
    }).toPass({ timeout: 5000 });
  });

  test('dismissing the confirmation preserves unsaved changes', async ({ page }) => {
    const textField = page.getByLabel('Text').first();
    await textField.click();
    await textField.fill('Changes to preserve');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    page.on('dialog', async (d) => {
      if (d.type() === 'confirm') {
        await d.dismiss(); // Cancel reload
      }
    });

    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await page.waitForTimeout(500);

    // Dialog should still be visible (reload was cancelled)
    await expect(
      page.getByRole('heading', { name: 'DIA_Reload_Test', exact: true })
    ).toBeVisible();
  });
});
