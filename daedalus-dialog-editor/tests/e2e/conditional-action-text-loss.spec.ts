import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression tests for issue #145: typing inside an If/Else block and then
 * using "Add Line" must never drop text the user already entered — neither
 * from the block's Condition field nor from nested dialog lines.
 */

const SAMPLE_DIALOG_CONTENT = fs.readFileSync(
  path.join(__dirname, '../fixtures/sample-dialog.d'),
  'utf-8'
);

async function openSampleDialog(page: Page) {
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
}

async function addConditionalBlock(page: Page) {
  await page.getByRole('button', { name: 'Add action' }).click();
  await page.getByPlaceholder('Search actions...').fill('If / Else Block');
  await page.getByRole('menuitem', { name: 'If / Else Block', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Condition' })).toBeVisible({ timeout: 5000 });
}

test.describe('Conditional action text preservation (#145)', () => {
  test.beforeEach(async ({ page }) => {
    await openSampleDialog(page);
  });

  test('condition text survives an immediate "Add Line" into the then branch', async ({ page }) => {
    await addConditionalBlock(page);

    const condition = page.getByRole('textbox', { name: 'Condition' });
    await condition.click();
    // Type and click "Add Line" while the 300ms debounce is still pending.
    await condition.pressSequentially('MIS_Test == LOG_RUNNING');
    await page.getByRole('button', { name: 'Add Line' }).first().click();

    await page.waitForTimeout(500);
    await expect(condition).toHaveValue('MIS_Test == LOG_RUNNING');
    // The new nested line must exist (then branch no longer empty).
    await expect(page.getByText('No actions in this branch.')).toHaveCount(1);
  });

  test('nested line text survives adding a line into the other branch', async ({ page }) => {
    await addConditionalBlock(page);

    // Add a line to the then-branch and type into it.
    await page.getByRole('button', { name: 'Add Line' }).first().click();
    const dialogLineFields = page.getByLabel('Text');
    await expect(dialogLineFields).toHaveCount(4);

    const nestedLine = dialogLineFields.nth(3);
    await nestedLine.click();
    await nestedLine.pressSequentially('Hello from the then branch');

    // Immediately add a line into the else branch (within the debounce window).
    await page.getByRole('button', { name: 'Add Line' }).first().click();
    await page.waitForTimeout(500);

    await expect(page.getByLabel('Text')).toHaveCount(5);
    await expect(dialogLineFields.nth(3)).toHaveValue('Hello from the then branch');
  });

  test('nested line text survives editing the condition afterwards', async ({ page }) => {
    await addConditionalBlock(page);

    await page.getByRole('button', { name: 'Add Line' }).first().click();
    const nestedLine = page.getByLabel('Text').nth(3);
    await nestedLine.click();
    await nestedLine.pressSequentially('Persistent line');

    // Move straight into the condition field and type while the nested
    // line's debounce may still be pending.
    const condition = page.getByRole('textbox', { name: 'Condition' });
    await condition.click();
    await condition.pressSequentially('Npc_KnowsInfo(other, DIA_Arog_Hallo)');

    // Add a line to the else branch immediately.
    await page.getByRole('button', { name: 'Add Line' }).first().click();
    await page.waitForTimeout(500);

    await expect(condition).toHaveValue('Npc_KnowsInfo(other, DIA_Arog_Hallo)');
    await expect(page.getByLabel('Text').nth(3)).toHaveValue('Persistent line');
  });

  test('text typed into a new nested line survives pressing Enter to add another', async ({ page }) => {
    await addConditionalBlock(page);

    await page.getByRole('button', { name: 'Add Line' }).first().click();
    const nestedLine = page.getByLabel('Text').nth(3);
    await nestedLine.click();
    await nestedLine.pressSequentially('First nested line');
    await nestedLine.press('Enter');

    await page.waitForTimeout(500);
    // Enter adds a sibling line inside the same branch.
    await expect(page.getByLabel('Text')).toHaveCount(5);
    await expect(page.getByLabel('Text').nth(3)).toHaveValue('First nested line');
    await expect(page.getByLabel('Text').nth(4)).toHaveValue('');
  });
});
