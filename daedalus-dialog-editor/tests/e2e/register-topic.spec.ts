import { test, expect } from '@playwright/test';

const DIALOG_FILE = `INSTANCE DIA_Quest_Test(C_INFO)
{
\tnpc = SLD_66666_Quester;
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
\tAI_Output(self, other, "DIA_Quest_Test_15_00"); //Take this quest!
};
`;

const CONSTANTS_FILE = `const string TOPIC_Old = "Old Quest";
var int MIS_Old;
`;

const CLOSE_TOPICS_FILE = `FUNC VOID B_CloseTopicsTest()
{
\tB_CloseTopic (TOPIC_Old, MIS_Old, 0, 2);
};
`;

// Issue #114: the Create Topic action can register the quest in the external
// log files (TOPIC_/MIS_ declarations + B_CloseTopic call).
test.describe('Register quest in log files', () => {
  test('writes the declarations and the close call into the chosen files', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();

    await page.evaluate(({ dialog, constants, closeTopics }) => {
      localStorage.setItem('mockapi_file_project/dialogs/quest.d', dialog);
      localStorage.setItem('mockapi_file_project/dialogs/LOG_Constants_Test.d', constants);
      localStorage.setItem('mockapi_file_project/dialogs/B_CloseTopicsTest.d', closeTopics);
    }, { dialog: DIALOG_FILE, constants: CONSTANTS_FILE, closeTopics: CLOSE_TOPICS_FILE });

    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('project folder path')) {
        await dialog.accept('project/dialogs');
      } else {
        await dialog.dismiss();
      }
    });

    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await expect(page.getByText('SLD_66666_Quester').first()).toBeVisible({ timeout: 15000 });
    await page.getByText('SLD_66666_Quester').first().click();
    await page.getByRole('button', { name: /DIA_Quest_Test/ }).click();
    await expect(page.getByRole('heading', { name: 'DIA_Quest_Test', exact: true })).toBeVisible();

    // Insert a Create Topic action and name the topic
    await page.getByRole('button', { name: 'Add action' }).click();
    await page.getByRole('menuitem', { name: 'Create Topic', exact: true }).click();
    await page.getByLabel('Topic', { exact: true }).first().fill('MeinQuest');

    // Open the register form
    await page.getByRole('button', { name: 'Register quest in log files' }).click();
    await expect(page.getByRole('heading', { name: 'Register Quest in Log Files' })).toBeVisible();

    // Title defaults from the topic name; adjust it and point at the files
    await expect(page.getByLabel('Quest Title')).toHaveValue('MeinQuest');
    await page.getByLabel('Quest Title').fill('Mein Quest');
    await page.getByLabel('Quest Definition File (TOPIC_)').fill('project/dialogs/LOG_Constants_Test.d');
    await page.getByLabel('Close Topics File (B_CloseTopics)').fill('project/dialogs/B_CloseTopicsTest.d');
    await page.getByRole('button', { name: 'Register', exact: true }).click();

    // The form closes and the files carry the new quest
    await expect(page.getByRole('heading', { name: 'Register Quest in Log Files' })).toBeHidden();
    await expect(async () => {
      const files = await page.evaluate(() => ({
        constants: localStorage.getItem('mockapi_file_project/dialogs/LOG_Constants_Test.d'),
        closeTopics: localStorage.getItem('mockapi_file_project/dialogs/B_CloseTopicsTest.d')
      }));
      expect(files.constants).toContain('const string TOPIC_MeinQuest = "Mein Quest";');
      expect(files.constants).toContain('var int MIS_MeinQuest;');
      expect(files.constants).toContain('TOPIC_Old'); // existing content preserved
      expect(files.closeTopics).toContain('B_CloseTopic (TOPIC_MeinQuest, MIS_MeinQuest, 0, 2);');
      // Inserted inside the function body, before its closing brace
      const insertedAt = files.closeTopics!.indexOf('TOPIC_MeinQuest');
      expect(insertedAt).toBeGreaterThan(files.closeTopics!.indexOf('B_CloseTopicsTest()'));
      expect(insertedAt).toBeLessThan(files.closeTopics!.lastIndexOf('};'));
    }).toPass({ timeout: 5000 });
  });
});
