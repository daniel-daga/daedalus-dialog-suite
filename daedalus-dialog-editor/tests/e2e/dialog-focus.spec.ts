import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E tests for dialog line focus
 */

const SAMPLE_DIALOG_CONTENT = `
INSTANCE DIA_Arog_Test(C_INFO)
{
	npc	= SLD_99005_Arog;
	nr	= 2;
	condition	= DIA_Arog_Test_Condition;
	information	= DIA_Arog_Test_Info;
	important	= TRUE;
};

FUNC INT DIA_Arog_Test_Condition()
{
};

FUNC VOID DIA_Arog_Test_Info()
{
	AI_Output(self, other, "DIA_Arog_Test_15_1"); //Line 1
};
`;

test.describe('Dialog Line Focus', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Seed the mock file system with test data
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_test-focus.d', content);
    }, SAMPLE_DIALOG_CONTENT);

    // Mock prompt and open file
    page.on('dialog', async dialog => {
      await dialog.accept('test-focus.d');
    });

    // Open file
    await page.getByRole('button', { name: /Open Single File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });

    // Navigate to dialog
    await page.getByText('SLD_99005_Arog').click();
    await page.getByRole('button', { name: /DIA_Arog_Test/ }).click();

    // Wait for editor to load
    await expect(page.getByRole('heading', { name: 'DIA_Arog_Test', exact: true })).toBeVisible();
  });

  test('pressing Enter in a dialog line should focus the new line', async ({ page }) => {
    // Find the first dialog line text field
    const firstLine = page.getByLabel('Text').first();
    await expect(firstLine).toBeVisible();
    
    // Focus and type
    await firstLine.click();
    await firstLine.fill('Hello');
    
    // Press Enter
    await page.keyboard.press('Enter');
    
    // Wait for the new line to appear
    const textFields = page.getByLabel('Text');
    await expect(textFields).toHaveCount(2);
    
    // The second text field should be focused
    const secondLine = textFields.nth(1);
    await expect(secondLine).toBeFocused();
  });

  test('pressing Shift+Enter in a dialog line should focus the new line', async ({ page }) => {
    // Find the first dialog line text field
    const firstLine = page.getByLabel('Text').first();
    await expect(firstLine).toBeVisible();
    
    // Focus and type
    await firstLine.click();
    await firstLine.fill('Hello');
    
    // Press Shift+Enter
    await page.keyboard.press('Shift+Enter');
    
    // Wait for the new line to appear
    const textFields = page.getByLabel('Text');
    await expect(textFields).toHaveCount(2);
    
    // The second text field should be focused
    const secondLine = textFields.nth(1);
    await expect(secondLine).toBeFocused();
  });

  test('clicking "Add Line" button should focus the new line', async ({ page }) => {
    // Initial count
    await expect(page.getByLabel('Text')).toHaveCount(1);

    // Open "Add action" menu and select "Dialog Line"
    await page.getByRole('button', { name: 'Add action' }).click();
    await page.getByRole('menuitem', { name: 'Dialog Line' }).click();

    // Wait for the new line to appear
    const textFields = page.getByLabel('Text');
    await expect(textFields).toHaveCount(2);
    
    // The second text field should be focused
    const secondLine = textFields.nth(1);
    await expect(secondLine).toBeFocused();
  });

  test('clicking "+" button between actions should focus the new line', async ({ page }) => {
    // Add a second line first via the "Add action" menu
    await page.getByRole('button', { name: 'Add action' }).click();
    await page.getByRole('menuitem', { name: 'Dialog Line' }).click();
    await expect(page.getByLabel('Text')).toHaveCount(2);
    
    // Click the "+" button between the two action cards.
    // It is position:absolute at bottom:-16px and may be partially covered by
    // the card below, so force:true bypasses Playwright's coverage check.
    const addButtons = page.locator('[aria-label="Add new action"]');
    await addButtons.first().click({ force: true });

    // Select "Dialog Line" from the menu
    await page.getByRole('menuitem', { name: /Dialog Line/i }).click();

    // Should now have 3 lines
    const textFields = page.getByLabel('Text');
    await expect(textFields).toHaveCount(3);

    // The inserted middle line (index 1) should receive focus.
    // addActionAfterPath queues a pendingFocusRequest that is applied when the
    // new card mounts, but onClose() briefly re-focuses card 0 first — poll
    // until the pending focus lands on the correct element.
    const middleLine = textFields.nth(1);
    await expect(async () => {
      await expect(middleLine).toBeFocused();
    }).toPass({ timeout: 10000 });
  });
});
