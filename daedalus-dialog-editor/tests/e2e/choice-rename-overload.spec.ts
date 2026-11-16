import { test, expect } from '@playwright/test';

/**
 * Issue #574: renaming a choice target renamed only the editable signature and
 * left an additional overload (kept as raw source, #557) under the old name.
 * The field now refuses the rename and puts the old name back. A target with
 * no overload still renames, which is what shows the refusal is the overload's.
 * A refused name already committed by typing is reverted too — the second test
 * types slowly enough for the edit debounce to commit it first.
 */

const MODEL = {
  dialogs: {
    DIA_Ovl: {
      name: 'DIA_Ovl',
      parent: 'C_INFO',
      properties: { npc: 'SLD_Ovl', nr: 1, condition: 'DIA_Ovl_Condition', information: 'DIA_Ovl_Info' },
    },
  },
  functions: {
    DIA_Ovl_Condition: { name: 'DIA_Ovl_Condition', returnType: 'INT', actions: [], conditions: [], calls: [] },
    DIA_Ovl_Info: {
      name: 'DIA_Ovl_Info',
      returnType: 'VOID',
      conditions: [],
      calls: [],
      actions: [
        { type: 'Choice', dialogRef: 'DIA_Ovl', text: 'Overloaded', targetFunction: 'DIA_Ovl_Twice' },
        { type: 'Choice', dialogRef: 'DIA_Ovl', text: 'Plain', targetFunction: 'DIA_Ovl_Once' },
      ],
    },
    DIA_Ovl_Twice: { name: 'DIA_Ovl_Twice', returnType: 'VOID', actions: [], conditions: [], calls: [] },
    DIA_Ovl_Once: { name: 'DIA_Ovl_Once', returnType: 'VOID', actions: [], conditions: [], calls: [] },
  },
  declarationOrder: [
    { type: 'dialog', name: 'DIA_Ovl' },
    { type: 'function', name: 'DIA_Ovl_Condition' },
    { type: 'function', name: 'DIA_Ovl_Info' },
    { type: 'function', name: 'DIA_Ovl_Twice' },
    {
      type: 'raw', name: 'DIA_Ovl_Twice', overloadOf: 'DIA_Ovl_Twice', line: 9,
      sourceText: 'func void DIA_Ovl_Twice(var int x) {};',
    },
    { type: 'function', name: 'DIA_Ovl_Once' },
  ],
  hasErrors: false,
  errors: [],
};

const SEED_FILE = `//__MOCK_MODEL__${JSON.stringify(MODEL)}\n`;

test.describe('Renaming a choice target with a raw overload (issue #574)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_choice-overload.d', content);
    }, SEED_FILE);

    page.on('dialog', async (d) => await d.accept('choice-overload.d'));
    await page.getByRole('button', { name: /Open Single File/i }).click();
    await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });

    await page.getByText('SLD_Ovl').click();
    await page.getByRole('button', { name: /DIA_Ovl/ }).first().click();
    await expect(page.getByRole('heading', { name: 'DIA_Ovl', exact: true })).toBeVisible();
  });

  test('refuses the overloaded target and renames the plain one', async ({ page }) => {
    const fields = page.getByLabel('Function', { exact: true });
    await expect(fields).toHaveCount(2);

    const overloaded = fields.nth(0);
    await expect(overloaded).toHaveValue('DIA_Ovl_Twice');
    await overloaded.click();
    await overloaded.fill('DIA_Ovl_Renamed');
    await overloaded.blur();
    await expect(page.getByText(/another signature kept as written/)).toBeVisible();
    await expect(overloaded).toHaveValue('DIA_Ovl_Twice');
    // Past the 300 ms edit debounce: the refused name must not come back.
    await page.waitForTimeout(600);
    await expect(overloaded).toHaveValue('DIA_Ovl_Twice');

    const plain = fields.nth(1);
    await plain.click();
    await plain.fill('DIA_Ovl_Moved');
    await plain.blur();
    await expect(plain).toHaveValue('DIA_Ovl_Moved');
    await expect(page.getByText(/another signature kept as written/)).toHaveCount(1);
  });

  test('reverts a refused name the edit debounce already committed', async ({ page }) => {
    const overloaded = page.getByLabel('Function', { exact: true }).nth(0);
    await overloaded.click();
    await overloaded.fill('DIA_Ovl_Renamed');
    await page.waitForTimeout(600);
    await overloaded.blur();
    await expect(page.getByText(/another signature kept as written/)).toBeVisible();
    await page.waitForTimeout(600);
    await expect(overloaded).toHaveValue('DIA_Ovl_Twice');
  });
});
