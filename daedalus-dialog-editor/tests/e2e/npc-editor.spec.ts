import { test, expect, type Page } from '@playwright/test';

/**
 * Browser mock-harness spec for the NPC editor (docs/plans/npc-editor.md,
 * Phase 2; NOT end-to-end). UI state only, per tests/e2e/README.md: the mock
 * stands in for the parser's NPC reader/writer, so what this proves is the
 * flow — open from the NPC list, the form shows the NPC, an edit survives a
 * save and a reopen, Cancel discards. Byte-level save fidelity is the
 * parser's own suite (daedalus-parser/test/npc-definition.test.js).
 */

const NPC_FILE = `INSTANCE BAU_900_Onar (C_NPC)
{
	name = "Onar";
	guild = GIL_BAU;
	level = 20;
	B_SetNpcVisual (self, MALE, "Hum_Head_Fatbald", Face_N_Weak_Orry, BodyTex_N, ITAR_Vlk_H);
	EquipItem (self, ItMw_1h_Bau_Mace);
	daily_routine = Rtn_Start_900;
};
`;

async function openProject(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  await page.evaluate((content) => {
    localStorage.setItem('mockapi_file_project/NPC/BAU_900_Onar.d', content);
  }, NPC_FILE);
  page.on('dialog', async (dialog) => {
    if (dialog.message().includes('project folder path')) {
      await dialog.accept('project');
    } else {
      await dialog.dismiss();
    }
  });
  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await expect(page.getByText('BAU_900_Onar')).toBeVisible({ timeout: 15000 });
}

async function openEditor(page: Page) {
  await page.getByRole('button', { name: 'Edit NPC BAU_900_Onar' }).click();
  const editor = page.getByRole('dialog', { name: /BAU_900_Onar/ });
  await expect(editor).toBeVisible();
  return editor;
}

