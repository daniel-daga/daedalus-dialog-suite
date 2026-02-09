import { test, expect } from '@playwright/test';

/**
 * E2E tests for Project Mode editing
 * Verifies that selecting a dialog from the project tree correctly
 * enables editing and allows adding dialog lines.
 */

const PROJECT_FILE_CONTENT = `// Project Dialog File
INSTANCE DIA_Project_Test(C_INFO)
{
	npc = PC_Project_NPC;
	nr = 1;
	condition = DIA_Project_Test_Condition;
	information = DIA_Project_Test_Info;
	important = FALSE;
};

FUNC INT DIA_Project_Test_Condition()
{
	return TRUE;
};

FUNC VOID DIA_Project_Test_Info()
{
	AI_Output(self, other, "DIA_Project_Test_15_00"); //Hello from project!
};
`;

test.describe('Project Mode Editing', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app and wait for it to be ready
    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();

    // Seed the mock file system with test data
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_project/test.d', content);
    }, PROJECT_FILE_CONTENT);

    // Mock prompt for project folder
    page.on('dialog', async dialog => {
      if (dialog.message().includes('project folder path')) {
        await dialog.accept('project');
      } else {
        await dialog.dismiss();
      }
    });

    // Open Project
    await page.getByRole('button', { name: /Open Project/i }).first().click();
    
    // Wait for NPC list to be populated
    await expect(page.getByText('PC_Project_NPC')).toBeVisible({ timeout: 15000 });
  });

  test('should allow adding a dialog line after selecting from project tree', async ({ page }) => {
    // 1. Select NPC
    await page.getByText('PC_Project_NPC').click();

    // 2. Select Dialog from Tree
    await page.getByRole('button', { name: /DIA_Project_Test/ }).click();

    // 3. Verify editor loaded
    await expect(page.getByRole('heading', { name: 'DIA_Project_Test', exact: true })).toBeVisible();
    const firstLine = page.getByLabel('Text').first();
    await expect(firstLine).toBeVisible();
    await expect(firstLine).toHaveValue('DIA_Project_Test_15_00');

    // 4. Count initial actions (should be 1)
    const initialTextareas = await page.getByLabel('Text').count();
    console.log(`Initial actions count: ${initialTextareas}`);
    
    // 5. Click "Add Line" button
    const addLineButton = page.getByRole('button', { name: /Add Line/i });
    await expect(addLineButton).toBeVisible();
    await addLineButton.click();

    // 6. Verify new line added
    await expect(async () => {
      const count = await page.getByLabel('Text').count();
      expect(count).toBeGreaterThan(initialTextareas);
    }).toPass({ timeout: 5000 });

    // 7. Verify we can type in the new line
    const lastField = page.getByLabel('Text').last();
    await lastField.click();
    await lastField.fill('New line from test');
    await expect(lastField).toHaveValue('New line from test');
  });

  test('should allow adding a dialog line using Enter key', async ({ page }) => {
    // Select NPC and Dialog
    await page.getByText('PC_Project_NPC').click();
    await page.getByRole('button', { name: /DIA_Project_Test/ }).click();
    await expect(page.getByRole('heading', { name: 'DIA_Project_Test', exact: true })).toBeVisible();

    // Focus first line and press Enter
    const firstField = page.getByLabel('Text').first();
    await expect(firstField).toBeVisible();
    await firstField.click();
    await firstField.press('Enter');

    // Verify new line added
    await expect(async () => {
      const count = await page.getByLabel('Text').count();
      expect(count).toBe(2);
    }).toPass({ timeout: 5000 });
  });
});
