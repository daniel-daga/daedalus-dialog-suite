import { expect, test, Page, Locator } from '@playwright/test';

/**
 * Quest step cards (#322): the vanilla lines that start, end or note a quest
 * show as one card, and the card's edits reach every one of those lines.
 *
 * The mock parser cannot produce quest lines, so the dialog's model is
 * injected. Assertions read the card's own "show script" view, which prints
 * the lines held in the store (never generated file bytes — tests/e2e/README).
 */
const MODEL = {
  dialogs: {
    DIA_Farmer_Sheep: { name: 'DIA_Farmer_Sheep', parent: 'C_INFO', properties: { npc: 'BAU_Farmer', nr: 1, condition: 'DIA_Farmer_Sheep_Condition', information: 'DIA_Farmer_Sheep_Info', permanent: false } }
  },
  functions: {
    DIA_Farmer_Sheep_Condition: { name: 'DIA_Farmer_Sheep_Condition', returnType: 'INT', calls: [], conditions: [], actions: [] },
    DIA_Farmer_Sheep_Info: { name: 'DIA_Farmer_Sheep_Info', returnType: 'VOID', calls: [], conditions: [], actions: [
      { type: 'DialogLine', speaker: 'self', text: 'My sheep ran off.', id: 'DIA_Farmer_Sheep_05_00' },
      { type: 'SetVariableAction', variableName: 'MIS_Sheep', operator: '=', value: 'LOG_RUNNING', id: 'action_a' },
      { type: 'CreateTopic', topic: 'TOPIC_Sheep', topicType: 'LOG_MISSION', id: 'action_b' },
      { type: 'LogSetTopicStatus', topic: 'TOPIC_Sheep', status: 'LOG_RUNNING', id: 'action_c' },
      { type: 'LogEntry', topic: 'TOPIC_Sheep', text: 'The farmer lost his sheep.', id: 'action_d' },
      { type: 'LogEntry', topic: 'TOPIC_Sheep', text: 'A second, separate entry.', id: 'action_e' }
    ] }
  },
  constants: {}, variables: {}, instances: {}, hasErrors: false, errors: []
};

const FILE = `//__MOCK_MODEL__${JSON.stringify(MODEL)}\n// Quest steps fixture`;

async function openDialog(page: Page) {
  await page.goto('/');
  await page.evaluate((content) => localStorage.setItem('mockapi_file_quest-steps.d', content), FILE);
  page.on('dialog', async (dialog) => dialog.accept('quest-steps.d'));
  await page.getByRole('button', { name: /Open Single File/i }).click();
  await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible();
  await page.getByText('BAU_Farmer', { exact: true }).click();
  await page.getByRole('button', { name: /DIA_Farmer_Sheep/ }).click();
  await expect(page.getByRole('heading', { name: 'DIA_Farmer_Sheep', exact: true })).toBeVisible();
}

async function addActionFromMenu(page: Page, menuLabel: string) {
  await page.getByRole('button', { name: 'Add action' }).click();
  await page.getByPlaceholder('Search actions...').fill(menuLabel);
  await page.getByRole('menuitem', { name: menuLabel, exact: true }).click();
}

/** Type into a card's quest picker and take the option offered. */
async function chooseQuest(card: Locator, page: Page, typed: string, option: string) {
  await card.getByLabel(/^(Quest|Note topic)$/).fill(typed);
  await page.getByRole('option', { name: option }).click();
}

