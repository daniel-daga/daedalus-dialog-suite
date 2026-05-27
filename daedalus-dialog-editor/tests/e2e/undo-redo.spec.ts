import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E tests for undo / redo functionality.
 * Covers toolbar Undo/Redo buttons and Ctrl+Z / Ctrl+Y keyboard shortcuts.
 */

const SAMPLE_DIALOG_CONTENT = fs.readFileSync(
  path.join(__dirname, '../fixtures/sample-dialog.d'),
  'utf-8'
);

test.describe('Undo / Redo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_test-dialog.d', content);
    }, SAMPLE_DIALOG_CONTENT);

    page.on('dialog', async (d) => await d.accept('test-dialog.d'));
    await page.getByRole('button', { name: /Open Single File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });

    await page.getByText('SLD_99005_Arog').click();
    await page.getByRole('button', { name: /DIA_Arog_EntscheidungKillAlchemist/ }).click();
    await expect(
      page.getByRole('heading', { name: 'DIA_Arog_EntscheidungKillAlchemist', exact: true })
    ).toBeVisible();
    await expect(page.getByLabel('Text').first()).toBeVisible();
  });

  test('Undo and Redo buttons are disabled before any edits', async ({ page }) => {
    const appBar = page.getByRole('banner');
    await expect(appBar.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await expect(appBar.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  test('Undo button becomes enabled after editing a dialog line', async ({ page }) => {
    const appBar = page.getByRole('banner');
    const firstTextField = page.getByLabel('Text').first();

    await firstTextField.click();
    await firstTextField.fill('Modified text for undo test');
    // Blur to flush the debounced update into history
    await page.keyboard.press('Tab');

    await expect(async () => {
      await expect(appBar.getByRole('button', { name: 'Undo' })).toBeEnabled();
    }).toPass({ timeout: 5000 });
  });

  test('clicking Undo reverts the last edit', async ({ page }) => {
    const appBar = page.getByRole('banner');
    const firstTextField = page.getByLabel('Text').first();
    const originalValue = await firstTextField.inputValue();

    await firstTextField.click();
    await firstTextField.fill('Modified for undo');
    await page.keyboard.press('Tab');

    // Wait for undo to become available
    await expect(async () => {
      await expect(appBar.getByRole('button', { name: 'Undo' })).toBeEnabled();
    }).toPass({ timeout: 5000 });

    await appBar.getByRole('button', { name: 'Undo' }).click();

    // After undo, the text should revert to original
    await expect(async () => {
      await expect(page.getByLabel('Text').first()).toHaveValue(originalValue);
    }).toPass({ timeout: 5000 });
  });

  test('clicking Redo re-applies an undone edit', async ({ page }) => {
    const appBar = page.getByRole('banner');
    const firstTextField = page.getByLabel('Text').first();

    await firstTextField.click();
    await firstTextField.fill('Modified for redo');
    await page.keyboard.press('Tab');

    await expect(async () => {
      await expect(appBar.getByRole('button', { name: 'Undo' })).toBeEnabled();
    }).toPass({ timeout: 5000 });

    await appBar.getByRole('button', { name: 'Undo' }).click();

    // Redo should become available after undo
    await expect(async () => {
      await expect(appBar.getByRole('button', { name: 'Redo' })).toBeEnabled();
    }).toPass({ timeout: 5000 });

    await appBar.getByRole('button', { name: 'Redo' }).click();

    await expect(async () => {
      await expect(page.getByLabel('Text').first()).toHaveValue('Modified for redo');
    }).toPass({ timeout: 5000 });
  });

  test('Ctrl+Z triggers undo', async ({ page }) => {
    const appBar = page.getByRole('banner');
    const firstTextField = page.getByLabel('Text').first();
    const originalValue = await firstTextField.inputValue();

    await firstTextField.click();
    await firstTextField.fill('Ctrl+Z test');
    await page.keyboard.press('Tab');

    await expect(async () => {
      await expect(appBar.getByRole('button', { name: 'Undo' })).toBeEnabled();
    }).toPass({ timeout: 5000 });

    await page.keyboard.press('Control+z');

    await expect(async () => {
      await expect(page.getByLabel('Text').first()).toHaveValue(originalValue);
    }).toPass({ timeout: 5000 });
  });

  test('Ctrl+Y triggers redo', async ({ page }) => {
    const appBar = page.getByRole('banner');
    const firstTextField = page.getByLabel('Text').first();

    await firstTextField.click();
    await firstTextField.fill('Ctrl+Y test');
    await page.keyboard.press('Tab');

    await expect(async () => {
      await expect(appBar.getByRole('button', { name: 'Undo' })).toBeEnabled();
    }).toPass({ timeout: 5000 });

    await page.keyboard.press('Control+z');

    await expect(async () => {
      await expect(appBar.getByRole('button', { name: 'Redo' })).toBeEnabled();
    }).toPass({ timeout: 5000 });

    await page.keyboard.press('Control+y');

    await expect(async () => {
      await expect(page.getByLabel('Text').first()).toHaveValue('Ctrl+Y test');
    }).toPass({ timeout: 5000 });
  });
});
