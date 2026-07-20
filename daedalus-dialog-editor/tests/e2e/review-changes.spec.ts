import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Review-changes-before-save flow (feature-suggestions item 6).
 *
 * The "Review Changes" button in the dialog editor toolbar opens a dialog
 * showing a line diff of the file as loaded from disk against the code that
 * would be generated from the current semantic model; its Save button runs the
 * exact existing save path.
 *
 * Mock-harness constraint (see tests/e2e/README.md): the mock codegen only
 * round-trips dialog properties and AI_Output lines, so all diff/save content
 * assertions here are confined to AI_Output line counts.
 */

const SAMPLE_DIALOG_CONTENT = fs.readFileSync(
  path.join(__dirname, '../fixtures/sample-dialog.d'),
  'utf-8'
);

test.describe('Review changes before save', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_test-dialog.d', content);
    }, SAMPLE_DIALOG_CONTENT);

    page.on('dialog', async (dialog) => await dialog.accept('test-dialog.d'));

    await page.getByRole('button', { name: /Open Single File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });
    await page.getByText('SLD_99005_Arog').click();
    await page.getByRole('button', { name: /DIA_Arog_EntscheidungKillAlchemist/ }).click();
    await expect(
      page.getByRole('heading', { name: 'DIA_Arog_EntscheidungKillAlchemist', exact: true })
    ).toBeVisible();
  });

  test('shows the pending edit in the diff and saves through the dialog', async ({ page }) => {
    // Add a new dialog line so the generated code gains an AI_Output line
    // relative to the on-disk file (which has 3).
    const dialogLineFields = page.getByLabel('Text');
    await expect(dialogLineFields).toHaveCount(3);
    await page.getByRole('button', { name: 'Add action' }).click();
    await page.getByRole('menuitem', { name: 'Dialog Line', exact: true }).click();
    await expect(dialogLineFields).toHaveCount(4);

    // A dialog line is only serialized when it has non-empty text.
    const newLine = dialogLineFields.last();
    await newLine.click();
    await newLine.fill('REVIEW_CHANGES_NEW_LINE');
    await newLine.blur();

    await page.getByTestId('review-changes-button').click();
    const diff = page.getByTestId('review-changes-diff');
    await expect(diff).toBeVisible();

    // Diff sides: '-'/' ' lines belong to the on-disk version, '+'/' ' lines
    // to the editor version. The edit must be visible as one extra AI_Output
    // line on the editor side.
    const diffLines = ((await diff.textContent()) ?? '').split('\n');
    const beforeSide = diffLines.filter(
      (line) => (line.startsWith('-') || line.startsWith(' ')) && line.includes('AI_Output')
    ).length;
    const afterSide = diffLines.filter(
      (line) => (line.startsWith('+') || line.startsWith(' ')) && line.includes('AI_Output')
    ).length;
    expect(beforeSide).toBe(3);
    expect(afterSide).toBe(4);

    // Save from the review dialog: runs the normal save path and closes.
    await page.getByTestId('review-changes-save').click();
    await expect(page.getByTestId('review-changes-dialog')).toBeHidden();
    await expect(page.getByText('File saved successfully!')).toBeVisible();

    const saved = await page.evaluate(() => localStorage.getItem('mockapi_file_test-dialog.d'));
    expect((saved?.match(/AI_Output/g) ?? []).length).toBe(4);
  });

  test('Close leaves the file unsaved', async ({ page }) => {
    await page.getByTestId('review-changes-button').click();
    await expect(page.getByTestId('review-changes-diff')).toBeVisible();

    await page.getByTestId('review-changes-close').click();
    await expect(page.getByTestId('review-changes-dialog')).toBeHidden();
    await expect(page.getByText('File saved successfully!')).toBeHidden();
  });
});
