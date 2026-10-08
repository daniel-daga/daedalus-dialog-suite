import { expect, test, Page } from '@playwright/test';

/**
 * The quest page as the diary (#324): every entry and state change of a quest
 * in story order, entries edited in place, and an implicit quest upgraded to
 * a `MIS_` variable in one click.
 *
 * The harness's regex parser reads no quest lines or constants, so the models
 * the real parser produces are injected. The diary itself is the assertion
 * surface: it reads the store, which is where an edit lands; the upgrade's
 * declaration is the one file write asserted, because the store writes that
 * text itself rather than through the mock codegen (tests/e2e/README).
 */
const DIALOG_PATH = 'project/dialogs/DIA_Farm.d';
const CONSTANTS_PATH = 'project/dialogs/LOG_Constants_Test.d';

const dialog = (name: string, npc: string) => ({
  name, parent: 'C_INFO', filePath: DIALOG_PATH,
  properties: { npc, nr: 1, condition: `${name}_Condition`, information: `${name}_Info`, permanent: false }
});
const fn = (name: string, actions: unknown[], conditions: unknown[] = []) =>
  ({ name, returnType: name.endsWith('_Condition') ? 'INT' : 'VOID', calls: [], conditions, actions });
const running = { type: 'VariableCondition', variableName: 'MIS_Sheep', negated: false, operator: '==', value: 'LOG_RUNNING' };

// Declared in reverse story order: the completion first, the start last.
const DIALOG_FILE = `//__MOCK_MODEL__${JSON.stringify({
  dialogs: {
    DIA_Farmer_Done: dialog('DIA_Farmer_Done', 'BAU_Farmer'),
    DIA_Shepherd_Hint: dialog('DIA_Shepherd_Hint', 'BAU_Shepherd'),
    DIA_Farmer_Start: dialog('DIA_Farmer_Start', 'BAU_Farmer'),
    DIA_Smith_Ore: dialog('DIA_Smith_Ore', 'VLK_Smith')
  },
  functions: {
    DIA_Farmer_Done_Condition: fn('DIA_Farmer_Done_Condition', [], [running]),
    DIA_Farmer_Done_Info: fn('DIA_Farmer_Done_Info', [
      { type: 'LogEntry', topic: 'TOPIC_Sheep', text: 'I found the sheep.', id: 'done_entry' },
      { type: 'SetVariableAction', variableName: 'MIS_Sheep', operator: '=', value: 'LOG_SUCCESS', id: 'done_mis' },
      { type: 'LogSetTopicStatus', topic: 'TOPIC_Sheep', status: 'LOG_SUCCESS', id: 'done_status' }
    ]),
    DIA_Shepherd_Hint_Condition: fn('DIA_Shepherd_Hint_Condition', [], [running]),
    DIA_Shepherd_Hint_Info: fn('DIA_Shepherd_Hint_Info', [
      { type: 'LogEntry', topic: 'TOPIC_Sheep', text: 'The shepherd saw them in the woods.', id: 'hint_entry' }
    ]),
    DIA_Farmer_Start_Condition: fn('DIA_Farmer_Start_Condition', []),
    DIA_Farmer_Start_Info: fn('DIA_Farmer_Start_Info', [
      { type: 'SetVariableAction', variableName: 'MIS_Sheep', operator: '=', value: 'LOG_RUNNING', id: 'start_mis' },
      { type: 'CreateTopic', topic: 'TOPIC_Sheep', topicType: 'LOG_MISSION', id: 'start_create' },
      { type: 'LogSetTopicStatus', topic: 'TOPIC_Sheep', status: 'LOG_RUNNING', id: 'start_status' },
      { type: 'LogEntry', topic: 'TOPIC_Sheep', text: 'The farmer lost his sheep.', id: 'start_entry' }
    ]),
    DIA_Smith_Ore_Condition: fn('DIA_Smith_Ore_Condition', []),
    DIA_Smith_Ore_Info: fn('DIA_Smith_Ore_Info', [
      { type: 'CreateTopic', topic: 'TOPIC_Ore', topicType: 'LOG_MISSION', id: 'ore_create' },
      { type: 'LogSetTopicStatus', topic: 'TOPIC_Ore', status: 'LOG_RUNNING', id: 'ore_status' },
      { type: 'LogEntry', topic: 'TOPIC_Ore', text: 'The smith needs ore.', id: 'ore_entry' }
    ])
  },
  constants: {}, variables: {}, instances: {}, hasErrors: false, errors: []
})}
// Quest diary fixture`;

