import { expect, test, Page } from '@playwright/test';

/**
 * Quest conditions (#323): a vanilla `MIS_` check reads "Quest is running"
 * with the quest shown by its diary title, and the card's edits write the
 * plain check back — including "not running" (#320).
 *
 * The harness's regex parser reads no conditions or constants, so the models
 * the real parser produces are injected. Assertions read the card's "show
 * script" view, which prints the condition held in the store.
 */
const DIALOG_PATH = 'project/dialogs/DIA_Farmer.d';
const CONSTANTS_PATH = 'project/dialogs/LOG_Constants_Test.d';

const DIALOG_FILE = `//__MOCK_MODEL__${JSON.stringify({
  dialogs: {
    DIA_Farmer_Sheep: { name: 'DIA_Farmer_Sheep', parent: 'C_INFO', filePath: DIALOG_PATH, properties: { npc: 'BAU_Farmer', nr: 1, condition: 'DIA_Farmer_Sheep_Condition', information: 'DIA_Farmer_Sheep_Info', permanent: false } }
  },
  functions: {
    DIA_Farmer_Sheep_Condition: { name: 'DIA_Farmer_Sheep_Condition', returnType: 'INT', calls: [], actions: [], conditions: [
      { type: 'VariableCondition', variableName: 'MIS_Sheep', negated: false, operator: '==', value: 'LOG_RUNNING' }
    ] },
    DIA_Farmer_Sheep_Info: { name: 'DIA_Farmer_Sheep_Info', returnType: 'VOID', calls: [], conditions: [], actions: [] }
  },
  constants: {}, variables: {}, instances: {}, hasErrors: false, errors: []
})}
// Quest conditions fixture`;

const CONSTANTS_FILE = `//__MOCK_MODEL__ ${JSON.stringify({
  constants: {
    TOPIC_Sheep: { name: 'TOPIC_Sheep', type: 'string', value: '"Die verlorenen Schafe"', filePath: CONSTANTS_PATH },
    TOPIC_Wolves: { name: 'TOPIC_Wolves', type: 'string', value: '"Wolves at the farm"', filePath: CONSTANTS_PATH }
  }
})}
const string TOPIC_Sheep = "Die verlorenen Schafe";
const string TOPIC_Wolves = "Wolves at the farm";
`;

async function openDialog(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  await page.evaluate(({ files }) => {
    for (const [path, content] of files) localStorage.setItem(`mockapi_file_${path}`, content);
  }, { files: [[DIALOG_PATH, DIALOG_FILE], [CONSTANTS_PATH, CONSTANTS_FILE]] });
  page.on('dialog', async (dialog) => {
    if (dialog.message().includes('project folder path')) await dialog.accept('project/dialogs');
    else await dialog.dismiss();
  });
  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await expect(page.getByText('BAU_Farmer').first()).toBeVisible({ timeout: 15000 });
  await page.getByText('BAU_Farmer').first().click();
  await page.getByRole('button', { name: /DIA_Farmer_Sheep/ }).click();
  await expect(page.getByRole('heading', { name: 'DIA_Farmer_Sheep', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand conditions' }).click();
}

const chip = (page: Page, text: string) => page.locator('.MuiChip-label', { hasText: new RegExp(`^${text}$`) });

test.describe('Quest conditions', () => {
  test.beforeEach(async ({ page }) => {
    await openDialog(page);
  });

  test('reads a MIS_ check as a quest state and writes "not running" back', async ({ page }) => {
    const card = page.getByTestId('quest-condition');
    await expect(card).toHaveCount(1);
    await expect(chip(page, 'Quest is running')).toBeVisible();
    // The quest shows by its diary title, not as MIS_Sheep.
    await expect(card.getByLabel('Quest', { exact: true })).toHaveValue('Die verlorenen Schafe');
    await expect(page.getByLabel('Variable Name')).toHaveCount(0);

    await card.getByRole('button', { name: 'Show script' }).click();
    const script = card.getByTestId('quest-condition-script');
    await expect(script).toHaveText('MIS_Sheep == LOG_RUNNING');

    await card.getByLabel('State').click();
    await page.getByRole('option', { name: 'is not running' }).click();
    await expect(chip(page, 'Quest is not running')).toBeVisible();
    await expect(script).toHaveText('MIS_Sheep != LOG_RUNNING');
  });

  test('adds a quest condition from the menu and picks the quest by title', async ({ page }) => {
    await page.getByRole('button', { name: 'Add Condition' }).first().click();
    await page.getByRole('menuitem', { name: 'Quest State', exact: true }).click();
    const card = page.getByTestId('quest-condition').nth(1);

    await card.getByLabel('Quest', { exact: true }).fill('Wolves');
    await page.getByRole('option', { name: /Wolves at the farm/ }).click();
    await expect(card.getByLabel('Quest', { exact: true })).toHaveValue('Wolves at the farm');
    await card.getByLabel('State').click();
    await page.getByRole('option', { name: 'is not started' }).click();

    await card.getByRole('button', { name: 'Show script' }).click();
    await expect(card.getByTestId('quest-condition-script')).toHaveText('MIS_Wolves == FALSE');
    // The first condition is untouched.
    await expect(chip(page, 'Quest is running')).toBeVisible();
  });
});
