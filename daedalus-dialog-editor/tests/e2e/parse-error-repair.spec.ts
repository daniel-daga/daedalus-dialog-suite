import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('mockapi_file_repair/broken.d', '//__MOCK_MODEL__' + JSON.stringify({
      hasErrors: true,
      errors: [{ type: 'duplicate_declaration', message: 'Duplicate declaration of function Test',
        position: { row: 40, column: 1 }, text: 'Test' }],
    }));
    window.editorAPI.openScriptInExternalEditor = async (filePath) => {
      localStorage.setItem('external-editor-file', filePath);
    };
    const buildIndex = window.editorAPI.buildProjectIndex.bind(window.editorAPI);
    window.editorAPI.buildProjectIndex = async (folderPath) => ({
      ...await buildIndex(folderPath),
      parseErrors: [{ filePath: 'repair/broken.d', total: 1,
        errors: [{ message: 'Duplicate declaration of function Test', line: 40, column: 1 }] }],
    });
  });
  page.on('dialog', async (dialog) => {
    if (dialog.message().includes('project folder path')) await dialog.accept('repair');
    else await dialog.dismiss();
  });
  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await page.getByTestId('problems-toggle').click();
  await page.getByTestId('problem-row-0').click();
});

test('keeps error details in Problems and leaves the Dialog Editor usable', async ({ page }) => {
  await expect(page.getByTestId('problems-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('problems-panel').getByRole('heading', { name: 'broken.d', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dialog Editor', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'NPCs', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'broken.d', exact: true })).toBeHidden();
  await page.getByTestId('problems-toggle').click();
  await page.getByTestId('problem-row-0').click();
  await page.getByRole('button', { name: 'Back to problems', exact: true }).click();
  await expect(page.getByTestId('problem-row-0')).toBeVisible();
});

test('offers one file-focused error view, external editing and reload', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'broken.d', exact: true })).toBeVisible();
  await expect(page.getByText('repair/broken.d', { exact: true })).toBeVisible();
  await expect(page.getByText(/Opened with \d+ parse error/)).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Parse errors (1)' })).toBeVisible();
  await expect(page.getByText('Line 40, Column 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit externally' }).click();
  expect(await page.evaluate(() => localStorage.getItem('external-editor-file'))).toBe('repair/broken.d');

  await page.evaluate(() => {
    localStorage.setItem('mockapi_file_repair/broken.d', 'FUNC VOID Test() {};');
  });
  await page.getByRole('button', { name: 'Reload file', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Parse errors (1)' })).toBeHidden();
  await expect(page.getByTestId('problems-panel')).toBeVisible();
  await expect(page.getByTestId('problems-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('keeps the findings visible when the external editor cannot open', async ({ page }) => {
  await page.evaluate(() => {
    window.editorAPI.openScriptInExternalEditor = async () => { throw new Error('No application associated with .d'); };
  });
  await page.getByRole('button', { name: 'Edit externally' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'No application associated with .d' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Parse errors (1)' })).toBeVisible();
});

test('reload keeps unresolved errors in Problems and reports read failures', async ({ page }) => {
  await page.getByRole('button', { name: 'Reload file', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Parse errors (1)' })).toBeVisible();
  await expect(page.getByTestId('problems-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    window.editorAPI.indexFile = async () => { throw new Error('File unavailable'); };
  });
  await page.getByRole('button', { name: 'Reload file', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not reload the script file.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Parse errors (1)' })).toBeVisible();
});