const CONSTANTS_FILE = `//__MOCK_MODEL__ ${JSON.stringify({
  constants: {
    TOPIC_Sheep: { name: 'TOPIC_Sheep', type: 'string', value: '"Lost sheep"', filePath: CONSTANTS_PATH },
    TOPIC_Ore: { name: 'TOPIC_Ore', type: 'string', value: '"Ore for the smith"', filePath: CONSTANTS_PATH }
  },
  variables: {
    MIS_Sheep: { name: 'MIS_Sheep', type: 'int', filePath: CONSTANTS_PATH }
  }
})}
const string TOPIC_Sheep = "Lost sheep";
const string TOPIC_Ore = "Ore for the smith";
var int MIS_Sheep;
`;

async function openQuest(page: Page, title: string) {
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  await page.evaluate(({ files }) => {
    for (const [path, content] of files) localStorage.setItem(`mockapi_file_${path}`, content);
  }, { files: [[DIALOG_PATH, DIALOG_FILE], [CONSTANTS_PATH, CONSTANTS_FILE]] });
  page.on('dialog', async (d) => {
    if (d.message().includes('project folder path')) await d.accept('project/dialogs');
    else await d.dismiss();
  });
  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await expect(page.getByText('BAU_Farmer').first()).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Quest Editor' }).click();
  await page.getByText(title, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

const diaryItems = (page: Page) => page.getByTestId('quest-diary-item');

test.describe('Quest diary', () => {
  test('lists the diary in story order and edits an entry in place', async ({ page }) => {
    await openQuest(page, 'Lost sheep');

    const items = diaryItems(page);
    await expect(items).toHaveCount(5);
    await expect(items.nth(0)).toContainText('Quest started');
    await expect(items.nth(1)).toContainText('The farmer lost his sheep.');
    await expect(items.nth(1)).toContainText('DIA_Farmer_Start');
    await expect(items.nth(2)).toContainText('The shepherd saw them in the woods.');
    await expect(items.nth(3)).toContainText('I found the sheep.');
    await expect(items.nth(4)).toContainText('Quest completed');
    // A quest with its MIS_ variable needs no upgrade.
    await expect(page.getByRole('button', { name: /Add MIS_/ })).toHaveCount(0);

    await items.nth(2).getByRole('button', { name: 'edit entry' }).click();
    const field = page.getByLabel('Diary entry');
    await expect(field).toHaveValue('The shepherd saw them in the woods.');
    await field.fill('The shepherd saw them by the river.');
    await page.getByRole('button', { name: 'save entry' }).click();

    await expect(page.getByLabel('Diary entry')).toHaveCount(0);
    await expect(items.nth(2)).toContainText('The shepherd saw them by the river.');
    await expect(page.getByText('The shepherd saw them in the woods.')).toHaveCount(0);
  });

  test('jumps from an entry to the dialog that writes it', async ({ page }) => {
    await openQuest(page, 'Lost sheep');
    await diaryItems(page).nth(2).getByRole('button', { name: 'go to reference' }).click();
    await expect(page.getByRole('heading', { name: 'DIA_Shepherd_Hint', exact: true })).toBeVisible();
  });

  test('upgrades an implicit quest to a MIS_ variable', async ({ page }) => {
    await openQuest(page, 'Ore for the smith');
    await expect(page.getByText('State inferred from dialog DIA_Smith_Ore')).toBeVisible();
    await expect(page.getByText('No ending yet')).toBeVisible();

    await page.getByRole('button', { name: 'Add MIS_Ore' }).click();

    await expect(async () => {
      const constants = await page.evaluate((p) => localStorage.getItem(p), `mockapi_file_${CONSTANTS_PATH}`);
      expect(constants).toContain('var int MIS_Ore;');
    }).toPass({ timeout: 5000 });

    // The dialog now sets MIS_Ore where it starts the quest: its lines fold
    // into one start step whose script shows the assignment.
    await page.getByRole('button', { name: 'Dialog Editor' }).click();
    await page.getByText('VLK_Smith').first().click();
    await page.getByRole('button', { name: /DIA_Smith_Ore/ }).click();
    const card = page.getByTestId('quest-step-card');
    await card.getByRole('button', { name: 'Show script' }).click();
    await expect(card.getByTestId('quest-step-script')).toHaveText([
      'Log_CreateTopic (TOPIC_Ore, LOG_MISSION);',
      'Log_SetTopicStatus (TOPIC_Ore, LOG_RUNNING);',
      'MIS_Ore = LOG_RUNNING;',
      'B_LogEntry (TOPIC_Ore, "The smith needs ore.");'
    ].join('\n'));
  });
});
