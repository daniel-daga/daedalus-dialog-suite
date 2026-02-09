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
    
    // Click "Add Line" button
    await page.getByRole('button', { name: /Add Line/i }).click();
    
    // Wait for the new line to appear
    const textFields = page.getByLabel('Text');
    await expect(textFields).toHaveCount(2);
    
    // The second text field should be focused
    const secondLine = textFields.nth(1);
    await expect(secondLine).toBeFocused();
  });

  test('clicking "+" button between actions should focus the new line', async ({ page }) => {
    // Add a second line first
    await page.getByRole('button', { name: /Add Line/i }).click();
    await expect(page.getByLabel('Text')).toHaveCount(2);
    
    // Find the first action card and its "+" button
    // The button is inside a Tooltip with title "Add new action"
    const addButtons = page.getByRole('button', { name: /Add new action/i });
    await addButtons.first().click();
    
    // Select "Dialog Line" from the menu
    await page.getByRole('menuitem', { name: /Dialog Line/i }).click();
    
    // Should now have 3 lines
    const textFields = page.getByLabel('Text');
    await expect(textFields).toHaveCount(3);
    
    // The middle one (index 1) should be focused
    const middleLine = textFields.nth(1);
    await expect(middleLine).toBeFocused();
  });
});
