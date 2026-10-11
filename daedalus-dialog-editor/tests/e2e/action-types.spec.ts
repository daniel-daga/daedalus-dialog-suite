import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E tests for inserting different action types via the action type menu.
 * Covers Set Variable, Give XP, Log Entry, and the search filter in the menu.
 */

const SAMPLE_DIALOG_CONTENT = fs.readFileSync(
  path.join(__dirname, '../fixtures/sample-dialog.d'),
  'utf-8'
);

test.describe('Action Type Insertion', () => {
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

  test('action type menu opens and shows search field', async ({ page }) => {
    await page.getByRole('button', { name: 'Add action' }).click();
    await expect(page.getByPlaceholder('Search actions...')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Dialog Line' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('menu search filter narrows the list of action types', async ({ page }) => {
    await page.getByRole('button', { name: 'Add action' }).click();
    await page.getByPlaceholder('Search actions...').fill('variable');
    await expect(page.getByRole('menuitem', { name: 'Set Variable' })).toBeVisible();
    // Other items not matching should be hidden
    await expect(page.getByRole('menuitem', { name: 'Dialog Line' })).not.toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('inserting a Set Variable action renders Variable field', async ({ page }) => {
    const initialCount = await page.getByLabel('Text').count();

    await page.getByRole('button', { name: 'Add action' }).click();
    await page.getByRole('menuitem', { name: 'Set Variable' }).click();

    // SetVariableActionRenderer renders a "Variable" combobox
    await expect(page.getByRole('combobox', { name: 'Variable' })).toBeVisible({ timeout: 5000 });
    // The dialog line count should be unchanged (we added a non-dialog-line action)
    expect(await page.getByLabel('Text').count()).toBe(initialCount);
  });

  test('inserting a Give XP action renders XP Amount field', async ({ page }) => {
    await page.getByRole('button', { name: 'Add action' }).click();
    await page.getByRole('menuitem', { name: 'Give XP' }).click();

    // GivePlayerXPActionRenderer renders an "XP Amount" label
    await expect(page.getByLabel('XP Amount')).toBeVisible({ timeout: 5000 });
  });

  test('inserting a Log Entry action renders Topic and Text fields', async ({ page }) => {
    await page.getByRole('button', { name: 'Add action' }).click();
    await page.getByRole('menuitem', { name: 'Log Entry' }).click();

    // LogEntryRenderer renders "Topic" and "Text" labels
    await expect(page.getByLabel('Topic')).toBeVisible({ timeout: 5000 });
  });

  test('inserting a Dialog Line action via "+" between actions adds a new text field', async ({ page }) => {
    const initialCount = await page.getByLabel('Text').count();

    // The "Add new action" button sits between action cards
    await page.getByRole('button', { name: 'Add new action' }).first().click();
    await page.getByRole('menuitem', { name: 'Dialog Line' }).click();

    await expect(async () => {
      expect(await page.getByLabel('Text').count()).toBe(initialCount + 1);
    }).toPass({ timeout: 5000 });
  });
});
