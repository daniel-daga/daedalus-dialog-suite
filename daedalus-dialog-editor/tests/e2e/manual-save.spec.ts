import { test, expect, Page } from '@playwright/test';

/**
 * Browser mock-harness specs for user-invoked save (Ctrl+S + app-bar Save
 * button). Auto-save has a 2 s debounce, so a save observed well inside that
 * window can only have come from the explicit save path. Per the harness
 * contract (tests/e2e/README.md) content assertions stay coarse: "the stored
 * bytes changed" — byte-exact codegen truth belongs to the Electron suite.
 */

const PROJECT_FILE_PATH = 'project/manual-save.d';
const ORIGINAL_TEXT_ID = 'DIA_ManualSave_Test_15_00';

const PROJECT_FILE_CONTENT = `// Manual save test file
INSTANCE DIA_ManualSave_Test(C_INFO)
{
\tnpc = PC_ManualSave_NPC;
\tnr = 1;
\tcondition = DIA_ManualSave_Test_Condition;
\tinformation = DIA_ManualSave_Test_Info;
\timportant = FALSE;
};

FUNC INT DIA_ManualSave_Test_Condition()
{
\treturn TRUE;
};

FUNC VOID DIA_ManualSave_Test_Info()
{
\tAI_Output(self, other, "${ORIGINAL_TEXT_ID}"); //Original line.
};
`;

const readSaved = (page: Page) =>
  page.evaluate(
    (path) => localStorage.getItem('mockapi_file_' + path),
    PROJECT_FILE_PATH
  );

async function openDialog(page: Page) {
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
  await expect(page.getByText('PC_ManualSave_NPC')).toBeVisible({ timeout: 15000 });

  await page.getByText('PC_ManualSave_NPC').click();
  await page.getByRole('button', { name: /DIA_ManualSave_Test/ }).click();
  await expect(page.getByRole('heading', { name: 'DIA_ManualSave_Test', exact: true })).toBeVisible();

  return page.getByLabel('Text').first();
}

test.describe('Manual save', () => {
  test('Ctrl+S flushes the pending edit and saves immediately', async ({ page }) => {
    const textField = await openDialog(page);
    await expect(textField).toHaveValue(ORIGINAL_TEXT_ID);

    // Type without blurring: the keystroke sits in the 300 ms component
    // debounce. Ctrl+S must flush it and save at once.
    await textField.click();
    await textField.fill('DIA_ManualSave_Test_EDITED');
    await page.keyboard.press('Control+s');

    // Well inside the auto-save window (edit commit + 2 s debounce), so only
    // the explicit save can have written this.
    await expect
      .poll(() => readSaved(page), { timeout: 1500 })
      .not.toBe(PROJECT_FILE_CONTENT);

    // The file is clean again: the save affordance goes passive — and stays
    // passive. Had Ctrl+S saved without flushing, the debounced keystroke
    // would commit ~300 ms later and re-dirty the file.
    await expect(page.getByTestId('appbar-save-button')).toBeDisabled();
    await page.waitForTimeout(700);
    await expect(page.getByTestId('appbar-save-button')).toBeDisabled();
  });

  test('app-bar Save button is disabled when clean, saves when dirty', async ({ page }) => {
    const textField = await openDialog(page);

    const saveButton = page.getByTestId('appbar-save-button');
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeDisabled();

    await textField.click();
    await textField.fill('DIA_ManualSave_Test_BUTTON');
    await page.keyboard.press('Tab');

    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    await expect
      .poll(() => readSaved(page), { timeout: 1500 })
      .not.toBe(PROJECT_FILE_CONTENT);
    await expect(saveButton).toBeDisabled();
  });

  test('Ctrl+S with nothing dirty is a silent no-op', async ({ page }) => {
    await openDialog(page);

    await page.keyboard.press('Control+s');
    await page.waitForTimeout(700);

    // Nothing was written and no error surfaced.
    expect(await readSaved(page)).toBe(PROJECT_FILE_CONTENT);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('appbar-save-button')).toBeDisabled();
  });
});
