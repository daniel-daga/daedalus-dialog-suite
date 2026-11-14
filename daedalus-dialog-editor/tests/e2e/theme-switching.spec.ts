import { test, expect } from '@playwright/test';

test.describe('Theme menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  });

  test('one compact control exposes all themes and supports keyboard dismissal', async ({ page }) => {
    const themeButton = page.getByRole('button', { name: 'Theme: Dark' });
    await expect(themeButton).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: 'Light theme' })).toHaveCount(0);
    await themeButton.click();
    for (const name of ['Dark', 'Light', 'Gothic']) {
      await expect(page.getByRole('menuitemradio', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('menuitemradio', { name: 'Dark', exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(themeButton).toBeFocused();
    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('switching themes updates the selected option and persists after reload', async ({ page }) => {
    for (const name of ['Light', 'Gothic', 'Dark', 'Light']) {
      await page.getByRole('button', { name: /^Theme:/ }).click();
      await page.getByRole('menuitemradio', { name, exact: true }).click();
      await expect(page.getByRole('menu')).toBeHidden();
      await expect(page.getByRole('button', { name: `Theme: ${name}` })).toBeVisible();
      await page.getByRole('button', { name: /^Theme:/ }).click();
      await expect(page.getByRole('menuitemradio', { name, exact: true })).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Escape');
    }
    await page.reload();
    await expect(page.getByRole('button', { name: 'Theme: Light' })).toBeVisible();
  });
});
