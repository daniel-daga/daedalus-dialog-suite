import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E tests for dialog editing
 * Tests adding dialog lines and editing actions
 */

// Sample dialog file content
const SAMPLE_DIALOG_CONTENT = fs.readFileSync(
  path.join(__dirname, '../fixtures/sample-dialog.d'),
  'utf-8'
);

test.describe('Dialog Line Editing', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Seed the mock file system with test data
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_test-dialog.d', content);
    }, SAMPLE_DIALOG_CONTENT);

    // Mock prompt and open file
    page.on('dialog', async dialog => {
      await dialog.accept('test-dialog.d');
    });

    // Open file
    await page.getByRole('button', { name: /Open Dialog File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });

    // Navigate to dialog
    await page.getByText('SLD_99005_Arog').click();
    await page.getByRole('button', { name: /DIA_Arog_EntscheidungKillAlchemist/ }).click();

    // Wait for editor to load
    await expect(page.getByRole('heading', { name: 'DIA_Arog_EntscheidungKillAlchemist', exact: true })).toBeVisible();
  });

  test('should display existing dialog actions', async ({ page }) => {
    // The sample dialog has 3 AI_Output lines
    await expect(page.getByText(/DIA_Arog_EntscheidungKillAlchemist_15_6/i)).toBeVisible();
    await expect(page.getByText(/DIA_Arog_EntscheidungKillAlchemist_5_6/i)).toBeVisible();
    await expect(page.getByText(/action_1762379701358_vj2uugnzi/i)).toBeVisible();

    // Count action items (look for text inputs or action containers)
    const actionCount = await page.locator('[data-testid*="action"], .MuiBox-root:has(textarea)').count();
    console.log(`Found ${actionCount} actions`);
  });

  test('BUG: typing in dialog line should NOT make actions disappear', async ({ page }) => {
    // Wait for actions to be visible
    await expect(page.getByText(/DIA_Arog_EntscheidungKillAlchemist_15_6/i)).toBeVisible();

    // Count initial actions
    const initialActionTexts = await page.locator('textarea[placeholder*="Dialog text"], input[value*="DIA_"]').count();
    console.log(`Initial action count: ${initialActionTexts}`);

    // Find the first textarea (dialog line input)
    const firstTextarea = page.locator('textarea').first();
    await expect(firstTextarea).toBeVisible();

    // Take screenshot before typing
    await page.screenshot({ path: 'test-results/before-typing.png', fullPage: true });

    // Type in the textarea
    await firstTextarea.click();
    console.log('Clicked textarea');

    await page.waitForTimeout(500);

    await firstTextarea.fill('Testing if actions disappear');
    console.log('Typed in textarea');

    // Wait a bit for any state updates
    await page.waitForTimeout(500);

    // Take screenshot after typing
    await page.screenshot({ path: 'test-results/after-typing.png', fullPage: true });

    // Check if actions are still visible
    const afterActionTexts = await page.locator('textarea[placeholder*="Dialog text"], input[value*="DIA_"]').count();
    console.log(`Action count after typing: ${afterActionTexts}`);

    // BUG CHECK: Actions should NOT disappear
    expect(afterActionTexts).toBeGreaterThan(0);

    // Original action names should still be visible
    await expect(page.getByText(/DIA_Arog_EntscheidungKillAlchemist_15_6/i)).toBeVisible();
  });

  test('should add a new dialog line when clicking Add Line button', async ({ page }) => {
    // Count initial actions
    const initialCount = await page.locator('textarea').count();
    console.log(`Initial textarea count: ${initialCount}`);

    // Click "Add Line" button
    await page.getByRole('button', { name: /Add Line/i }).click();

    // Wait for new action to appear
    await page.waitForTimeout(500);

    // Count actions after adding
    const afterCount = await page.locator('textarea').count();
    console.log(`Textarea count after adding: ${afterCount}`);

    // Should have one more action
    expect(afterCount).toBe(initialCount + 1);

    // Take screenshot
    await page.screenshot({ path: 'test-results/after-add-line.png', fullPage: true });
  });

  test('should type in newly added dialog line', async ({ page }) => {
    // Count initial actions
    const initialCount = await page.locator('textarea').count();

    // Add new line
    await page.getByRole('button', { name: /Add Line/i }).click();
    await page.waitForTimeout(500);

    // Find the last textarea (newly added)
    const lastTextarea = page.locator('textarea').last();
    await expect(lastTextarea).toBeVisible();

    // Type in the new textarea
    await lastTextarea.click();
    await lastTextarea.fill('This is a new dialog line');

    // Wait for state updates
    await page.waitForTimeout(500);

    // Check all actions are still visible
    const finalCount = await page.locator('textarea').count();
    console.log(`Final textarea count: ${finalCount}`);

    // Should have the same count (initial + 1)
    expect(finalCount).toBe(initialCount + 1);

    // Verify the typed text is preserved
    await expect(lastTextarea).toHaveValue('This is a new dialog line');

    // Take screenshot
    await page.screenshot({ path: 'test-results/after-typing-new-line.png', fullPage: true });
  });

  test('should preserve text when typing character by character', async ({ page }) => {
    // Add new line
    await page.getByRole('button', { name: /Add Line/i }).click();
    await page.waitForTimeout(500);

    const lastTextarea = page.locator('textarea').last();
    await lastTextarea.click();

    // Type character by character with delays
    const textToType = 'Hello World';
    for (const char of textToType) {
      await lastTextarea.type(char);
      await page.waitForTimeout(100); // Wait between characters

      // Check actions still exist after each character
      const count = await page.locator('textarea').count();
      console.log(`After typing '${char}': ${count} textareas`);
    }

    // Final check
    await expect(lastTextarea).toHaveValue(textToType);

    // Verify all original actions are still visible
    await expect(page.getByText(/DIA_Arog_EntscheidungKillAlchemist_15_6/i)).toBeVisible();
  });

  test('should show "Unsaved Changes" chip when editing', async ({ page }) => {
    // Initially no unsaved changes chip
    await expect(page.getByText('Unsaved Changes')).not.toBeVisible();

    // Type in first textarea
    const firstTextarea = page.locator('textarea').first();
    await firstTextarea.click();
    await firstTextarea.fill('Modified text');

    // Wait for debounce
    await page.waitForTimeout(500);

    // Should show "Unsaved Changes" chip
    await expect(page.getByText('Unsaved Changes')).toBeVisible();
  });

  test('should maintain action count across multiple edits', async ({ page }) => {
    // Count initial actions
    const initialCount = await page.locator('textarea').count();
    console.log(`Starting with ${initialCount} textareas`);

    // Edit first action
    const firstTextarea = page.locator('textarea').first();
    await firstTextarea.click();
    await firstTextarea.fill('Edit 1');
    await page.waitForTimeout(500);

    let currentCount = await page.locator('textarea').count();
    expect(currentCount).toBe(initialCount);
    console.log(`After edit 1: ${currentCount} textareas`);

    // Edit second action
    const secondTextarea = page.locator('textarea').nth(1);
    await secondTextarea.click();
    await secondTextarea.fill('Edit 2');
    await page.waitForTimeout(500);

    currentCount = await page.locator('textarea').count();
    expect(currentCount).toBe(initialCount);
    console.log(`After edit 2: ${currentCount} textareas`);

    // Edit third action
    const thirdTextarea = page.locator('textarea').nth(2);
    await thirdTextarea.click();
    await thirdTextarea.fill('Edit 3');
    await page.waitForTimeout(500);

    currentCount = await page.locator('textarea').count();
    expect(currentCount).toBe(initialCount);
    console.log(`After edit 3: ${currentCount} textareas`);

    // Take final screenshot
    await page.screenshot({ path: 'test-results/after-multiple-edits.png', fullPage: true });
  });
});
