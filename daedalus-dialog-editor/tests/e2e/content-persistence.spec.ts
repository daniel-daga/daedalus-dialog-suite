import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E content-integrity tests: edit content, let auto-save persist it, reload
 * the app, reopen the file and assert the change survived the
 * generate -> persist -> reparse round-trip.
 *
 * The browser mock generator round-trips dialog properties and AI_Output dialog
 * lines, so these assertions target that subset (count + property value), which
 * is what genuinely persists end-to-end.
 */

const SAMPLE_DIALOG_CONTENT = fs.readFileSync(
  path.join(__dirname, '../fixtures/sample-dialog.d'),
  'utf-8'
);

async function navigateToDialog(page: Page) {
  await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });
  await page.getByText('SLD_99005_Arog').click();
  await page.getByRole('button', { name: /DIA_Arog_EntscheidungKillAlchemist/ }).click();
  await expect(
    page.getByRole('heading', { name: 'DIA_Arog_EntscheidungKillAlchemist', exact: true })
  ).toBeVisible();
}

async function openFile(page: Page) {
  await page.getByRole('button', { name: /Open Single File/i }).click();
  await navigateToDialog(page);
}

test.describe('Content persistence across reload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_test-dialog.d', content);
    }, SAMPLE_DIALOG_CONTENT);
    // Handler persists across reloads for the lifetime of the page.
    page.on('dialog', async (d) => await d.accept('test-dialog.d'));
    await openFile(page);
    await expect(page.getByLabel('Text').first()).toBeVisible();
  });

  test('edited dialog priority survives auto-save and reload', async ({ page }) => {
    await page.getByRole('button', { name: 'Expand properties' }).click();
    const nr = page.getByLabel('Number (Priority)');
    await expect(nr).toBeVisible();
    await nr.click();
    await nr.fill('7');
    await nr.blur();

    // Wait past the 2s auto-save debounce so the model is written to storage.
    await page.waitForTimeout(3000);

    await page.reload();
    await openFile(page);

    await page.getByRole('button', { name: 'Expand properties' }).click();
    await expect(page.getByLabel('Number (Priority)')).toHaveValue('7');
  });

  test('added dialog line survives auto-save and reload', async ({ page }) => {
    const dialogLineFields = page.getByLabel('Text');
    await expect(dialogLineFields).toHaveCount(3);

    await page.getByRole('button', { name: 'Add action' }).click();
    await page.getByRole('menuitem', { name: 'Dialog Line', exact: true }).click();
    await expect(dialogLineFields).toHaveCount(4);

    // A dialog line is only serialized if it has non-empty text.
    const newLine = dialogLineFields.last();
    await newLine.click();
    await newLine.fill('DIA_Arog_EntscheidungKillAlchemist_99_99');
    await newLine.blur();

    await page.waitForTimeout(3000);

    await page.reload();
    await openFile(page);

    await expect(page.getByLabel('Text')).toHaveCount(4);
  });
});
