import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E tests for file opening and dialog selection
 * Tests run in browser mode using the mock API
 */

// Sample dialog file content
const SAMPLE_DIALOG_CONTENT = fs.readFileSync(
  path.join(__dirname, '../fixtures/sample-dialog.d'),
  'utf-8'
);

test.describe('File Opening and Dialog Selection', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Seed the mock file system with test data
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_test-dialog.d', content);
    }, SAMPLE_DIALOG_CONTENT);
  });

  test('should display welcome screen on initial load', async ({ page }) => {
    // Verify welcome screen elements
    await expect(page.getByRole('heading', { name: 'Welcome to Dandelion' })).toBeVisible();
    await expect(page.getByText('Gothic 2 Dialog Editor')).toBeVisible();
    await expect(page.getByRole('button', { name: /Open Dialog File/i })).toBeVisible();
    await expect(page.getByText('Have fun modding!')).toBeVisible();
  });

  test('should open file and display three-column layout', async ({ page }) => {
    // Mock the prompt that openFileDialog uses
    page.on('dialog', async dialog => {
      expect(dialog.type()).toBe('prompt');
      await dialog.accept('test-dialog.d');
    });

    // Click the "Open Dialog File" button
    await page.getByRole('button', { name: /Open Dialog File/i }).click();

    // Wait for the three-column layout to appear
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Dialogs' })).toBeVisible();

    // Verify NPC appears in list
    await expect(page.getByText('SLD_99005_Arog')).toBeVisible();
  });

  test('should select NPC and display associated dialogs', async ({ page }) => {
    // Mock prompt and open file
    page.on('dialog', async dialog => {
      await dialog.accept('test-dialog.d');
    });

    await page.getByRole('button', { name: /Open Dialog File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });

    // Click on the NPC
    await page.getByText('SLD_99005_Arog').click();

    // Verify the dialog appears in the dialog list
    await expect(page.getByRole('button', { name: /DIA_Arog_EntscheidungKillAlchemist/ })).toBeVisible();

    // The dialog should also show the count (use first() to avoid strict mode)
    await expect(page.getByText(/1 dialog/i).first()).toBeVisible();
  });

  test('should select dialog and display editor with properties', async ({ page }) => {
    // Mock prompt and open file
    page.on('dialog', async dialog => {
      await dialog.accept('test-dialog.d');
    });

    await page.getByRole('button', { name: /Open Dialog File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });

    // Click NPC
    await page.getByText('SLD_99005_Arog').click();

    // Click on the dialog
    await page.getByRole('button', { name: /DIA_Arog_EntscheidungKillAlchemist/ }).click();

    // Verify dialog editor appears with dialog name as heading
    await expect(page.getByRole('heading', { name: 'DIA_Arog_EntscheidungKillAlchemist', exact: true })).toBeVisible();

    // Verify Properties section
    await expect(page.getByText('Properties')).toBeVisible();

    // Verify action buttons are present
    await expect(page.getByRole('button', { name: /Add Line/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Add Choice/i })).toBeVisible();

    // Verify Save button is present
    await expect(page.getByRole('button', { name: /Save/i })).toBeVisible();
  });

  test('should display dialog actions', async ({ page }) => {
    // Mock prompt and open file
    page.on('dialog', async dialog => {
      await dialog.accept('test-dialog.d');
    });

    await page.getByRole('button', { name: /Open Dialog File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });

    // Navigate to dialog
    await page.getByText('SLD_99005_Arog').click();
    await page.getByRole('button', { name: /DIA_Arog_EntscheidungKillAlchemist/ }).click();

    // Wait for editor to load
    await expect(page.getByRole('heading', { name: 'DIA_Arog_EntscheidungKillAlchemist', exact: true })).toBeVisible();

    // The sample dialog has 3 AI_Output lines
    // They should be visible in the action cards
    await expect(page.getByText(/DIA_Arog_EntscheidungKillAlchemist_15_6/i)).toBeVisible();
    await expect(page.getByText(/DIA_Arog_EntscheidungKillAlchemist_5_6/i)).toBeVisible();
    await expect(page.getByText(/action_1762379701358_vj2uugnzi/i)).toBeVisible();
  });

  test('should use Open File button in app bar', async ({ page }) => {
    // Mock prompt
    page.on('dialog', async dialog => {
      await dialog.accept('test-dialog.d');
    });

    // Click the "Open File" button in the app bar (top right)
    await page.getByRole('button', { name: 'Open File' }).click();

    // Should open file and display layout
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('SLD_99005_Arog')).toBeVisible();
  });

  test('should persist file data in localStorage', async ({ page }) => {
    // Verify that the mock file system uses localStorage
    const storedContent = await page.evaluate(() => {
      return localStorage.getItem('mockapi_file_test-dialog.d');
    });

    expect(storedContent).toBe(SAMPLE_DIALOG_CONTENT);
  });
});

test.describe('Mock API Integration', () => {
  test('should detect browser mode and use mock API', async ({ page }) => {
    // Set up console listener BEFORE navigating
    const logs: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'log') {
        logs.push(msg.text());
      }
    });

    // Navigate to app
    await page.goto('/');

    // Wait a bit for console messages
    await page.waitForTimeout(1000);

    // Verify browser mode was detected
    expect(logs.some(log => log.includes('[Browser Mode] Using mock EditorAPI'))).toBeTruthy();
  });

  test('should have window.editorAPI available', async ({ page }) => {
    await page.goto('/');

    // Check that editorAPI is defined
    const hasAPI = await page.evaluate(() => {
      return typeof window.editorAPI !== 'undefined';
    });

    expect(hasAPI).toBeTruthy();
  });
});
