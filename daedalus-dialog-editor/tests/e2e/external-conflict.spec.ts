import { test, expect } from '@playwright/test';

/**
 * E2E for the external-change conflict flow (E4).
 *
 * The mock harness has no real file watcher, so the mock API captures the
 * change callback and exposes `window.__mockEmitFileChange` (see mockAPI.ts).
 * We open a project file, make an unsaved edit, then inject a `change` event to
 * drive the ExternalChangeConflictDialog and exercise both resolutions against
 * the visible UI.
 */

const PROJECT_FILE_PATH = 'project/test.d';
const ORIGINAL_TEXT_ID = 'DIA_ExtConflict_Test_15_00';

const PROJECT_FILE_CONTENT = `// External conflict test file
INSTANCE DIA_ExtConflict_Test(C_INFO)
{
\tnpc = PC_ExtConflict_NPC;
\tnr = 1;
\tcondition = DIA_ExtConflict_Test_Condition;
\tinformation = DIA_ExtConflict_Test_Info;
\timportant = FALSE;
};

FUNC INT DIA_ExtConflict_Test_Condition()
{
\treturn TRUE;
};

FUNC VOID DIA_ExtConflict_Test_Info()
{
\tAI_Output(self, other, "${ORIGINAL_TEXT_ID}"); //Original line.
};
`;

async function openDialogAndMakeDirty(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();

  await page.evaluate(({ path, content }) => {
    localStorage.setItem('mockapi_file_' + path, content);
  }, { path: PROJECT_FILE_PATH, content: PROJECT_FILE_CONTENT });

  page.on('dialog', async (dialog) => {
    if (dialog.message().includes('project folder path')) {
      await dialog.accept('project');
    } else {
      await dialog.dismiss();
    }
  });

  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await expect(page.getByText('PC_ExtConflict_NPC')).toBeVisible({ timeout: 15000 });

  await page.getByText('PC_ExtConflict_NPC').click();
  await page.getByRole('button', { name: /DIA_ExtConflict_Test/ }).click();
  await expect(page.getByRole('heading', { name: 'DIA_ExtConflict_Test', exact: true })).toBeVisible();

  // Make an unsaved edit so the file is dirty when the external change lands.
  const textField = page.getByLabel('Text').first();
  await expect(textField).toHaveValue(ORIGINAL_TEXT_ID);
  await textField.click();
  await textField.fill('DIA_ExtConflict_Test_EDITED');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);

  return textField;
}

async function injectExternalChange(page: import('@playwright/test').Page) {
  await page.evaluate((filePath) => {
    const emit = (window as any).__mockEmitFileChange;
    if (typeof emit !== 'function') {
      throw new Error('__mockEmitFileChange hook is not installed');
    }
    emit({ type: 'change', filePath });
  }, PROJECT_FILE_PATH);
}

test.describe('External change conflict', () => {
  test('shows the conflict dialog when the open dirty file changes on disk', async ({ page }) => {
    await openDialogAndMakeDirty(page);
    await injectExternalChange(page);

    await expect(
      page.getByText(/changed on disk while you have unsaved changes/i)
    ).toBeVisible();
    await expect(page.getByTestId('external-conflict-keep-mine')).toBeVisible();
    await expect(page.getByTestId('external-conflict-reload')).toBeVisible();
  });

  test('"Reload from disk" discards the edit and closes the dialog', async ({ page }) => {
    const textField = await openDialogAndMakeDirty(page);
    await injectExternalChange(page);

    await expect(page.getByTestId('external-conflict-reload')).toBeVisible();
    await page.getByTestId('external-conflict-reload').click();

    // Dialog closes and the editor reverts to the on-disk content.
    await expect(page.getByTestId('external-conflict-reload')).toBeHidden();
    await expect(textField).toHaveValue(ORIGINAL_TEXT_ID);
  });

  test('"Keep mine" overwrites disk and closes the dialog', async ({ page }) => {
    const textField = await openDialogAndMakeDirty(page);
    await injectExternalChange(page);

    await expect(page.getByTestId('external-conflict-keep-mine')).toBeVisible();
    await page.getByTestId('external-conflict-keep-mine').click();

    // Dialog closes; the editor keeps the user's edit.
    await expect(page.getByTestId('external-conflict-keep-mine')).toBeHidden();
    await expect(textField).toHaveValue('DIA_ExtConflict_Test_EDITED');
  });
});
