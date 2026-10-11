import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E tests for the Source Code View dialog.
 * Covers opening via the "View Source" button and closing the dialog.
 */

const SAMPLE_DIALOG_CONTENT = fs.readFileSync(
  path.join(__dirname, '../fixtures/sample-dialog.d'),
  'utf-8'
);

test.describe('Source Code View', () => {
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
  });

  test('View Source button is present in the editor toolbar', async ({ page }) => {
    await expect(page.getByRole('button', { name: /View Source/i })).toBeVisible();
  });

  test('clicking View Source opens the source view dialog', async ({ page }) => {
    await page.getByRole('button', { name: /View Source/i }).click();

    // Dialog title includes "Source Code: <dialogName>"
    await expect(
      page.getByText('Source Code: DIA_Arog_EntscheidungKillAlchemist')
    ).toBeVisible({ timeout: 5000 });
  });

  test('source view dialog has a Close button', async ({ page }) => {
    await page.getByRole('button', { name: /View Source/i }).click();
    await expect(
      page.getByText('Source Code: DIA_Arog_EntscheidungKillAlchemist')
    ).toBeVisible({ timeout: 5000 });

    await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  });

  test('clicking Close dismisses the source view dialog', async ({ page }) => {
    await page.getByRole('button', { name: /View Source/i }).click();
    await expect(
      page.getByText('Source Code: DIA_Arog_EntscheidungKillAlchemist')
    ).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(
      page.getByText('Source Code: DIA_Arog_EntscheidungKillAlchemist')
    ).not.toBeVisible();
  });

  test('source view dialog has a copy button', async ({ page }) => {
    await page.getByRole('button', { name: /View Source/i }).click();
    await expect(
      page.getByText('Source Code: DIA_Arog_EntscheidungKillAlchemist')
    ).toBeVisible({ timeout: 5000 });

    await expect(page.getByRole('button', { name: 'Copy to clipboard' })).toBeVisible();
  });
});

/**
 * The renderer ships a strict `default-src 'self'` CSP (security-model.md), and
 * Monaco is served from the app's own origin rather than the jsdelivr CDN.
 *
 * These assert the thing the CSP could break and the CDN could stall: the
 * editor actually mounts and shows the generated source. The dialog's title and
 * buttons above render fine with no Monaco at all, so they cannot catch it.
 */
test.describe('Source Code View — Monaco loads under the CSP', () => {
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
  });

  test('the Monaco editor mounts and renders the generated source', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('Content Security Policy')) violations.push(msg.text());
    });

    await page.getByRole('button', { name: /View Source/i }).click();
    await expect(
      page.getByText('Source Code: DIA_Arog_EntscheidungKillAlchemist')
    ).toBeVisible({ timeout: 5000 });

    // Monaco's own DOM, not the MUI dialog chrome around it.
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 15000 });
    // ...actually showing the dialog's code, so a bare shell cannot pass.
    await expect(
      page.locator('.monaco-editor').getByText('DIA_Arog_EntscheidungKillAlchemist').first()
    ).toBeVisible({ timeout: 15000 });

    expect(violations).toEqual([]);
  });
});
