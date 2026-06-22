import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E content tests: exercises creating every action type the editor exposes
 * in its "Add action" menu and asserts that the matching renderer mounts with
 * its signature field.  This closes the gap where only a handful of action
 * types (Dialog Line, Choice, Set Variable, Give XP, Log Entry) had any E2E
 * coverage.
 *
 * These run against the browser mock API, so they assert in-session editor
 * behaviour (the model held in the store + rendered UI), which is exactly what
 * the existing action specs do.
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

/** Insert an action type via the "Add action" menu, using the search filter. */
async function addActionFromMenu(page: Page, menuLabel: string) {
  await page.getByRole('button', { name: 'Add action' }).click();
  await page.getByPlaceholder('Search actions...').fill(menuLabel);
  await page.getByRole('menuitem', { name: menuLabel, exact: true }).click();
}

test.describe('Action type content insertion', () => {
  test.beforeEach(async ({ page }) => {
    await openSampleDialog(page);
  });

  // menuLabel = the label shown in the Add-action menu (ACTION_TYPE_LABELS),
  // signatureLabel = a field label unique to that action's renderer.
  const ACTION_MATRIX: Array<{ menuLabel: string; signatureLabel: string }> = [
    { menuLabel: 'Create Topic', signatureLabel: 'Topic Type' },
    { menuLabel: 'Log Set Status', signatureLabel: 'Status' },
    { menuLabel: 'Create Inventory Items', signatureLabel: 'Item' },
    { menuLabel: 'Give Inventory Items', signatureLabel: 'Giver' },
    { menuLabel: 'Attack Action', signatureLabel: 'Attacker' },
    { menuLabel: 'Set Attitude', signatureLabel: 'Attitude' },
    { menuLabel: 'Chapter Transition', signatureLabel: 'Chapter' },
    { menuLabel: 'Exchange Routine', signatureLabel: 'Target NPC' },
    { menuLabel: 'End Dialog', signatureLabel: 'Target' },
    { menuLabel: 'Play Animation', signatureLabel: 'Animation' },
    { menuLabel: 'Pickpocket', signatureLabel: 'Mode' },
    { menuLabel: 'Start Other Routine', signatureLabel: 'Routine' },
    { menuLabel: 'Teach', signatureLabel: 'Teach Function' },
    { menuLabel: 'Give Trade Inventory', signatureLabel: 'Trade Target' },
    { menuLabel: 'Remove Inventory Items', signatureLabel: 'Item' },
    { menuLabel: 'Insert NPC', signatureLabel: 'NPC Instance' },
    { menuLabel: 'Hero Follows NPC', signatureLabel: 'Guide Routine' },
    { menuLabel: 'Refuse Talk', signatureLabel: 'Seconds' },
    { menuLabel: 'Clear Choices', signatureLabel: 'Dialog Instance' }
  ];

  for (const { menuLabel, signatureLabel } of ACTION_MATRIX) {
    test(`inserts a "${menuLabel}" action and renders its editor`, async ({ page }) => {
      // The mock dialog starts with 3 Dialog Lines and no other action cards,
      // so no generic "Delete action" buttons exist yet.
      expect(await page.getByLabel('Delete action').count()).toBe(0);

      await addActionFromMenu(page, menuLabel);

      // The renderer's signature field label must appear.
      await expect(page.getByText(signatureLabel, { exact: true }).first()).toBeVisible({
        timeout: 5000
      });
      // A non-dialog-line action card with a delete control was added.
      await expect(async () => {
        expect(await page.getByLabel('Delete action').count()).toBeGreaterThanOrEqual(1);
      }).toPass({ timeout: 5000 });
    });
  }
});

test.describe('Action content editing persists in session', () => {
  test.beforeEach(async ({ page }) => {
    await openSampleDialog(page);
  });

  test('Create Topic: typed Topic value is preserved', async ({ page }) => {
    await addActionFromMenu(page, 'Create Topic');
    // Creating a topic auto-appends Log Set Status + Log Entry actions (which
    // also carry a Topic field), so target the Create Topic action's own field.
    const topic = page.getByLabel('Topic', { exact: true }).first();
    await expect(topic).toBeVisible();
    await topic.click();
    await topic.fill('TOPIC_KillAlchemist');
    await topic.blur();
    await page.waitForTimeout(400);
    await expect(topic).toHaveValue('TOPIC_KillAlchemist');
  });

  test('Teach: typed Teach Function value is preserved', async ({ page }) => {
    await addActionFromMenu(page, 'Teach');
    const fn = page.getByLabel('Teach Function');
    await expect(fn).toBeVisible();
    await fn.click();
    await fn.fill('B_TeachFighting');
    await fn.blur();
    await page.waitForTimeout(400);
    await expect(fn).toHaveValue('B_TeachFighting');
  });

  test('Give XP: typed XP amount is preserved', async ({ page }) => {
    await addActionFromMenu(page, 'Give XP');
    const xp = page.getByLabel('XP Amount');
    await expect(xp).toBeVisible();
    await xp.click();
    await xp.fill('250');
    await xp.blur();
    await page.waitForTimeout(400);
    await expect(xp).toHaveValue('250');
  });

  // Issue #119: Npc_SetRefuseTalk with an editable seconds field (default 300).
  test('Refuse Talk: Seconds defaults to 300 and is editable', async ({ page }) => {
    await addActionFromMenu(page, 'Refuse Talk');
    const seconds = page.getByLabel('Seconds');
    await expect(seconds).toBeVisible();
    await expect(seconds).toHaveValue('300');
    await seconds.click();
    await seconds.fill('120');
    await seconds.blur();
    await page.waitForTimeout(400);
    await expect(seconds).toHaveValue('120');
  });

  // Issue #123: Info_ClearChoices auto-fills the dialog instance from context.
  test('Clear Choices: Dialog Instance auto-fills from the current dialog', async ({ page }) => {
    await addActionFromMenu(page, 'Clear Choices');
    const dialogField = page.getByLabel('Dialog Instance');
    await expect(dialogField).toBeVisible();
    await expect(dialogField).toHaveValue('DIA_Arog_EntscheidungKillAlchemist');
  });

  // Issue #183 (item 3): Tab must move between the fields in the same Give
  // Inventory Item row (Giver -> Receiver -> Item) instead of jumping to the
  // next action card.
  test('Give Inventory Items: Tab moves Giver -> Receiver -> Item', async ({ page }) => {
    await addActionFromMenu(page, 'Give Inventory Items');

    const giver = page.getByLabel('Giver');
    const receiver = page.getByLabel('Receiver');
    const item = page.getByLabel('Item', { exact: true });
    await expect(giver).toBeVisible();

    await giver.focus();
    await expect(giver).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(receiver).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(item).toBeFocused();
  });
});