test.describe('NPC editor', () => {
  test.beforeEach(async ({ page }) => {
    await openProject(page);
  });

  test('shows the NPC as its script declares it', async ({ page }) => {
    const editor = await openEditor(page);

    await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Onar');
    await expect(editor.getByLabel('Guild')).toHaveValue('GIL_BAU');
    await expect(editor.getByLabel('Level')).toHaveValue('20');
    await expect(editor.getByLabel('Daily routine')).toHaveValue('Rtn_Start_900');
    await expect(editor.getByLabel('Head mesh')).toHaveValue('Hum_Head_Fatbald');
    await expect(editor.getByLabel('Armor')).toHaveValue('ITAR_Vlk_H');
    await expect(editor.getByLabel('Melee weapon')).toHaveValue('ItMw_1h_Bau_Mace');
    await expect(editor.getByLabel('Ranged weapon')).toHaveValue('');
    // Absent from the script, so empty — not a default the editor invented.
    await expect(editor.getByLabel('Strength')).toHaveValue('');
  });

  test('an edit survives save and reopen', async ({ page }) => {
    let editor = await openEditor(page);
    await editor.getByLabel('Guild').fill('GIL_SLD');
    await editor.getByLabel('Level').fill('25');
    await editor.getByLabel('Strength').fill('80');
    await editor.getByLabel('Armor').fill('ITAR_Sld_M');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();

    editor = await openEditor(page);
    await expect(editor.getByLabel('Guild')).toHaveValue('GIL_SLD');
    await expect(editor.getByLabel('Level')).toHaveValue('25');
    await expect(editor.getByLabel('Strength')).toHaveValue('80');
    await expect(editor.getByLabel('Armor')).toHaveValue('ITAR_Sld_M');
    await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Onar');
  });

  test('a second weapon is added beside the first, and each keeps its own call', async ({ page }) => {
    let editor = await openEditor(page);
    await editor.getByLabel('Ranged weapon').fill('ItRw_Sld_Bow');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();

    editor = await openEditor(page);
    await expect(editor.getByLabel('Melee weapon')).toHaveValue('ItMw_1h_Bau_Mace');
    await expect(editor.getByLabel('Ranged weapon')).toHaveValue('ItRw_Sld_Bow');

    // Editing the ranged weapon must not touch the melee one's call.
    await editor.getByLabel('Ranged weapon').fill('ItRw_Crossbow_L_01');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();

    editor = await openEditor(page);
    await expect(editor.getByLabel('Melee weapon')).toHaveValue('ItMw_1h_Bau_Mace');
    await expect(editor.getByLabel('Ranged weapon')).toHaveValue('ItRw_Crossbow_L_01');
  });

  test('Cancel discards the edit', async ({ page }) => {
    let editor = await openEditor(page);
    await editor.getByLabel('Name', { exact: true }).fill('Someone else');
    await editor.getByRole('button', { name: 'Cancel' }).click();
    await expect(editor).toBeHidden();

    editor = await openEditor(page);
    await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Onar');
  });

  // #285, Create NPC: a new NPC is a copy of one the project already has, so
  // it only uses what the mod defines (#141 removed an Add NPC that did not).
  test('a new NPC copied from another is written, listed and opened for editing', async ({ page }) => {
    await page.getByRole('button', { name: 'New NPC' }).click();
    const create = page.getByRole('dialog', { name: 'New NPC' });
    await expect(create).toBeVisible();

    await expect(create.getByLabel('Copy of')).toHaveValue('BAU_900_Onar');
    await create.getByLabel('Instance').fill('BAU_901_Harald');
    await create.getByLabel('Name', { exact: true }).fill('Harald');
    // Offered from the template and the project, and editable.
    await expect(create.getByLabel('Guild')).toHaveValue('GIL_BAU');
    await expect(create.getByLabel('Id')).toHaveValue('901');
    await expect(create.getByLabel('File')).toHaveValue('project/NPC/BAU_901_Harald.d');
    await create.getByRole('button', { name: 'Create' }).click();
    await expect(create).toBeHidden();

    const editor = page.getByRole('dialog', { name: /BAU_901_Harald/ });
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Harald');
    await expect(editor.getByLabel('Melee weapon')).toHaveValue('ItMw_1h_Bau_Mace');
    await expect(editor.getByLabel('Daily routine')).toHaveValue('');
    await editor.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByText('BAU_901_Harald')).toBeVisible();
    const written = await page.evaluate(() => localStorage.getItem('mockapi_file_project/NPC/BAU_901_Harald.d'));
    expect(written).toContain('INSTANCE BAU_901_Harald (C_NPC)');
    expect(written).toContain('name = "Harald";');
    expect(written).toContain('id = 901;');
    expect(written).not.toContain('daily_routine');
    // Like an NPC file dropped into the folder (#141), it gets its EXIT dialog.
    await expect.poll(() => page.evaluate(() => localStorage.getItem('mockapi_file_project/NPC/DIA_BAU_901_Harald.d')))
      .toContain('\tnpc\t\t\t= BAU_901_Harald;');
    // The template is untouched.
    const template = await page.evaluate(() => localStorage.getItem('mockapi_file_project/NPC/BAU_900_Onar.d'));
    expect(template).toContain('name = "Onar";');
  });

  test('a new NPC refuses an instance the project already has', async ({ page }) => {
    await page.getByRole('button', { name: 'New NPC' }).click();
    const create = page.getByRole('dialog', { name: 'New NPC' });
    await create.getByLabel('Instance').fill('bau_900_onar');
    await create.getByLabel('Name', { exact: true }).fill('Onar again');
    await create.getByRole('button', { name: 'Create' }).click();
    await expect(create.getByText(/already exists/)).toBeVisible();
    await expect(create).toBeVisible();
  });
});


// #285: a routine entry's "World" jump goes to its waypoint in the World
// surface, and says why not when it cannot. It leaves the NPC editor, so it
// waits for an unsaved form to be saved or cancelled. The browser harness has no
// world, so the jump itself is tests/NpcRoutinesSection.test.tsx's.
const ROUTINE_FILE = `FUNC VOID Rtn_Start_900 ()
{
\tTA_Stand_ArmsCrossed (08,00,20,00,"NW_BIGFARM_HOUSE_ONAR");
\tTA_Sleep (20,00,08,00,"NW_BIGFARM_HOUSE_ONAR_BED");
};
`;

