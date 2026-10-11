import { test, expect } from '@playwright/test';

const EXISTING_DIALOG_FILE = `INSTANCE DIA_Existing_Greeting(C_INFO)
{
\tnpc = SLD_11111_Existing;
\tnr = 1;
\tcondition = DIA_Existing_Greeting_Condition;
\tinformation = DIA_Existing_Greeting_Info;
\timportant = FALSE;
};

FUNC INT DIA_Existing_Greeting_Condition()
{
\treturn TRUE;
};

FUNC VOID DIA_Existing_Greeting_Info()
{
\tAI_Output(self, other, "DIA_Existing_Greeting_15_00");
};
`;

async function openProjectAndSelectNpc(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();

  await page.evaluate((content) => {
    localStorage.setItem('mockapi_file_project/dialogs/existing.d', content);
  }, EXISTING_DIALOG_FILE);

  page.on('dialog', async (dialog) => {
    if (dialog.message().includes('project folder path')) {
      await dialog.accept('project/dialogs');
    } else {
      await dialog.dismiss();
    }
  });

  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await expect(page.getByText('SLD_11111_Existing').first()).toBeVisible({ timeout: 15000 });
  await page.getByText('SLD_11111_Existing').first().click();
}

// Feature-suggestions item 4 (issue #147 follow-up): teacher categories
// beyond the fight talents — attribute trainers and one-shot talents.
test.describe('Teacher dialog categories', () => {
  test('creates an attribute (STR) trainer through the grouped skill select', async ({ page }) => {
    await openProjectAndSelectNpc(page);

    await page.getByRole('button', { name: 'Create Teacher Dialog' }).click();

    // Pick Strength from the grouped skill select
    await page.getByRole('combobox', { name: 'Skill' }).click();
    await expect(page.getByText('Attributes', { exact: true })).toBeVisible();
    await page.getByRole('option', { name: 'Strength (STR)' }).click();

    // Attribute defaults: cap 100 and the vanilla-style description
    await expect(page.getByLabel('Max Level')).toHaveValue('100');
    await expect(page.getByLabel('Description')).toHaveValue('Ich will staerker werden!');

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByText('DIA_Existing_Teach', { exact: true }).first()).toBeVisible({ timeout: 15000 });

    await expect(async () => {
      const content = await page.evaluate(() =>
        localStorage.getItem('mockapi_file_project/dialogs/DIA_Existing_Teach.d')
      );
      expect(content).not.toBeNull();
      expect(content).toContain('INSTANCE DIA_Existing_Teach (C_INFO)');
      expect(content).toContain('B_TeachAttributePoints (self, other, ATR_STRENGTH, 1, 100);');
      expect(content).toContain('B_BuildLearnString(PRINT_LearnSTR5, B_GetLearnCostAttribute(other, ATR_STRENGTH) * 5)');
      expect(content).toContain('Existing_Merke_STR = other.attribute[ATR_STRENGTH];');
    }).toPass({ timeout: 5000 });
  });

  test('creates a hunting teacher; one-shot talents have no Max Level field', async ({ page }) => {
    await openProjectAndSelectNpc(page);

    await page.getByRole('button', { name: 'Create Teacher Dialog' }).click();
    await expect(page.getByLabel('Max Level')).toBeVisible();

    await page.getByRole('combobox', { name: 'Skill' }).click();
    await page.getByRole('option', { name: 'Hunting (animal trophies)' }).click();

    // One-shot talents are learned once — no level cap to configure
    await expect(page.getByLabel('Max Level')).toHaveCount(0);
    await expect(page.getByLabel('Description')).toHaveValue('Bring mir das Jagen bei.');

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByText('DIA_Existing_Teach', { exact: true }).first()).toBeVisible({ timeout: 15000 });

    await expect(async () => {
      const content = await page.evaluate(() =>
        localStorage.getItem('mockapi_file_project/dialogs/DIA_Existing_Teach.d')
      );
      expect(content).not.toBeNull();
      expect(content).toContain('B_TeachPlayerTalentTakeAnimalTrophy (self, other, TROPHY_Fur);');
      expect(content).toContain(
        'B_BuildLearnString(NAME_LEARN_SHADOWBEAST_HORN, B_GetLearnCostTalent(other, NPC_TALENT_TAKEANIMALTROPHY, TROPHY_ShadowHorn))'
      );
      expect(content).not.toContain('Merke');
    }).toPass({ timeout: 5000 });
  });
});
