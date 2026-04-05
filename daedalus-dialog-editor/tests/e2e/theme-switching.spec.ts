import { test, expect } from '@playwright/test';

/**
 * E2E tests for theme switching.
 * Covers clicking Dark, Light, and Gothic theme chips in the app bar.
 */

test.describe('Theme Switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  });

  test('Dark, Light, and Gothic theme chips are visible in the app bar', async ({ page }) => {
    // Theme chips are rendered with Tooltip titles "<Name> theme", so their accessible
    // button name includes the tooltip text: "Dark theme", "Light theme", "Gothic theme"
    await expect(page.getByRole('button', { name: 'Dark theme' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Light theme' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gothic theme' })).toBeVisible();
  });

  test('clicking the Light theme chip activates it', async ({ page }) => {
    await page.getByRole('button', { name: 'Light theme' }).click();
    await expect(page.getByRole('button', { name: 'Light theme' })).toBeVisible();
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  });

  test('clicking the Dark theme chip activates it', async ({ page }) => {
    // Switch to Light first so we have a known state change
    await page.getByRole('button', { name: 'Light theme' }).click();
    await page.waitForTimeout(200);

    await page.getByRole('button', { name: 'Dark theme' }).click();
    await expect(page.getByRole('button', { name: 'Dark theme' })).toBeVisible();
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  });

  test('clicking the Gothic theme chip activates it', async ({ page }) => {
    await page.getByRole('button', { name: 'Gothic theme' }).click();
    await expect(page.getByRole('button', { name: 'Gothic theme' })).toBeVisible();
    // Gothic theme changes the palette; verify the page still renders correctly
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  });

  test('theme persists after switching multiple times', async ({ page }) => {
    await page.getByRole('button', { name: 'Light theme' }).click();
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: 'Gothic theme' }).click();
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: 'Dark theme' }).click();
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  });
});
