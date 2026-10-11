import { test, expect } from '@playwright/test';

/**
 * E2E tests for the Quest Editor view in project mode.
 * Covers switching to the quest view and verifying the QuestList panel renders.
 */

const PROJECT_DIALOG_FILE = `INSTANCE DIA_Quest_Test(C_INFO)
{
\tnpc = SLD_22222_QuestNPC;
\tnr = 1;
\tcondition = DIA_Quest_Test_Condition;
\tinformation = DIA_Quest_Test_Info;
\timportant = FALSE;
};

FUNC INT DIA_Quest_Test_Condition()
{
\treturn TRUE;
};

FUNC VOID DIA_Quest_Test_Info()
{
\tAI_Output(self, other, "DIA_Quest_Test_15_00"); //Quest editor test line.
};
`;

// A minimal quest constants file — TOPIC_ prefix makes it visible in QuestList
const QUEST_CONSTANTS_FILE = `const int TOPIC_TEST_QUEST_01 = 0;
const int TOPIC_TEST_QUEST_02 = 0;
`;

test.describe('Quest Editor (project mode)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();

    await page.evaluate(({ dialogs, quests }) => {
      localStorage.setItem('mockapi_file_questtest/dialogs.d', dialogs);
      localStorage.setItem('mockapi_file_questtest/quests.d', quests);
    }, { dialogs: PROJECT_DIALOG_FILE, quests: QUEST_CONSTANTS_FILE });

    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('project folder path')) {
        await dialog.accept('questtest');
      } else {
        await dialog.dismiss();
      }
    });

    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await expect(page.getByText('SLD_22222_QuestNPC')).toBeVisible({ timeout: 15000 });
  });

  test('Quest Editor sidebar button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Quest Editor' })).toBeVisible();
  });

  test('clicking Quest Editor switches to the quest view', async ({ page }) => {
    await page.getByRole('button', { name: 'Quest Editor' }).click();

    // After switching, the NPC list (dialog view) should be hidden
    // and the quest editor should start loading or be visible
    await expect(async () => {
      const dialogViewVisible = await page.getByRole('heading', { name: 'NPCs' }).isVisible();
      expect(dialogViewVisible).toBe(false);
    }).toPass({ timeout: 5000 });
  });

  test('Quest Editor view renders without crashing', async ({ page }) => {
    await page.getByRole('button', { name: 'Quest Editor' }).click();

    // The quest editor or its loading indicator should appear
    await expect(async () => {
      const hasContent =
        await page.locator('text=Loading quest editor').count() > 0 ||
        await page.locator('text=No quests').count() > 0 ||
        await page.locator('text=Scanning project files').count() > 0 ||
        await page.getByRole('textbox', { name: /search/i }).count() > 0 ||
        // QuestList renders inside the quest editor
        await page.locator('[data-testid="quest-list"]').count() > 0;
      expect(hasContent).toBeTruthy();
    }).toPass({ timeout: 15000 });
  });

  test('can switch back to Dialog Editor from Quest Editor', async ({ page }) => {
    await page.getByRole('button', { name: 'Quest Editor' }).click();

    // Wait for quest view to activate
    await expect(async () => {
      expect(await page.getByRole('heading', { name: 'NPCs' }).isVisible()).toBe(false);
    }).toPass({ timeout: 5000 });

    // Switch back
    await page.getByRole('button', { name: 'Dialog Editor' }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('SLD_22222_QuestNPC')).toBeVisible();
  });
});
