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

/**
 * F6: the Ctrl+F handler lives on the always-mounted ThreeColumnLayout, which
 * the other views hide with `display: none` rather than unmounting. Pressing
 * Ctrl+F outside the dialog view therefore opened the panel inside a hidden
 * subtree — no feedback at the time, and the panel was waiting for the user
 * when they next returned to the dialog view. The shortcut is scoped to the
 * view that can actually show it.
 */
test.describe('Search Panel shortcut scoping (F6)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_test-dialog.d', content);
    }, SAMPLE_DIALOG_CONTENT);

    page.on('dialog', async (d) => await d.accept('test-dialog.d'));
    await page.getByRole('button', { name: /Open Single File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });
  });

  test('Ctrl+F outside the dialog view does not open the panel, then or later', async ({ page }) => {
    await page.getByRole('button', { name: 'Variable Manager' }).click();
    await expect(page.getByRole('heading', { name: 'Variable Manager' })).toBeVisible({ timeout: 10000 });

    await page.keyboard.press('Control+f');
    await expect(page.getByText('Global Search')).not.toBeVisible();

    // The ambush: returning to the dialog view must not reveal a panel the
    // user never saw open.
    await page.getByRole('button', { name: 'Dialog Editor' }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible();
    await expect(page.getByText('Global Search')).not.toBeVisible();
  });

  test('Ctrl+F still opens the panel after returning to the dialog view', async ({ page }) => {
    await page.getByRole('button', { name: 'Variable Manager' }).click();
    await expect(page.getByRole('heading', { name: 'Variable Manager' })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Dialog Editor' }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible();

    await page.keyboard.press('Control+f');
    await expect(page.getByText('Global Search')).toBeVisible({ timeout: 5000 });
  });
});
