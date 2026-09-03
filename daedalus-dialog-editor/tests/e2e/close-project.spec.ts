import { test, expect, Page } from '@playwright/test';

/**
 * Browser mock-harness specs for the app-bar "Close Project" action: it must
 * return the user to the welcome screen (previously unreachable after the
 * first open), guard unsaved changes with the same confirm flow as project
 * switching, and make the recent-projects list usable for reopening.
 */

const PROJECT_FILE_PATH = 'project/close-project.d';
const ORIGINAL_TEXT_ID = 'DIA_CloseProject_Test_15_00';

const PROJECT_FILE_CONTENT = `// Close project test file
INSTANCE DIA_CloseProject_Test(C_INFO)
{
\tnpc = PC_CloseProject_NPC;
\tnr = 1;
\tcondition = DIA_CloseProject_Test_Condition;
\tinformation = DIA_CloseProject_Test_Info;
\timportant = FALSE;
};

FUNC INT DIA_CloseProject_Test_Condition()
{
\treturn TRUE;
};

FUNC VOID DIA_CloseProject_Test_Info()
{
\tAI_Output(self, other, "${ORIGINAL_TEXT_ID}"); //Original line.
};
`;

async function seedAndShowWelcome(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();

  await page.evaluate(({ path, content }) => {
    localStorage.setItem('mockapi_file_' + path, content);
    localStorage.setItem(
      'recent_projects',
      JSON.stringify([{ path: 'project', name: 'project', lastOpened: Date.now() }])
    );
  }, { path: PROJECT_FILE_PATH, content: PROJECT_FILE_CONTENT });
}

async function openProject(page: Page) {
  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await expect(page.getByText('PC_CloseProject_NPC')).toBeVisible({ timeout: 15000 });
}

test.describe('Close Project', () => {
  test('closing a clean project returns to the welcome screen', async ({ page }) => {
    await seedAndShowWelcome(page);
    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('project folder path')) {
        await dialog.accept('project');
      } else {
        await dialog.dismiss();
      }
    });
    await openProject(page);

    await page.getByTestId('close-project-button').click();

    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
    // Single-file mode and the recent-projects list are reachable again.
    await expect(page.getByRole('button', { name: /Open Single File/i })).toBeVisible();
    await expect(page.getByText('Recent Projects')).toBeVisible();
  });

  test('a recent project can be reopened after closing', async ({ page }) => {
    await seedAndShowWelcome(page);
    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('project folder path')) {
        await dialog.accept('project');
      } else {
        await dialog.dismiss();
      }
    });
    await openProject(page);

    await page.getByTestId('close-project-button').click();
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();

    // Reopen via the recent-projects list (no folder prompt involved).
    await page.getByText('Recent Projects').waitFor();
    await page.getByRole('listitem').filter({ hasText: 'project' }).getByRole('button').first().click();

    await expect(page.getByText('PC_CloseProject_NPC')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Project: project')).toBeVisible();
  });

  async function makeUnsavedEdit(page: Page) {
    await page.getByText('PC_CloseProject_NPC').click();
    await page.getByRole('button', { name: /DIA_CloseProject_Test/ }).click();
    await expect(page.getByRole('heading', { name: 'DIA_CloseProject_Test', exact: true })).toBeVisible();
    const textField = page.getByLabel('Text').first();
    await textField.click();
    await textField.fill('DIA_CloseProject_Test_EDITED');
  }

  test('closing with unsaved changes asks for confirmation; cancel keeps the project open', async ({ page }) => {
    await seedAndShowWelcome(page);

    let nativeConfirms = 0;
    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('project folder path')) {
        await dialog.accept('project');
      } else {
        if (dialog.type() === 'confirm') nativeConfirms += 1;
        await dialog.dismiss();
      }
    });
    await openProject(page);
    await makeUnsavedEdit(page);

    // The guard is the in-app dialog, not a native confirm. Cancel keeps the
    // project open.
    await page.getByTestId('close-project-button').click();
    const guard = page.getByRole('dialog', { name: 'Unsaved changes' });
    await expect(guard).toBeVisible();
    await expect(guard).toContainText('close the project');
    await guard.getByRole('button', { name: 'Cancel' }).click();
    await expect(guard).toBeHidden();
    await expect(page.getByText('PC_CloseProject_NPC').first()).toBeVisible();
    await expect(page.getByText('Welcome to Dandelion')).toBeHidden();
    expect(nativeConfirms).toBe(0);

    // Discarding (or no guard at all if auto-save has since cleaned the file)
    // closes the project.
    await page.getByTestId('close-project-button').click();
    if (await guard.isVisible()) {
      await guard.getByRole('button', { name: 'Discard and continue' }).click();
    }
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  });

  test('switching projects with unsaved changes shows the in-app guard', async ({ page }) => {
    await seedAndShowWelcome(page);
    // The second folder prompt names another project so the guard reads
    // "switch", not "reload"; the mock index lists every seeded file
    // regardless of folder, so the same dialog is there after the switch.
    let folderPrompts = 0;
    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('project folder path')) {
        folderPrompts += 1;
        await dialog.accept(folderPrompts === 1 ? 'project' : 'other');
      } else {
        await dialog.dismiss();
      }
    });
    await openProject(page);
    await makeUnsavedEdit(page);

    await page.getByRole('button', { name: 'Open Project', exact: true }).click();
    const guard = page.getByRole('dialog', { name: 'Unsaved changes' });
    await expect(guard).toBeVisible();
    await expect(guard).toContainText('switch projects');
    // Cancel focused: Enter backs out, as in every other confirm.
    await expect(guard.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(guard).toBeHidden();
    await expect(page.getByLabel('Text').first()).toHaveValue('DIA_CloseProject_Test_EDITED');

    // Discarding reopens the project from disk: the edit is gone.
    await page.getByRole('button', { name: 'Open Project', exact: true }).click();
    await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: 'Discard and continue' }).click();
    await expect(guard).toBeHidden();
    await expect(page.getByText('Project: other')).toBeVisible({ timeout: 15000 });
    await page.getByText('PC_CloseProject_NPC', { exact: true }).click();
    await page.getByRole('button', { name: /^DIA_CloseProject_Test/ }).first().click();
    await expect(page.getByRole('heading', { name: 'DIA_CloseProject_Test', exact: true })).toBeVisible();
    await expect(page.getByLabel('Text').first()).toHaveValue(ORIGINAL_TEXT_ID);
  });
});
