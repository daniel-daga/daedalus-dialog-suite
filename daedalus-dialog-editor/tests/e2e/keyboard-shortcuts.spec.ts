import { test, expect } from '@playwright/test';

/**
 * The keyboard-shortcuts sheet (#275): the app's one piece of in-app help.
 * Every shortcut used to be a window listener with no menu item and no legend,
 * so the only way to learn one was to read the source.
 */

test.describe('Keyboard shortcuts sheet', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  });

  test('the Help button opens the sheet, grouped by surface', async ({ page }) => {
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();

    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Everywhere' })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Dialog editor' })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'World editor' })).toBeVisible();

    // One row from each group, keys and action together.
    await expect(sheet.getByRole('row', { name: /Ctrl\+S.*Save/ })).toBeVisible();
    await expect(sheet.getByRole('row', { name: /Ctrl\+Enter.*Add an action/ })).toBeVisible();
    // Ctrl+D was the one World chord the old idle-screen legend had missed.
    await expect(sheet.getByRole('row', { name: /Ctrl\+D.*Duplicate/ })).toBeVisible();

    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
  });

  test('F1 opens the sheet and Escape closes it', async ({ page }) => {
    await page.keyboard.press('F1');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });
});
