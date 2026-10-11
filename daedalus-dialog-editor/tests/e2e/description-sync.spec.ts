import { test, expect, Page } from '@playwright/test';

/**
 * #277: a dialog's description is the choice the player reads, and in the
 * scripts it is the hero's first line. The two stay in step while they agree;
 * a hand-edited description breaks the link, visibly, and one click restores it.
 *
 * Injected through the mock-model seam: the regex mock parser takes a line's
 * text from its id, not from its comment.
 */

const MODEL = {
  dialogs: {
    DIA_Sync: {
      name: 'DIA_Sync',
      parent: 'C_INFO',
      properties: {
        npc: 'SLD_Sync',
        nr: 1,
        condition: 'DIA_Sync_Condition',
        information: 'DIA_Sync_Info',
        description: 'Hallo du',
      },
      propertyLiteralKeys: ['description'],
      propertyExpressionKeys: [],
    },
  },
  functions: {
    DIA_Sync_Condition: { name: 'DIA_Sync_Condition', returnType: 'INT', actions: [], conditions: [], calls: [] },
    DIA_Sync_Info: {
      name: 'DIA_Sync_Info',
      returnType: 'VOID',
      conditions: [],
      calls: [],
      actions: [
        { type: 'DialogLine', speaker: 'other', text: 'Hallo du', id: 'DIA_Sync_15_00' },
        { type: 'DialogLine', speaker: 'self', text: 'Was willst du?', id: 'DIA_Sync_01_01' },
      ],
    },
  },
  hasErrors: false,
  errors: [],
};

const SEED_FILE = `//__MOCK_MODEL__${JSON.stringify(MODEL)}\n`;

const firstLine = (page: Page) => page.getByLabel('Text', { exact: true }).first();
const description = (page: Page) => page.getByRole('textbox', { name: 'Description', exact: true });
const readSaved = (page: Page) => page.evaluate(() => localStorage.getItem('mockapi_file_sync.d'));

test.describe('In sync with the first line (#277)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_sync.d', content);
    }, SEED_FILE);

    page.on('dialog', async (d) => await d.accept('sync.d'));
    await page.getByRole('button', { name: /Open Single File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });

    await page.getByText('SLD_Sync').click();
    await page.getByRole('button', { name: /DIA_Sync/ }).first().click();
    await expect(page.getByRole('heading', { name: 'DIA_Sync', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Expand properties' }).click();
    await expect(description(page)).toHaveValue('Hallo du');
  });

  test('a description in step with the first line follows its edits', async ({ page }) => {
    await expect(page.getByLabel('In sync with the first line')).toBeVisible();

    await firstLine(page).fill('Hallo Fremder');

    await expect(description(page)).toHaveValue('Hallo Fremder');
    await expect(page.getByLabel('In sync with the first line')).toBeVisible();
  });

  test('a hand-edited description stops following, and the link button re-syncs it', async ({ page }) => {
    await description(page).fill('Wer bist du?');
    await description(page).blur();

    const resync = page.getByRole('button', { name: 'Sync with the first line' });
    await expect(resync).toBeVisible();

    await firstLine(page).fill('Hallo Fremder');
    await firstLine(page).blur();
    // Past the line editor's debounce, so a follow would have landed by now;
    // the re-sync below reading 'Hallo Fremder' proves the edit itself did.
    await page.waitForTimeout(1000);
    await expect(description(page)).toHaveValue('Wer bist du?');

    await resync.click();

    await expect(description(page)).toHaveValue('Hallo Fremder');
    await expect(page.getByLabel('In sync with the first line')).toBeVisible();
  });

  // The quotes are the file's syntax, never the field's text: removing the
  // last character must not leave or add one.
  test('the field edits the text, and the file gets the quotes', async ({ page }) => {
    await description(page).press('End');
    await description(page).press('Backspace');
    await description(page).blur();

    await expect(description(page)).toHaveValue('Hallo d');
    await page.keyboard.press('Control+s');
    await expect.poll(() => readSaved(page)).toMatch(/description\s*=\s*"Hallo d";/);
  });

  test('a constant is chosen with the Constant switch and written bare', async ({ page }) => {
    await page.getByRole('button', { name: 'Constant' }).click();
    await page.getByRole('combobox', { name: 'Description constant' }).fill('DIALOG_ENDE');
    await page.getByRole('combobox', { name: 'Description constant' }).blur();

    await page.keyboard.press('Control+s');
    await expect.poll(() => readSaved(page)).toMatch(/description\s*=\s*DIALOG_ENDE;/);
  });
});
