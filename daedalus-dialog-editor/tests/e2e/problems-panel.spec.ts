import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { viteFsUrl } from '../viteFsUrl';

/**
 * E2E for the project-wide Problems panel.
 *
 * The fixture produces exactly one problem: the info function's AI_Output voice
 * id ("BadVoiceId") does not match the vanilla `…_<n>_<n>` pattern, so the
 * `voice-id-malformed` lint fires. Because that function is the dialog's
 * `information`, the problem is enriched with the owning dialog. Clicking it
 * opens details in Problems. The dialog's condition/info functions are
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

test('large problem lists render one page and search across every page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  await page.evaluate(() => {
    const buildIndex = window.editorAPI.buildProjectIndex.bind(window.editorAPI);
    window.editorAPI.buildProjectIndex = async (folderPath) => ({
      ...await buildIndex(folderPath),
      parseErrors: [{ filePath: 'large/broken.d', total: 10001,
        errors: Array.from({ length: 10001 }, (_, i) => ({ message: `Broken statement ${i}`, line: i + 1, column: 1 })) }],
    });
  });
  page.on('dialog', async (dialog) => {
    if (dialog.message().includes('project folder path')) await dialog.accept('large');
    else await dialog.dismiss();
  });
  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await page.getByTestId('problems-toggle').click();
  const panel = page.getByTestId('problems-panel');
  await expect(panel.getByTestId('problems-filter-count')).toHaveText('10001 / 10001 shown');
  await expect(panel.getByTestId(/^problem-row-\d+$/)).toHaveCount(50);
  await panel.getByRole('button', { name: 'Go to last page' }).click();
  await expect(panel.getByTestId('problem-row-10000')).toContainText('Broken statement 9999');
  await panel.getByRole('textbox', { name: 'Search problems' }).fill('Broken statement 9999');
  await expect(panel.getByTestId('problems-filter-count')).toHaveText('1 / 10001 shown');
  await expect(panel.getByTestId('problem-row-0')).toContainText('Broken statement 9999');
});

test('Kind counts show other findings even while one kind is selected', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  await page.evaluate((content) => {
    localStorage.setItem('mockapi_file_probtest/dia.d', content);
  }, `${PROJECT_FILE_CONTENT}\nFUNC VOID UnusedHelper() { };\nFUNC VOID AnotherHelper() { };`);
  page.on('dialog', async (dialog) => {
    if (dialog.message().includes('project folder path')) await dialog.accept('probtest');
    else await dialog.dismiss();
  });
  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await page.getByTestId('problems-toggle').click();
  const panel = page.getByTestId('problems-panel');
  await expect(panel.getByTestId('problems-filter-count')).toHaveText('3 / 3 shown');
  await panel.getByRole('combobox', { name: 'Kind', exact: true }).click();
  await expect(page.getByRole('option', { name: 'All kinds (3)', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'Orphaned function (2)', exact: true }).click();
  await expect(panel.getByTestId('problems-filter-count')).toHaveText('2 / 3 shown');
  await panel.getByRole('combobox', { name: /^Kind/ }).click();
  await expect(page.getByRole('option', { name: 'Orphaned function (2)', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'Malformed voice ID (1)', exact: true }).click();
  await expect(panel.getByTestId('problem-row-0')).toContainText('BadVoiceId');
  await expect(panel.getByTestId('problems-filter-count')).toHaveText('1 / 3 shown');
  await panel.getByRole('textbox', { name: 'Search problems' }).fill('UnusedHelper');
  await panel.getByRole('combobox', { name: /^Kind/ }).click();
  await expect(page.getByRole('option', { name: 'All kinds (1)', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Malformed voice ID (0)', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'Orphaned function (1)', exact: true }).click();
  await expect(panel.getByTestId('problem-row-0')).toContainText('UnusedHelper');
});

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

  test('inspects a project-wide problem without leaving Problems or opening its file', async ({ page }) => {
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

    await page.evaluate(() => {
      window.editorAPI.openScriptInExternalEditor = async (filePath) => {
        localStorage.setItem('external-editor-file', filePath);
      };
    });
    await firstRow.click();
    const panel = page.getByTestId('problems-panel');
    await expect(page.getByTestId('problems-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByRole('heading', { name: 'Malformed voice ID', exact: true })).toBeVisible();
    await expect(panel).toContainText('probtest/dia.d');
    await expect(panel).toContainText('DIA_Prob_Test_Info');
    await expect(panel).toContainText('Line 17');
    await panel.getByRole('button', { name: 'Reload file', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'Malformed voice ID', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Edit externally' }).click();
    expect(await page.evaluate(() => localStorage.getItem('external-editor-file'))).toBe('probtest/dia.d');
    await page.evaluate(() => localStorage.setItem('mockapi_file_probtest/dia.d', '// repaired'));
    await panel.getByRole('button', { name: 'Reload file', exact: true }).click();
    await expect(panel.getByTestId('problems-empty')).toBeVisible();
    await expect(page.getByTestId('problems-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Rescan keeps the problem after a manual re-scan', async ({ page }) => {
    await page.getByTestId('problems-toggle').click();
    await expect(page.getByTestId('problem-row-0')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('problems-rescan').click();
    await expect(page.getByTestId('problem-row-0')).toContainText('BadVoiceId');
  });

  test('combines type, location, kind and text filters and resets them', async ({ page }) => {
    await page.getByTestId('problems-toggle').click();
    const panel = page.getByTestId('problems-panel');
    const row = panel.getByTestId('problem-row-0');
    await expect(row).toContainText('BadVoiceId');

    await panel.getByRole('combobox', { name: /^Type/ }).click();
    await page.getByRole('option', { name: 'Warning', exact: true }).click();
    await panel.getByRole('combobox', { name: 'Location', exact: true }).click();
    await page.getByRole('option', { name: 'probtest/dia.d', exact: true }).click();
    await panel.getByRole('combobox', { name: 'Kind', exact: true }).click();
    await expect(page.getByRole('option', { name: 'All kinds (1)', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Orphaned function (0)', exact: true })).toBeVisible();
    await page.getByRole('option', { name: 'Malformed voice ID (1)', exact: true }).click();
    await panel.getByRole('textbox', { name: 'Search problems' }).fill('bAdVoIcEiD');
    await expect(row).toContainText('BadVoiceId');
    await expect(panel.getByTestId('problems-filter-count')).toHaveText('1 / 1 shown');

    await panel.getByRole('combobox', { name: /^Type/ }).click();
    await page.getByRole('option', { name: 'Error', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(panel.getByTestId('problems-empty')).toHaveText('No problems match your filters.');
    await expect(panel.getByTestId('problems-filter-count')).toHaveText('0 / 1 shown');
    await panel.getByRole('combobox', { name: /^Kind/ }).click();
    await expect(page.getByRole('option', { name: 'All kinds (0)', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Malformed voice ID (0)', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    await panel.getByRole('button', { name: 'Reset filters' }).click();
    await expect(row).toContainText('BadVoiceId');
    await expect(panel.getByRole('textbox', { name: 'Search problems' })).toHaveValue('');
    await row.click();
    await expect(panel.getByRole('heading', { name: 'Malformed voice ID', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Back to problems', exact: true }).click();
    await expect(panel.getByRole('textbox', { name: 'Search problems' })).toHaveValue('');
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

test.describe('Problems panel: a world finding', () => {
  // #565: the row click stays in Problems (#560) and shows where the finding
  // is; the explicit button is the way to it in the World view.
  test('shows where a portal finding is and offers the way to it in the World view', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (message) => { if (message.type() === 'warning') warnings.push(message.text()); });
    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
    await page.evaluate(() => localStorage.setItem('mockapi_file_probworld/world.d', '// empty\n'));
    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('project folder path')) await dialog.accept('probworld');
      else await dialog.dismiss();
    });
    await page.getByRole('button', { name: /Open Project/i }).first().click();

    // The mock backend has no world; the finding is what the zenkit worker
    // would compute over the mesh, and reaches Problems the real way — the
    // World surface reads it on open and the scan picks it up from the store.
    await page.getByTestId('world-toggle').click();
    await page.evaluate(async (fixturePath) => {
      const { SUMMARY, vobIndex, BASE_PROPS } = await import(/* @vite-ignore */ fixturePath);
      const api = (window as unknown as { editorAPI: Record<string, unknown> }).editorAPI;
      api.listWorlds = async () => [{ path: SUMMARY.worldPath, name: 'NewWorld.zen', source: 'C:/Gothic', isDefault: false }];
      api.openWorld = async () => ({ ...SUMMARY, assetSources: [], vobIndex: vobIndex([[0, 0, 0]]) });
      api.getWorldMesh = async () => ({ groups: [], bbox: SUMMARY.bbox });
      api.getWorldVisuals = async () => ({ visuals: [], decals: { groups: [], count: 0 }, stats: {
        visualsSeen: 0, visualsResolved: 0, vobsPlaced: 0, instancedDrawGroups: 0,
        levelCompos: 0, unresolvedByType: {}, unresolved: [],
      } });
      api.getWorldItemInstances = async () => ({ vobs: [], instances: [] });
      api.getVobProps = async () => ({ class: 'zCVob', ...BASE_PROPS });
      api.getVobFolders = async () => ({ folders: [] });
      api.getWorldHistoryDepth = async () => ({ undo: 0, redo: 0 });
      api.getWorldPortalFindings = async () => [{
        kind: 'portal-reversed', material: 'P:CAPTAIN_', polygon: 456754, sector: 'CAPTAIN',
        corners: [[10, 0, 0], [10, 100, 0], [10, 100, 100], [10, 0, 100]],
      }];
    }, viteFsUrl(resolve(__dirname, '../worldFixtures.ts')));
    await page.getByTestId('world-open').click();
    await page.getByTestId('world-picker-entry-NewWorld.zen').click();
    await expect(page.getByRole('treeitem').first()).toBeVisible();

    await page.getByTestId('problems-toggle').click();
    const panel = page.getByTestId('problems-panel');
    const row = panel.getByTestId(/^problem-row-\d+$/).filter({ hasText: 'P:CAPTAIN_' });
    await expect(row).toContainText('World · polygon 456754');
    await row.click();

    // The click inspects; it does not leave Problems.
    await expect(page.getByTestId('problems-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByRole('heading', { name: 'Portal reversed', exact: true })).toBeVisible();
    await expect(panel).toContainText('World: C:/Gothic/NewWorld.zen');
    await expect(panel).toContainText('Polygon: 456754');

    await panel.getByRole('button', { name: 'Show in World', exact: true }).click();
    await expect(page.getByTestId('world-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('problems-panel')).toBeHidden();
    await expect(page.getByRole('treeitem').first()).toBeVisible();
    // The surface took the request and framed the polygon: a jump that does
    // not land is reported, not swallowed.
    expect(warnings.filter((text) => text.includes('Could not jump'))).toEqual([]);
  });
});

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
