import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E content tests for the "If / Else Block" (ConditionalAction). Covers the
 * nested-branch content workflow that previously had no E2E coverage: creating
 * the block, editing its condition, and adding actions into the then/else
 * branches.
 */

const SAMPLE_DIALOG_CONTENT = fs.readFileSync(
  path.join(__dirname, '../fixtures/sample-dialog.d'),
  'utf-8'
);

async function openSampleDialog(page: Page) {
  await page.goto('/');
  await page.evaluate((content) => {
    localStorage.setItem('mockapi_file_test-dialog.d', content);
  }, SAMPLE_DIALOG_CONTENT);

  page.on('dialog', async (d) => await d.accept('test-dialog.d'));
  await page.getByRole('button', { name: /Open Single File/i }).click();
  await expect(page.getByRole('heading', { name: 'NPCs' })).toBeVisible({ timeout: 10000 });

  await page.getByText('SLD_99005_Arog').click();
  await page.getByRole('button', { name: /DIA_Arog_EntscheidungKillAlchemist/ }).click();
  await expect(
    page.getByRole('heading', { name: 'DIA_Arog_EntscheidungKillAlchemist', exact: true })
  ).toBeVisible();
  await expect(page.getByLabel('Text').first()).toBeVisible();
}

async function addConditionalBlock(page: Page) {
  await page.getByRole('button', { name: 'Add action' }).click();
  await page.getByPlaceholder('Search actions...').fill('If / Else Block');
  await page.getByRole('menuitem', { name: 'If / Else Block', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Condition' })).toBeVisible({ timeout: 5000 });
}

test.describe('Conditional action (If / Else block)', () => {
  test.beforeEach(async ({ page }) => {
    await openSampleDialog(page);
  });

  test('inserts an If/Else block with both branches', async ({ page }) => {
    await addConditionalBlock(page);

    await expect(page.getByLabel('Delete conditional block')).toBeVisible();
    await expect(page.getByText('If', { exact: true })).toBeVisible();
    await expect(page.getByText('Else', { exact: true })).toBeVisible();
    // Both branches start empty.
    await expect(page.getByText('No actions in this branch.')).toHaveCount(2);
  });

  test('edits the block condition and preserves it', async ({ page }) => {
    await addConditionalBlock(page);

    const condition = page.getByRole('textbox', { name: 'Condition' });
    await condition.click();
    await condition.fill('Npc_KnowsInfo(other, DIA_Arog_Hallo)');
    await condition.blur();
    await page.waitForTimeout(400);
    await expect(condition).toHaveValue('Npc_KnowsInfo(other, DIA_Arog_Hallo)');
  });

  test('adds a dialog line into the "then" branch', async ({ page }) => {
    await addConditionalBlock(page);

    const dialogLineFields = page.getByLabel('Text');
    await expect(dialogLineFields).toHaveCount(3);

    // The first "Add Line" button belongs to the "then" branch.
    await page.getByRole('button', { name: 'Add Line' }).first().click();

    await expect(dialogLineFields).toHaveCount(4);
    // The then branch is no longer empty; one empty-branch placeholder remains.
    await expect(page.getByText('No actions in this branch.')).toHaveCount(1);
  });

  test('inserts a "knows info" condition from the template menu (#145)', async ({ page }) => {
    await addConditionalBlock(page);

    await page.getByRole('button', { name: 'Insert condition template' }).click();
    await page.getByRole('menuitem', { name: 'NPC Knows Dialog' }).click();

    const condition = page.getByRole('textbox', { name: 'Condition' });
    await expect(condition).toHaveValue('Npc_KnowsInfo(other, DIA_)');

    // A second template is appended with && instead of replacing.
    await page.getByRole('button', { name: 'Insert condition template' }).click();
    await page.getByRole('menuitem', { name: 'Quest State' }).click();
    await expect(condition).toHaveValue('Npc_KnowsInfo(other, DIA_) && MIS_ == LOG_RUNNING');

    // The inserted condition persists past the debounce window.
    await page.waitForTimeout(400);
    await expect(condition).toHaveValue('Npc_KnowsInfo(other, DIA_) && MIS_ == LOG_RUNNING');
  });

  test('adds an action into the "else" branch via the action menu', async ({ page }) => {
    await addConditionalBlock(page);

    // Second "Add Action" button belongs to the "else" branch.
    await page.getByRole('button', { name: 'Add Action' }).nth(1).click();
    await page.getByPlaceholder('Search actions...').fill('Give XP');
    await page.getByRole('menuitem', { name: 'Give XP', exact: true }).click();

    await expect(page.getByLabel('XP Amount')).toBeVisible({ timeout: 5000 });
    // Only the "then" branch remains empty now.
    await expect(page.getByText('No actions in this branch.')).toHaveCount(1);
  });
});
