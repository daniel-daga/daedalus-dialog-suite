import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E tests for dialog properties section editing.
 * Covers expand/collapse, field editing, and checkbox toggles.
 */

const SAMPLE_DIALOG_CONTENT = fs.readFileSync(
  path.join(__dirname, '../fixtures/sample-dialog.d'),
  'utf-8'
);

test.describe('Dialog Properties Editing', () => {
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

  test('properties panel is collapsed by default', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Expand properties' })).toBeVisible();
    await expect(page.getByLabel('Number (Priority)')).not.toBeVisible();
  });

  test('shows NPC chip when panel is collapsed', async ({ page }) => {
    await expect(page.getByText(/NPC: SLD_99005_Arog/)).toBeVisible();
  });

  test('expands properties panel to reveal all fields', async ({ page }) => {
    await page.getByRole('button', { name: 'Expand properties' }).click();
    await expect(page.getByRole('button', { name: 'Collapse properties' })).toBeVisible();
    await expect(page.getByLabel('Number (Priority)')).toBeVisible();
    await expect(page.getByLabel('Important')).toBeVisible();
    await expect(page.getByLabel('Permanent')).toBeVisible();
  });

  test('collapses properties panel to hide fields', async ({ page }) => {
    await page.getByRole('button', { name: 'Expand properties' }).click();
    await expect(page.getByLabel('Number (Priority)')).toBeVisible();

    await page.getByRole('button', { name: 'Collapse properties' }).click();
    await expect(page.getByLabel('Number (Priority)')).not.toBeVisible();
  });

  test('can edit the Number (Priority) field', async ({ page }) => {
    await page.getByRole('button', { name: 'Expand properties' }).click();
    const nrField = page.getByLabel('Number (Priority)');
    await nrField.fill('7');
    await expect(nrField).toHaveValue('7');
  });

  test('Important checkbox reflects dialog state and can be toggled', async ({ page }) => {
    await page.getByRole('button', { name: 'Expand properties' }).click();
    // sample-dialog.d has important = TRUE
    const importantCheckbox = page.getByLabel('Important');
    await expect(importantCheckbox).toBeChecked();
    await importantCheckbox.click();
    await expect(importantCheckbox).not.toBeChecked();
  });

  test('Permanent checkbox can be toggled', async ({ page }) => {
    await page.getByRole('button', { name: 'Expand properties' }).click();
    const permanentCheckbox = page.getByLabel('Permanent');
    await expect(permanentCheckbox).not.toBeChecked();
    await permanentCheckbox.click();
    await expect(permanentCheckbox).toBeChecked();
  });
});
