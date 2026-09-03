import { test, expect } from '@playwright/test';

/**
 * E2E for the window-close guard (E1).
 *
 * The mock harness has no real Electron window, so the mock API captures the
 * close-requested callback and exposes `window.__mockEmitCloseRequested`, and
 * records the guard's ack/approve/cancel signals on `window.__closeGuardCalls`
 * (see mockAPI.ts). We open a project file, make an unsaved edit, then inject a
 * close request to drive the real close-guard dialog and exercise its choices.
 *
 * Real-Electron close coverage (the actual OS window `close` + main-process
 * veto/force-destroy) is deferred to slice 8's `_electron` suite.
 */

const PROJECT_FILE_PATH = 'project/close-guard.d';
const ORIGINAL_TEXT_ID = 'DIA_CloseGuard_Test_15_00';

const PROJECT_FILE_CONTENT = `// Close guard test file
INSTANCE DIA_CloseGuard_Test(C_INFO)
{
\tnpc = PC_CloseGuard_NPC;
\tnr = 1;
\tcondition = DIA_CloseGuard_Test_Condition;
\tinformation = DIA_CloseGuard_Test_Info;
\timportant = FALSE;
};

FUNC INT DIA_CloseGuard_Test_Condition()
{
\treturn TRUE;
};

FUNC VOID DIA_CloseGuard_Test_Info()
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
  await expect(page.getByText('PC_CloseGuard_NPC')).toBeVisible({ timeout: 15000 });

  await page.getByText('PC_CloseGuard_NPC').click();
  await page.getByRole('button', { name: /DIA_CloseGuard_Test/ }).click();
  await expect(page.getByRole('heading', { name: 'DIA_CloseGuard_Test', exact: true })).toBeVisible();

  // Make an unsaved edit so the file is dirty when the close is requested.
  const textField = page.getByLabel('Text').first();
  await expect(textField).toHaveValue(ORIGINAL_TEXT_ID);
  await textField.click();
  await textField.fill('DIA_CloseGuard_Test_EDITED');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);

  return textField;
}

async function requestClose(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const emit = (window as any).__mockEmitCloseRequested;
    if (typeof emit !== 'function') {
      throw new Error('__mockEmitCloseRequested hook is not installed');
    }
    emit();
  });
}

const readCalls = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as any).__closeGuardCalls ?? { ackCloseRequest: 0, approveClose: 0, cancelClose: 0 });

test.describe('Window close guard', () => {
  test('shows the guard dialog and acknowledges when a dirty file is open', async ({ page }) => {
    await openDialogAndMakeDirty(page);
    await requestClose(page);

    await expect(page.getByTestId('close-guard-dialog')).toBeVisible();
    await expect(page.getByTestId('close-guard-save')).toBeVisible();
    await expect(page.getByTestId('close-guard-discard')).toBeVisible();
    await expect(page.getByTestId('close-guard-cancel')).toBeVisible();

    // The guard acked the request but has not approved the close.
    const calls = await readCalls(page);
    expect(calls.ackCloseRequest).toBeGreaterThan(0);
    expect(calls.approveClose).toBe(0);
  });

  test('the close guard focuses its default action', async ({ page }) => {
    await openDialogAndMakeDirty(page);
    await requestClose(page);

    const dialog = page.getByTestId('close-guard-dialog');
    await expect(dialog).toBeVisible();
    // Save-and-close loses nothing, so it is where Enter lands; the dialog
    // is described by its body text for assistive tech.
    await expect(page.getByTestId('close-guard-save')).toBeFocused();
    await expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toHaveAttribute(
      'aria-describedby', 'close-guard-description'
    );
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await readCalls(page)).approveClose).toBeGreaterThan(0);
  });

  test('"Cancel" cancels the close and dismisses the dialog', async ({ page }) => {
    await openDialogAndMakeDirty(page);
    await requestClose(page);

    await expect(page.getByTestId('close-guard-dialog')).toBeVisible();
    await page.getByTestId('close-guard-cancel').click();

    await expect(page.getByTestId('close-guard-dialog')).toBeHidden();
    const calls = await readCalls(page);
    expect(calls.cancelClose).toBeGreaterThan(0);
    expect(calls.approveClose).toBe(0);
  });

  test('"Save and close" saves the dirty file then approves the close', async ({ page }) => {
    await openDialogAndMakeDirty(page);
    await requestClose(page);

    await expect(page.getByTestId('close-guard-dialog')).toBeVisible();
    await page.getByTestId('close-guard-save').click();

    await expect(page.getByTestId('close-guard-dialog')).toBeHidden();
    // The close was approved only because the save succeeded — a failed save
    // keeps the dialog open and never approves.
    await expect.poll(async () => (await readCalls(page)).approveClose).toBeGreaterThan(0);

    // The save rewrote the file through the (mock) code generator — it is no
    // longer byte-identical to the original on-disk content. (The mock harness
    // codegen cannot round-trip the edited text id (T7); the real-Electron
    // suite in slice 8 asserts the edited bytes.)
    const saved = await page.evaluate(
      (path) => localStorage.getItem('mockapi_file_' + path),
      PROJECT_FILE_PATH
    );
    expect(saved).not.toBe(PROJECT_FILE_CONTENT);
  });

  test('"Close without saving" approves the close without persisting the edit', async ({ page }) => {
    await openDialogAndMakeDirty(page);
    await requestClose(page);

    await expect(page.getByTestId('close-guard-dialog')).toBeVisible();
    await page.getByTestId('close-guard-discard').click();

    await expect(page.getByTestId('close-guard-dialog')).toBeHidden();
    const calls = await readCalls(page);
    expect(calls.approveClose).toBeGreaterThan(0);

    const saved = await page.evaluate(
      (path) => localStorage.getItem('mockapi_file_' + path),
      PROJECT_FILE_PATH
    );
    expect(saved).toBe(PROJECT_FILE_CONTENT);
  });
});