test.describe('Quest step cards', () => {
  test.beforeEach(async ({ page }) => {
    await openDialog(page);
  });

  test('shows a vanilla quest start as one card and edits all its lines', async ({ page }) => {
    const cards = page.getByTestId('quest-step-card');
    await expect(cards).toHaveCount(1);
    const card = cards.first();
    await expect(card.getByText('Start quest')).toBeVisible();
    // Its four lines have no cards of their own; the second entry stays raw.
    await expect(page.getByLabel('Topic Type')).toHaveCount(0);
    await expect(page.getByLabel('Status', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Topic', { exact: true })).toHaveCount(1);

    await expect(card.getByLabel('Diary entry')).toHaveValue('The farmer lost his sheep.');
    await card.getByLabel('Diary entry').fill('The sheep are gone.');
    // No project: a new quest takes the name its title gives, undeclared.
    await chooseQuest(card, page, 'Goats', 'New quest "Goats"');

    await card.getByRole('button', { name: 'Show script' }).click();
    const script = card.getByTestId('quest-step-script');
    await expect(script).toHaveText([
      'MIS_Goats = LOG_RUNNING;',
      'Log_CreateTopic (TOPIC_Goats, LOG_MISSION);',
      'Log_SetTopicStatus (TOPIC_Goats, LOG_RUNNING);',
      'B_LogEntry (TOPIC_Goats, "The sheep are gone.");'
    ].join('\n'));
    // The separate entry after the step keeps its own quest.
    await expect(page.getByLabel('Topic', { exact: true })).toHaveValue('TOPIC_Sheep');
  });

  test('writes a new quest start from the menu and completes it with optional XP', async ({ page }) => {
    await addActionFromMenu(page, 'Start Quest');
    const cards = page.getByTestId('quest-step-card');
    await expect(cards).toHaveCount(2);
    const started = cards.nth(1);
    await chooseQuest(started, page, 'Wolves', 'New quest "Wolves"');
    await started.getByLabel('Diary entry').fill('Wolves near the farm.');
    await started.getByLabel('Diary entry').blur();
    await started.getByRole('button', { name: 'Show script' }).click();
    await expect(started.getByTestId('quest-step-script')).toHaveText([
      'Log_CreateTopic (TOPIC_Wolves, LOG_MISSION);',
      'Log_SetTopicStatus (TOPIC_Wolves, LOG_RUNNING);',
      'B_LogEntry (TOPIC_Wolves, "Wolves near the farm.");',
      'MIS_Wolves = LOG_RUNNING;'
    ].join('\n'));

    await addActionFromMenu(page, 'Complete Quest');
    await expect(cards).toHaveCount(3);
    const completed = cards.nth(2);
    await expect(completed.getByText('Complete quest')).toBeVisible();
    await chooseQuest(completed, page, 'Wolves', 'New quest "Wolves"');
    await completed.getByLabel('XP (optional)').fill('XP_Wolves');
    await completed.getByLabel('XP (optional)').blur();
    await completed.getByRole('button', { name: 'Show script' }).click();
    const script = completed.getByTestId('quest-step-script');
    await expect(script).toHaveText([
      'MIS_Wolves = LOG_SUCCESS;',
      'Log_SetTopicStatus (TOPIC_Wolves, LOG_SUCCESS);',
      'B_GivePlayerXP (XP_Wolves);'
    ].join('\n'));

    // XP is optional: clearing it removes the line.
    await completed.getByLabel('XP (optional)').fill('');
    await completed.getByLabel('XP (optional)').blur();
    await expect(script).toHaveText([
      'MIS_Wolves = LOG_SUCCESS;',
      'Log_SetTopicStatus (TOPIC_Wolves, LOG_SUCCESS);'
    ].join('\n'));
  });

  test('deletes a step with all its lines', async ({ page }) => {
    const card = page.getByTestId('quest-step-card').first();
    await card.getByRole('button', { name: 'Delete action' }).click();
    await expect(page.getByTestId('quest-step-card')).toHaveCount(0);
    // The dialog line and the separate raw entry remain.
    await expect(page.getByLabel('Topic', { exact: true })).toHaveValue('TOPIC_Sheep');
    await expect(page.getByLabel('Text').first()).toHaveValue('My sheep ran off.');
    await expect(page.getByLabel('Topic Type')).toHaveCount(0);
  });
});

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
const CONSTANTS_PATH = 'project/dialogs/LOG_Constants_Test.d';
const CLOSE_TOPICS_PATH = 'project/dialogs/B_CloseTopicsTest.d';
// The harness's regex parser reads no constants or plain functions, so the
// models the real parser would produce are injected; the source text below
// each marker is what the declarations are written into.
const CONSTANTS_FILE = `//__MOCK_MODEL__ ${JSON.stringify({
  constants: { TOPIC_Old: { name: 'TOPIC_Old', type: 'string', value: 'Old Quest', filePath: CONSTANTS_PATH } }
})}
const string TOPIC_Old = "Old Quest";
var int MIS_Old;
`;
const CLOSE_TOPICS_FILE = `//__MOCK_MODEL__ ${JSON.stringify({
  functions: { B_CloseTopicsTest: { name: 'B_CloseTopicsTest', returnType: 'VOID', calls: ['B_CloseTopic'], conditions: [], actions: [] } }
})}
FUNC VOID B_CloseTopicsTest()
{
\tB_CloseTopic (TOPIC_Old, MIS_Old, 0, 2);
};
`;

test.describe('Quest picker in a project', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
    await page.evaluate(({ dialog, constantsPath, closePath, constants, closeTopics }) => {
      localStorage.setItem('mockapi_file_project/dialogs/quest.d', dialog);
      localStorage.setItem(constantsPath, constants);
      localStorage.setItem(closePath, closeTopics);
    }, {
      dialog: DIALOG_FILE,
      constantsPath: `mockapi_file_${CONSTANTS_PATH}`,
      closePath: `mockapi_file_${CLOSE_TOPICS_PATH}`,
      constants: CONSTANTS_FILE,
      closeTopics: CLOSE_TOPICS_FILE
    });
    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('project folder path')) await dialog.accept('project/dialogs');
      else await dialog.dismiss();
    });
    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await expect(page.getByText('SLD_66666_Quester').first()).toBeVisible({ timeout: 15000 });
    await page.getByText('SLD_66666_Quester').first().click();
    await page.getByRole('button', { name: /DIA_Quest_Test/ }).click();
    await expect(page.getByRole('heading', { name: 'DIA_Quest_Test', exact: true })).toBeVisible();
    await addActionFromMenu(page, 'Start Quest');
  });

  test('picks an existing quest by its diary title', async ({ page }) => {
    const card = page.getByTestId('quest-step-card');
    await chooseQuest(card, page, 'Old', 'Old Quest');
    await expect(card.getByLabel('Quest', { exact: true })).toHaveValue('Old Quest');
    await card.getByRole('button', { name: 'Show script' }).click();
    await expect(card.getByTestId('quest-step-script')).toContainText('Log_CreateTopic (TOPIC_Old, LOG_MISSION);');
    await expect(card.getByTestId('quest-step-script')).toContainText('MIS_Old = LOG_RUNNING;');
  });

  test('creates a new quest from its title and declares it in the log files', async ({ page }) => {
    const card = page.getByTestId('quest-step-card');
    await chooseQuest(card, page, 'Die verlorenen Schafe', 'New quest "Die verlorenen Schafe"');

    // Only the title is asked for; the rest is prefilled and folded away.
    await expect(page.getByRole('heading', { name: 'New Quest' })).toBeVisible();
    await expect(page.getByLabel('Quest Title')).toHaveValue('Die verlorenen Schafe');
    await expect(page.getByLabel('Quest Definition File (TOPIC_)')).toHaveCount(0);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'New Quest' })).toBeHidden();

    await expect(async () => {
      const files = await page.evaluate(({ c, t }) => ({
        constants: localStorage.getItem(c),
        closeTopics: localStorage.getItem(t)
      }), { c: `mockapi_file_${CONSTANTS_PATH}`, t: `mockapi_file_${CLOSE_TOPICS_PATH}` });
      expect(files.constants).toContain('const string TOPIC_DieVerlorenenSchafe = "Die verlorenen Schafe";');
      expect(files.constants).toContain('var int MIS_DieVerlorenenSchafe;');
      expect(files.closeTopics).toContain('B_CloseTopic (TOPIC_DieVerlorenenSchafe, MIS_DieVerlorenenSchafe, 0, 2);');
    }).toPass({ timeout: 5000 });

    // The step now writes the new quest's lines. (The harness does not re-read
    // the declared constant, so the card's title lookup is not asserted here.)
    await card.getByRole('button', { name: 'Show script' }).click();
    await expect(card.getByTestId('quest-step-script')).toContainText('Log_CreateTopic (TOPIC_DieVerlorenenSchafe, LOG_MISSION);');
    await expect(card.getByTestId('quest-step-script')).toContainText('MIS_DieVerlorenenSchafe = LOG_RUNNING;');
  });
});
