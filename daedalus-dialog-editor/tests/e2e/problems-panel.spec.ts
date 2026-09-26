import { test, expect } from '@playwright/test';

/**
 * E2E for the project-wide Problems panel.
 *
 * The fixture produces exactly one problem: the info function's AI_Output voice
 * id ("BadVoiceId") does not match the vanilla `…_<n>_<n>` pattern, so the
 * `voice-id-malformed` lint fires. Because that function is the dialog's
 * `information`, the problem is enriched with the owning dialog and clicking it
 * navigates to DIA_Prob_Test. The dialog's condition/info functions are
 * referenced (not orphaned) and its NPC is indexed (no npc-not-found).
 */
const PROJECT_FILE_CONTENT = `INSTANCE DIA_Prob_Test(C_INFO)
{
\tnpc = SLD_ProbNpc;
\tnr = 1;
\tcondition = DIA_Prob_Test_Condition;
\tinformation = DIA_Prob_Test_Info;
\timportant = FALSE;
};

FUNC INT DIA_Prob_Test_Condition()
{
\treturn TRUE;
};

FUNC VOID DIA_Prob_Test_Info()
{
\tAI_Output(self, other, "BadVoiceId"); //A test line.
};
`;

test.describe('Problems panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();

    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_probtest/dia.d', content);
    }, PROJECT_FILE_CONTENT);

    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('project folder path')) {
        await dialog.accept('probtest');
      } else {
        await dialog.dismiss();
      }
    });

    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await expect(page.getByText('SLD_ProbNpc')).toBeVisible({ timeout: 15000 });
  });

  test('lists a project-wide problem and navigates to the offending dialog', async ({ page }) => {
    await page.getByTestId('problems-toggle').click();
    await expect(page.getByTestId('problems-panel')).toBeVisible();

    const firstRow = page.getByTestId('problem-row-0');
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    await expect(firstRow).toContainText('BadVoiceId');
    await expect(firstRow).toContainText('Malformed voice ID');
    // The row names the declaration the click navigates to — the owning dialog,
    // which `runRules` enriched it with — *and* the line the offending
    // AI_Output is on, #267's second half. That call is the fixture's 17th line.
    await expect(firstRow).toContainText('dia.d · DIA_Prob_Test · line 17');

    // Clicking the problem jumps to the dialog view with the dialog selected.
    await firstRow.click();
    await expect(page.getByRole('heading', { name: 'DIA_Prob_Test', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('Rescan keeps the problem after a manual re-scan', async ({ page }) => {
    await page.getByTestId('problems-toggle').click();
    await expect(page.getByTestId('problem-row-0')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('problems-rescan').click();
    await expect(page.getByTestId('problem-row-0')).toContainText('BadVoiceId');
  });
});

// #264, the second half: the OU database is what the game shows, so a line
// edited here is stale in game until the database is rewritten. The panel
// lists the drift (the check half) and now offers to write it. Browser harness:
// the mock stands in for the file, so this proves the flow — the button, the
// confirmation, the findings clearing — and the byte-level rewrite is the
// zenkit-node and main-process suites'.
const OU_DIALOG = `INSTANCE DIA_Ou_Test(C_INFO)
{
\tnpc = SLD_OuNpc;
\tnr = 1;
\tcondition = DIA_Ou_Test_Condition;
\tinformation = DIA_Ou_Test_Info;
\timportant = FALSE;
};

FUNC INT DIA_Ou_Test_Condition()
{
\treturn TRUE;
};

FUNC VOID DIA_Ou_Test_Info()
{
\tAI_Output(self, other, "DIA_Ou_Test_15_00"); //Neuer Text.
\tAI_Output(other, self, "DIA_Ou_Test_03_01"); //Ganz neu.
};
`;

test.describe('Problems panel: updating the OU database', () => {
  test('writes the stale and missing subtitles, and the findings clear', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_outest/dia.d', content);
      localStorage.setItem('mockapi_output_units', JSON.stringify({
        filePath: 'C:/Gothic/_work/Data/Scripts/content/CUTSCENE/OU.BIN',
        format: 'BINARY',
        units: [
          { name: 'DIA_OU_TEST_15_00', text: 'Alter Text.', wav: 'DIA_OU_TEST_15_00.WAV' },
          { name: 'DIA_XARDAS_14_00', text: 'Vanilla.', wav: 'DIA_XARDAS_14_00.WAV' },
        ],
      }));
    }, OU_DIALOG);
    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('project folder path')) await dialog.accept('outest');
      else await dialog.dismiss();
    });
    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await expect(page.getByText('SLD_OuNpc')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('problems-toggle').click();
    const panel = page.getByTestId('problems-panel');
    await expect(panel.getByText(/still holds "Alter Text\."/)).toBeVisible({ timeout: 15000 });
    await expect(panel.getByText(/"DIA_Ou_Test_03_01" is not in the OutputUnit database/)).toBeVisible();

    await panel.getByRole('button', { name: 'Update OUs (2 lines)' }).click();
    const confirm = page.getByRole('dialog', { name: 'Update the OU database' });
    await expect(confirm).toContainText('OU.BIN');
    await expect(confirm).toContainText('.bak');
    await confirm.getByRole('button', { name: 'Update' }).click();
    await expect(confirm).toBeHidden();

    await expect(panel.getByText(/still holds "Alter Text\."/)).toBeHidden({ timeout: 10000 });
    await expect(panel.getByText(/is not in the OutputUnit database/)).toBeHidden();
    await expect(panel.getByRole('button', { name: /Update OUs/ })).toBeHidden();

    // The harness's regex parser takes a line's id for its text rather than
    // the comment, so what is asserted is the flow's part: the stale entry
    // rewritten, the missing one added, the vanilla one untouched.
    const database = await page.evaluate(() => JSON.parse(localStorage.getItem('mockapi_output_units') ?? 'null'));
    const byName = new Map(database.units.map((u: { name: string; text: string }) => [u.name, u.text]));
    expect(byName.get('DIA_OU_TEST_15_00')).not.toBe('Alter Text.');
    expect(byName.has('DIA_OU_TEST_03_01')).toBe(true);
    expect(byName.get('DIA_XARDAS_14_00')).toBe('Vanilla.');
  });
});

