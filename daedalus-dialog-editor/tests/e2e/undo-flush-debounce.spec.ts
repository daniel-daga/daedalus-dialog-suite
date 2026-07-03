import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * fix-05 §2.3 (U4): pressing Ctrl+Z within the 300 ms edit debounce must flush
 * the in-flight edit as a normal history step first, so the first Ctrl+Z reverts
 * the just-typed text (and it stays reverted — no late timer re-applies it), and
 * Ctrl+Y restores it. Guards the real focus/keydown routing that jsdom cannot.
 */

const SAMPLE_DIALOG_CONTENT = fs.readFileSync(
  path.join(__dirname, '../fixtures/sample-dialog.d'),
  'utf-8'
);

test.describe('Ctrl+Z within the edit debounce window (U4)', () => {
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

  test('reverts the in-flight edit and Ctrl+Y restores it, with no phantom echo', async ({ page }) => {
    const firstTextField = page.getByLabel('Text').first();
    const originalValue = await firstTextField.inputValue();
    expect(originalValue.length).toBeGreaterThan(0);

    // Type new text and immediately press Ctrl+Z WITHOUT blurring/tabbing — the
    // 300 ms debounce is still pending, exactly the U4 race.
    await firstTextField.click();
    await firstTextField.fill('In-flight edit before undo');
    await page.keyboard.press('Control+z');

    // The first Ctrl+Z reverts the in-flight text (the flush committed it, then
    // undo reverted it).
    await expect(page.getByLabel('Text').first()).toHaveValue(originalValue);

    // Wait past the debounce window: a late timer must NOT re-apply the text.
    await page.waitForTimeout(500);
    await expect(page.getByLabel('Text').first()).toHaveValue(originalValue);

    // Ctrl+Y restores the flushed edit.
    await page.keyboard.press('Control+y');
    await expect(page.getByLabel('Text').first()).toHaveValue('In-flight edit before undo');
  });
});
