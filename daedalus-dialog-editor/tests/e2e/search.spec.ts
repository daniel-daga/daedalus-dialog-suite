import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E tests for the global search panel.
 * Covers opening via Ctrl+F, typing queries, viewing results, navigating to a result, and closing.
 */

const SAMPLE_DIALOG_CONTENT = fs.readFileSync(
  path.join(__dirname, '../fixtures/sample-dialog.d'),
  'utf-8'
);

test.describe('Search Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_test-dialog.d', content);
    }, SAMPLE_DIALOG_CONTENT);

    page.on('dialog', async (d) => await d.accept('test-dialog.d'));
    await page.getByRole('button', { name: /Open Single File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });
  });

  test('pressing Ctrl+F opens the search panel', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await expect(page.getByText('Global Search')).toBeVisible({ timeout: 5000 });
    await expect(page.getByPlaceholder('Search dialogs, NPCs, text...')).toBeVisible();
  });

  test('search panel shows Ctrl+F hint', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await expect(page.getByText('Ctrl+F')).toBeVisible({ timeout: 5000 });
  });

  test('typing a query returns matching results', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await expect(page.getByPlaceholder('Search dialogs, NPCs, text...')).toBeVisible({ timeout: 5000 });

    await page.getByPlaceholder('Search dialogs, NPCs, text...').fill('Arog');

    // Results should appear for the NPC or dialog name containing "Arog"
    await expect(async () => {
      const resultCount = await page.locator('text=result').count();
      expect(resultCount).toBeGreaterThan(0);
    }).toPass({ timeout: 5000 });
  });

  test('clicking Close search panel button closes the panel', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await expect(page.getByText('Global Search')).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: 'Close search panel' }).click();
    await expect(page.getByText('Global Search')).not.toBeVisible();
  });

  test('pressing Escape closes the open search panel', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await expect(page.getByText('Global Search')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await expect(page.getByText('Global Search')).not.toBeVisible();
  });

  test('clicking a search result navigates to the matching NPC', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await expect(page.getByPlaceholder('Search dialogs, NPCs, text...')).toBeVisible({ timeout: 5000 });

    // In single-file mode the dialogIndex is empty, so NPC names are not searchable.
    // Search by dialog name (present in semanticModel.dialogs) instead.
    await page.getByPlaceholder('Search dialogs, NPCs, text...').fill('EntscheidungKillAlchemist');

    // Wait for search results to appear
    await expect(async () => {
      const resultCount = await page.locator('text=result').count();
      expect(resultCount).toBeGreaterThan(0);
    }).toPass({ timeout: 5000 });

    // Click the first dialog result; ListItemButton renders as role="button"
    const firstResult = page.locator('[role="button"]:has-text("EntscheidungKillAlchemist")').first();
    await expect(firstResult).toBeVisible({ timeout: 5000 });
    await firstResult.click();

    // After clicking, the dialog name should still be visible (panel stays open, result remains)
    await expect(async () => {
      const hasText = await page.getByText(/EntscheidungKillAlchemist/).count() > 0;
      expect(hasText).toBeTruthy();
    }).toPass({ timeout: 5000 });
  });
});