// #265: German MDK scripts over an English OU. Every line reads as stale, and
// "Update OUs" would overwrite the English — the report's complaint exactly. So
// the panel names the likely cause, and the confirmation repeats it.
test.describe('Problems panel: an OU in another language', () => {
  test('says the OU may be in another language, and warns before overwriting it', async ({ page }) => {
    const ids = Array.from({ length: 24 }, (_, i) => `DIA_Lang_Test_15_${String(i).padStart(2, '0')}`);
    const dialog = `INSTANCE DIA_Lang_Test(C_INFO)
{
\tnpc = SLD_LangNpc;
\tnr = 1;
\tcondition = DIA_Lang_Test_Condition;
\tinformation = DIA_Lang_Test_Info;
\timportant = FALSE;
};

FUNC INT DIA_Lang_Test_Condition()
{
\treturn TRUE;
};

FUNC VOID DIA_Lang_Test_Info()
{
${ids.map((id) => `\tAI_Output(self, other, "${id}"); //Deutscher Satz.`).join('\n')}
};
`;
    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
    await page.evaluate(({ content, units }) => {
      localStorage.setItem('mockapi_file_langtest/dia.d', content);
      localStorage.setItem('mockapi_output_units', JSON.stringify({
        filePath: 'C:/Gothic/_work/Data/Scripts/content/CUTSCENE/OU.BIN', format: 'BINARY', units,
      }));
    }, { content: dialog, units: ids.map((id) => ({ name: id.toUpperCase(), text: 'An English sentence.', wav: `${id.toUpperCase()}.WAV` })) });
    page.on('dialog', async (d) => {
      if (d.message().includes('project folder path')) await d.accept('langtest');
      else await d.dismiss();
    });
    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await expect(page.getByText('SLD_LangNpc')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('problems-toggle').click();
    const panel = page.getByTestId('problems-panel');
    const banner = panel.getByTestId('problems-ou-language');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner).toContainText('24 of 24');
    await expect(banner).toContainText(/another language/);

    await panel.getByRole('button', { name: /Update OUs/ }).click();
    const confirm = page.getByRole('dialog', { name: 'Update the OU database' });
    await expect(confirm).toContainText(/another language/);
    await expect(confirm.getByRole('button', { name: 'Overwrite anyway' })).toBeVisible();
  });

  test('says nothing of languages when only a few lines were edited', async ({ page }) => {
    // The first describe's fixture: one stale line and one missing one.
    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
    await page.evaluate((content) => {
      localStorage.setItem('mockapi_file_outest/dia.d', content);
      localStorage.setItem('mockapi_output_units', JSON.stringify({
        filePath: 'C:/Gothic/_work/Data/Scripts/content/CUTSCENE/OU.BIN', format: 'BINARY',
        units: [{ name: 'DIA_OU_TEST_15_00', text: 'Alter Text.', wav: 'DIA_OU_TEST_15_00.WAV' }],
      }));
    }, OU_DIALOG);
    page.on('dialog', async (d) => {
      if (d.message().includes('project folder path')) await d.accept('outest');
      else await d.dismiss();
    });
    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await expect(page.getByText('SLD_OuNpc')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('problems-toggle').click();
    const panel = page.getByTestId('problems-panel');
    await expect(panel.getByText(/still holds "Alter Text\."/)).toBeVisible({ timeout: 15000 });
    await expect(panel.getByTestId('problems-ou-language')).toHaveCount(0);
  });
});
