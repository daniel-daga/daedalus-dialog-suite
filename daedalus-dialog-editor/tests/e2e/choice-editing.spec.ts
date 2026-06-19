import { test, expect } from '@playwright/test';

/**
 * E2E tests for choice / branch creation and editing.
 * Adds a Choice action via the action type menu and verifies the renderer.
 */

const DIALOG_FILE = `INSTANCE DIA_Choice_Test(C_INFO)
{
\tnpc = SLD_77777_Choicetest;
\tnr = 1;
\tcondition = DIA_Choice_Test_Condition;
\tinformation = DIA_Choice_Test_Info;
\timportant = FALSE;
};

FUNC INT DIA_Choice_Test_Condition()
{
\treturn TRUE;
};

FUNC VOID DIA_Choice_Test_Info()
{
\tAI_Output(self, other, "DIA_Choice_Test_15_00"); //Hello, what do you want?
};
`;

const PROJECT_DIALOG_FILE = `INSTANCE DIA_ChoiceProj_Test(C_INFO)
{
\tnpc = SLD_55555_ChoiceProj;
\tnr = 1;
\tcondition = DIA_ChoiceProj_Test_Condition;
\tinformation = DIA_ChoiceProj_Test_Info;
\timportant = FALSE;
};

FUNC INT DIA_ChoiceProj_Test_Condition()
{
\treturn TRUE;
};

FUNC VOID DIA_ChoiceProj_Test_Info()
{
\tAI_Output(self, other, "DIA_ChoiceProj_Test_15_00"); //Hello, what do you want?
};
`;

/**
 * Issue #117: after adding a Choice, the new choice sub-dialog had to be
 * "unlocked" by re-clicking the NPC in the left panel (which forces a
 * re-merge of the project semantic model). The choice must be accessible
 * immediately after creation.
 */
test.describe('Choice accessibility after creation in project mode (issue #117)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_project/choice-proj.d', content);
    }, PROJECT_DIALOG_FILE);

    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('project folder path')) {
        await dialog.accept('project');
      } else {
        await dialog.dismiss();
      }
    });

    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await expect(page.getByText('SLD_55555_ChoiceProj')).toBeVisible({ timeout: 15000 });

    await page.getByText('SLD_55555_ChoiceProj').click();
    await page.getByRole('button', { name: /DIA_ChoiceProj_Test/ }).click();
    await expect(
      page.getByRole('heading', { name: 'DIA_ChoiceProj_Test', exact: true })
    ).toBeVisible();
    await expect(page.getByLabel('Text').first()).toBeVisible();
  });

  test('added choice is immediately accessible without re-clicking the NPC', async ({ page }) => {
    await page.getByRole('button', { name: 'Add action' }).click();
    await page.getByRole('menuitem', { name: 'Choice', exact: true }).click();
    await expect(page.getByLabel('Choice Text')).toBeVisible();

    // The choice card must immediately offer navigation into the new sub-dialog
    const editChoiceButton = page.getByRole('button', { name: 'Edit choice actions' });
    await expect(editChoiceButton).toBeVisible();

    // The dialog tree must immediately show the new choice as a child
    await page.getByRole('button', { name: 'Expand dialog', exact: true }).click();
    await expect(page.getByText('DIA_ChoiceProj_Test_Choice_1')).toBeVisible();

    // Navigating into the choice must open its (empty) sub-dialog editor
    await editChoiceButton.click();
    await expect(
      page.getByRole('heading', { name: 'DIA_ChoiceProj_Test_Choice_1' })
    ).toBeVisible();
    await expect(page.getByText('No actions yet')).toBeVisible();
  });

  test('added choice can be opened from the dialog tree without re-clicking the NPC', async ({ page }) => {
    await page.getByRole('button', { name: 'Add action' }).click();
    await page.getByRole('menuitem', { name: 'Choice', exact: true }).click();
    await expect(page.getByLabel('Choice Text')).toBeVisible();

    await page.getByRole('button', { name: 'Expand dialog', exact: true }).click();
    await page.getByText('DIA_ChoiceProj_Test_Choice_1').click();

    await expect(
      page.getByRole('heading', { name: 'DIA_ChoiceProj_Test_Choice_1' })
    ).toBeVisible();
    await expect(page.getByText('No actions yet')).toBeVisible();
  });
});

test.describe('Choice / Branch Creation and Editing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_choice-test.d', content);
    }, DIALOG_FILE);

    page.on('dialog', async (d) => await d.accept('choice-test.d'));
    await page.getByRole('button', { name: /Open Single File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });

    await page.getByText('SLD_77777_Choicetest').click();
    await page.getByRole('button', { name: /DIA_Choice_Test/ }).click();
    await expect(
      page.getByRole('heading', { name: 'DIA_Choice_Test', exact: true })
    ).toBeVisible();
    await expect(page.getByLabel('Text').first()).toBeVisible();
  });

  test('adding a Choice action renders Choice Text and Function fields', async ({ page }) => {
    await page.getByRole('button', { name: 'Add action' }).click();
    await page.getByRole('menuitem', { name: 'Choice', exact: true }).click();

    // ChoiceRenderer renders "Choice Text" and "Function" labels
    await expect(page.getByLabel('Choice Text')).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel('Function')).toBeVisible({ timeout: 5000 });
  });

  test('can type in the Choice Text field', async ({ page }) => {
    await page.getByRole('button', { name: 'Add action' }).click();
    await page.getByRole('menuitem', { name: 'Choice', exact: true }).click();

    const choiceTextField = page.getByLabel('Choice Text');
    await expect(choiceTextField).toBeVisible({ timeout: 5000 });
    await choiceTextField.fill('Option A');
    await expect(choiceTextField).toHaveValue('Option A');
  });

  test('can type a function name in the Function field', async ({ page }) => {
    await page.getByRole('button', { name: 'Add action' }).click();
    await page.getByRole('menuitem', { name: 'Choice', exact: true }).click();

    const functionField = page.getByLabel('Function');
    await expect(functionField).toBeVisible({ timeout: 5000 });
    await functionField.fill('DIA_Choice_Test_Option_A');
    await expect(functionField).toHaveValue('DIA_Choice_Test_Option_A');
  });

  test('can add multiple choice branches', async ({ page }) => {
    // Add first choice
    await page.getByRole('button', { name: 'Add action' }).click();
    await page.getByRole('menuitem', { name: 'Choice', exact: true }).click();
    await expect(page.getByLabel('Choice Text').first()).toBeVisible({ timeout: 5000 });

    // Add second choice using the "+" between actions
    const addButtons = page.getByRole('button', { name: 'Add new action' });
    await addButtons.last().click();
    await page.getByRole('menuitem', { name: 'Choice', exact: true }).click();

    // Should now have two Choice Text fields
    await expect(async () => {
      expect(await page.getByLabel('Choice Text').count()).toBe(2);
    }).toPass({ timeout: 5000 });
  });
});