test.describe('NPC editor: routine jumps', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
    await page.evaluate(({ npc, routine }) => {
      localStorage.setItem('mockapi_file_project/NPC/BAU_900_Onar.d', npc);
      localStorage.setItem('mockapi_file_project/Rtn/Rtn_Onar.d', routine);
    }, { npc: NPC_FILE, routine: ROUTINE_FILE });
    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('project folder path')) await dialog.accept('project');
      else await dialog.dismiss();
    });
    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await expect(page.getByText('BAU_900_Onar')).toBeVisible({ timeout: 15000 });
  });

  test('lists the routine and says why a waypoint cannot be shown while no world is open', async ({ page }) => {
    const editor = await openEditor(page);
    const daily = editor.getByRole('list', { name: 'Daily: RTN_START_900' });
    await expect(daily).toContainText('08:00–20:00');
    await expect(daily).toContainText('NW_BIGFARM_HOUSE_ONAR_BED');
    const show = editor.getByRole('button', { name: 'Show NW_BIGFARM_HOUSE_ONAR in the world' });
    await expect(show).toBeDisabled();
    await expect(editor.getByTitle('No world is open').first()).toBeVisible();
  });

  test('waits for unsaved changes before leaving the editor', async ({ page }) => {
    const editor = await openEditor(page);
    await editor.getByLabel('Level').fill('30');
    await expect(editor.getByTitle('Save or cancel your changes first').first()).toBeVisible();
  });
});


// #298: the preview beside the form. The harness mounts no assets (a world
// needs the native binding), so what this proves is the half above the
// worker: the visual read from the script and the project, following unsaved
// edits, and the panel saying why it draws no mesh. The worker request itself
// is tests/NpcVisualPreview.test.tsx's.
// The harness's regex parser reads neither constants nor items, so both files
// carry their model through the mock-model seam.
const constant = (name: string, value: number) => ({ name, type: 'int', value });
const CONSTANTS_FILE = `//__MOCK_MODEL__${JSON.stringify({
  constants: Object.fromEntries([
    constant('MALE', 0), constant('FEMALE', 1), constant('NO_ARMOR', -1),
    constant('BodyTex_N', 1), constant('Face_N_Weak_Orry', 42),
  ].map((c) => [c.name, c])),
})}\n`;
const ARMOR_FILE = `//__MOCK_MODEL__${JSON.stringify({
  items: {
    ITAR_Vlk_H: {
      name: 'ITAR_Vlk_H', parent: 'C_Item',
      sourceText: 'INSTANCE ITAR_Vlk_H (C_Item)\n{\n\tvisual = "ItAr_Vlk_H.3ds";\n\tvisual_change = "Armor_Vlk_H.asc";\n};',
    },
  },
})}\n`;

test.describe('NPC editor: preview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
    await page.evaluate(({ npc, constants, armor }) => {
      localStorage.setItem('mockapi_file_project/NPC/BAU_900_Onar.d', npc);
      localStorage.setItem('mockapi_file_project/Constants.d', constants);
      localStorage.setItem('mockapi_file_project/Items/IT_Armor.d', armor);
    }, { npc: NPC_FILE, constants: CONSTANTS_FILE, armor: ARMOR_FILE });
    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('project folder path')) await dialog.accept('project');
      else await dialog.dismiss();
    });
    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await expect(page.getByText('BAU_900_Onar')).toBeVisible({ timeout: 15000 });
  });

  test('shows what it would draw, follows the form, and says it needs a world', async ({ page }) => {
    const editor = await openEditor(page);
    const preview = editor.getByTestId('npc-preview');

    // The armour's visual_change replaces the naked body, as in the engine.
    await expect(preview.getByTestId('npc-preview-summary')).toHaveText('Armor_Vlk_H.asc · head Hum_Head_Fatbald');
    await expect(preview.getByTestId('npc-preview-no-world')).toBeVisible();

    // Unsaved edits are previewed: no armour is the naked male body.
    await editor.getByLabel('Armor').fill('NO_ARMOR');
    await editor.getByLabel('Head mesh').fill('Hum_Head_Bald');
    await expect(preview.getByTestId('npc-preview-summary')).toHaveText('hum_body_Naked0 · head Hum_Head_Bald');

    // A constant the project does not define is why it cannot draw.
    await editor.getByLabel('Face texture').fill('Face_Unknown');
    await expect(preview.getByTestId('npc-preview-reason')).toContainText('Face_Unknown is not a known integer constant');
  });
});
