import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E tests for action deletion.
 * Covers direct delete button, Escape-triggered confirmation dialog,
 * confirm, and cancel paths.
 */

const SAMPLE_DIALOG_CONTENT = fs.readFileSync(
  path.join(__dirname, '../fixtures/sample-dialog.d'),
  'utf-8'
);

test.describe('Action Deletion', () => {
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
    // Wait for dialog lines to be visible
    await expect(page.getByLabel('Text').first()).toBeVisible();
  });

  test('clicking delete button removes a dialog line directly', async ({ page }) => {
    const textFields = page.getByLabel('Text');
    const initialCount = await textFields.count();
    expect(initialCount).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Delete dialog line' }).first().click();

    await expect(async () => {
      expect(await textFields.count()).toBe(initialCount - 1);
    }).toPass({ timeout: 5000 });
  });

  test('pressing Escape on a focused dialog line opens the confirmation dialog', async ({ page }) => {
    const firstTextField = page.getByLabel('Text').first();
    await firstTextField.click();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog', { name: 'Delete action' })).toBeVisible();
    await expect(
      page.getByText('Are you sure you want to delete this action?')
    ).toBeVisible();
  });

  test('confirming deletion in the dialog removes the action', async ({ page }) => {
    const textFields = page.getByLabel('Text');
    const initialCount = await textFields.count();

    const firstTextField = page.getByLabel('Text').first();
    await firstTextField.click();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog', { name: 'Delete action' })).toBeVisible();
    // The confirm button is labelled 'Delete' and is color="error"
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(async () => {
      expect(await textFields.count()).toBe(initialCount - 1);
    }).toPass({ timeout: 5000 });
  });

  test('cancelling the confirmation dialog preserves the action', async ({ page }) => {
    const textFields = page.getByLabel('Text');
    const initialCount = await textFields.count();

    const firstTextField = page.getByLabel('Text').first();
    await firstTextField.click();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog', { name: 'Delete action' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog', { name: 'Delete action' })).not.toBeVisible();
    expect(await textFields.count()).toBe(initialCount);
  });
});
