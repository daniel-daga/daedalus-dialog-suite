import { test, expect, type Page } from '@playwright/test';

/**
 * E2E for the renderer error-boundary map (§2 blocker 6).
 *
 * A boundary is only worth anything if something actually throws inside the
 * subtree it guards, so these tests arm the real `CrashProbe` mounted in each
 * guarded subtree with `?crash=<id>` and drive the real UI. Two properties are
 * asserted everywhere: the crash produces a visible fallback instead of a blank
 * window, and it is *contained* — the rest of the window keeps working.
 *
 * The close guard gets its own test because its stakes are different: a crash
 * there happens after the guard has already acked the close request (which
 * cancels the main-process force-close timer) while the unsaved work exists
 * only in the renderer store. It must cancel, never approve.
 */

const PROJECT_FILE_PATH = 'project/boundary-guard.d';
const ORIGINAL_TEXT_ID = 'DIA_BoundaryGuard_Test_15_00';

const PROJECT_FILE_CONTENT = `// Error boundary test file
INSTANCE DIA_BoundaryGuard_Test(C_INFO)
{
\tnpc = PC_BoundaryGuard_NPC;
\tnr = 1;
\tcondition = DIA_BoundaryGuard_Test_Condition;
\tinformation = DIA_BoundaryGuard_Test_Info;
\timportant = FALSE;
};

FUNC INT DIA_BoundaryGuard_Test_Condition()
{
\treturn TRUE;
};

FUNC VOID DIA_BoundaryGuard_Test_Info()
{
\tAI_Output(self, other, "${ORIGINAL_TEXT_ID}"); //Original line.
};
`;

const readErrorLog = (page: Page) =>
  page.evaluate(
    () => ((window as any).__rendererErrorLog ?? []) as Array<{ message: string; stack?: string }>
  );

const readCloseGuardCalls = (page: Page) =>
  page.evaluate(
    () =>
      ((window as any).__closeGuardCalls ?? {
        ackCloseRequest: 0,
        approveClose: 0,
        cancelClose: 0,
      }) as Record<string, number>
  );

test.describe('Renderer error boundaries', () => {
  test('a toolbar crash shows a notice and leaves the workspace usable', async ({ page }) => {
    await page.goto('/?crash=chrome');

    await expect(page.getByTestId('chrome-crash-notice')).toBeVisible();

    // Contained: the window is not blank — the welcome screen below the AppBar
    // still renders, and its actions are still there.
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
    await expect(page.getByRole('button', { name: /Open Single File/i })).toBeVisible();

    const logged = await readErrorLog(page);
    expect(logged.some((entry) => entry.message.includes('[chrome]'))).toBe(true);
  });

  test('a workspace crash shows the fallback and leaves the toolbar usable', async ({ page }) => {
    await page.goto('/?crash=workspace');

    await expect(page.getByText('Something went wrong')).toBeVisible();

    // Contained the other way round: the AppBar survives a workspace crash.
    await expect(page.getByRole('banner').getByRole('button', { name: 'Open Project' })).toBeVisible();
    await expect(page.getByTestId('chrome-crash-notice')).toHaveCount(0);

    const logged = await readErrorLog(page);
    expect(logged.some((entry) => entry.message.includes('[workspace]'))).toBe(true);
  });

  test('an overlay-dialog crash is contained to the overlays', async ({ page }) => {
    await page.goto('/?crash=overlays');

    await expect(page.getByTestId('overlays-crash-notice')).toBeVisible();
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
    await expect(page.getByRole('banner').getByRole('button', { name: 'Open Project' })).toBeVisible();

    const logged = await readErrorLog(page);
    expect(logged.some((entry) => entry.message.includes('[overlays]'))).toBe(true);
  });

  test('an update-notification crash does not take down the window', async ({ page }) => {
    await page.goto('/?crash=updates');

    await expect(page.getByTestId('updates-crash-notice')).toBeVisible();
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();

    const logged = await readErrorLog(page);
    expect(logged.some((entry) => entry.message.includes('[updates]'))).toBe(true);
  });

  test('a crash in App itself is caught by the root boundary', async ({ page }) => {
    await page.goto('/?crash=app-root');

    await expect(page.getByText('Something went wrong')).toBeVisible();

    const logged = await readErrorLog(page);
    expect(logged.some((entry) => entry.message.includes('[app-root]'))).toBe(true);
  });

  test('a close-guard crash cancels the close and keeps the unsaved work', async ({ page }) => {
    await page.goto('/?crash=close-guard');
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
    await expect(page.getByText('PC_BoundaryGuard_NPC')).toBeVisible({ timeout: 15000 });

    await page.getByText('PC_BoundaryGuard_NPC').click();
    await page.getByRole('button', { name: /DIA_BoundaryGuard_Test/ }).click();
    await expect(
      page.getByRole('heading', { name: 'DIA_BoundaryGuard_Test', exact: true })
    ).toBeVisible();

    // Unsaved work: the whole point of the guard.
    const textField = page.getByLabel('Text').first();
    await expect(textField).toHaveValue(ORIGINAL_TEXT_ID);
    await textField.click();
    await textField.fill('DIA_BoundaryGuard_Test_EDITED');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    // The probe only throws once the guard dialog is actually rendering, so the
    // crash lands exactly where it matters: mid close-request, work unsaved.
    await page.evaluate(() => {
      const emit = (window as any).__mockEmitCloseRequested;
      if (typeof emit !== 'function') {
        throw new Error('__mockEmitCloseRequested hook is not installed');
      }
      emit();
    });

    await expect(page.getByTestId('close-guard-crash-notice')).toBeVisible();

    // The data-safety contract: never approve a close whose guard failed.
    // The ack proves the guard really engaged (and that the main process's
    // force-close timer is already cancelled) — i.e. the crash landed inside
    // the guard rather than short-circuiting before it.
    const calls = await readCloseGuardCalls(page);
    expect(calls.ackCloseRequest).toBe(1);
    expect(calls.approveClose).toBe(0);
    expect(calls.cancelClose).toBe(1);

    // The edit is still in the editor, and the editor is still usable.
    await expect(page.getByTestId('close-guard-dialog')).toHaveCount(0);
    await expect(textField).toHaveValue('DIA_BoundaryGuard_Test_EDITED');
    await expect(page.getByTestId('appbar-save-button')).toBeEnabled();

    const logged = await readErrorLog(page);
    expect(logged.some((entry) => entry.message.includes('[close-guard]'))).toBe(true);

    // Recovered: dismissing the notice stands the guard back up, so a later
    // close request is handled normally rather than silently doing nothing.
    await page.getByTestId('close-guard-crash-dismiss').click();
    await expect(page.getByTestId('close-guard-crash-notice')).toHaveCount(0);
  });
});
