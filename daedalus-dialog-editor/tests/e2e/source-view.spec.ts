import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E tests for the Source Code View dialog.
 * Covers opening via the "View Source" button and closing the dialog.
 */

const SAMPLE_DIALOG_CONTENT = fs.readFileSync(
  path.join(__dirname, '../fixtures/sample-dialog.d'),
  'utf-8'
);

test.describe('Source Code View', () => {
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
  });

  test('View Source button is present in the editor toolbar', async ({ page }) => {
    await expect(page.getByRole('button', { name: /View Source/i })).toBeVisible();
  });

  test('clicking View Source opens the source view dialog', async ({ page }) => {
    await page.getByRole('button', { name: /View Source/i }).click();

    // Dialog title includes "Source Code: <dialogName>"
    await expect(
      page.getByText('Source Code: DIA_Arog_EntscheidungKillAlchemist')
    ).toBeVisible({ timeout: 5000 });
  });

  test('source view dialog has a Close button', async ({ page }) => {
    await page.getByRole('button', { name: /View Source/i }).click();
    await expect(
      page.getByText('Source Code: DIA_Arog_EntscheidungKillAlchemist')
    ).toBeVisible({ timeout: 5000 });

    await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  });

  test('clicking Close dismisses the source view dialog', async ({ page }) => {
    await page.getByRole('button', { name: /View Source/i }).click();
    await expect(
      page.getByText('Source Code: DIA_Arog_EntscheidungKillAlchemist')
    ).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(
      page.getByText('Source Code: DIA_Arog_EntscheidungKillAlchemist')
    ).not.toBeVisible();
  });

  test('source view dialog has a copy button', async ({ page }) => {
    await page.getByRole('button', { name: /View Source/i }).click();
    await expect(
      page.getByText('Source Code: DIA_Arog_EntscheidungKillAlchemist')
    ).toBeVisible({ timeout: 5000 });

    await expect(page.getByRole('button', { name: 'Copy to clipboard' })).toBeVisible();
  });
});
