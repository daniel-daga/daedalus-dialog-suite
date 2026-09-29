import { test, expect, type Page } from '@playwright/test';

/**
 * Browser mock-harness spec for the routine editor (docs/plans/npc-editor.md
 * §6; NOT end-to-end). The harness has no world, so this drives the editor
 * from the NPC editor, where it needs none: the routines at the top, the
 * selected routine's activities below, a 24-hour timeline, and a Save that
 * writes the routine function and re-indexes it. What the mock cannot prove is
 * byte fidelity — that is tests/routineEntries.test.ts, over the writer the
 * real save runs.
 */

const NPC_FILE = `INSTANCE BAU_900_Onar (C_NPC)
{
	name = "Onar";
	id = 900;
	daily_routine = Rtn_Start_900;
};

FUNC VOID Rtn_Start_900()
{
	TA_Sit_Throne (07,00,22,00,"NW_THRONE");
	TA_Sleep (22,00,07,00,"NW_BED");
};
`;

const CHAPTER_FILE = `FUNC VOID Rtn_Kapitel3_900()
{
	TA_Stand_Guarding (08,00,20,00,"NW_GATE");
	TA_Sleep (20,00,08,00,"NW_BED");
};

FUNC VOID B_Enter_NewWorld_Kapitel_3()
{
	B_StartOtherRoutine (BAU_900_Onar, "Kapitel3");
};
`;

const TA_FILE = `FUNC VOID TA_Stand_Guarding(var int start_h, var int start_m, var int stop_h, var int stop_m, var string waypoint)
{
};
`;

const NPC_PATH = 'project/NPC/BAU_900_Onar.d';

async function openProject(page: Page, extraFiles: Record<string, string> = {}, npcFile = NPC_FILE) {
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  await page.evaluate(({ npc, ta, npcPath, files }) => {
    localStorage.setItem(`mockapi_file_${npcPath}`, npc);
    localStorage.setItem('mockapi_file_project/AI/TA.d', ta);
    for (const [path, source] of Object.entries(files)) localStorage.setItem(`mockapi_file_project/${path}`, source);
  }, { npc: npcFile, ta: TA_FILE, npcPath: NPC_PATH, files: extraFiles });
  page.on('dialog', async (dialog) => {
    if (dialog.message().includes('project folder path')) await dialog.accept('project');
    else await dialog.dismiss();
  });
  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await expect(page.getByText('BAU_900_Onar')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('project-opening-overlay')).toBeHidden({ timeout: 15000 });
}

async function openRoutineEditor(page: Page) {
  await page.getByRole('button', { name: 'Edit NPC BAU_900_Onar' }).click();
  const npcEditor = page.getByRole('dialog', { name: /BAU_900_Onar/ });
  await npcEditor.getByRole('button', { name: 'Edit routine RTN_START_900', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Routines of BAU_900_Onar' });
  await expect(editor).toBeVisible();
  return editor;
}

const activity = (editor: ReturnType<Page['getByRole']>, n: number) => editor.getByRole('group', { name: `Activity ${n}`, exact: true });
const savedFile = (page: Page) => page.evaluate((path) => localStorage.getItem(`mockapi_file_${path}`), NPC_PATH);

test.describe('Routine editor', () => {
  test.beforeEach(async ({ page }) => {
    await openProject(page);
  });

  test('shows the routine and its activities as the script declares them', async ({ page }) => {
    const editor = await openRoutineEditor(page);

    await expect(editor.getByRole('button', { name: 'Daily: RTN_START_900' })).toHaveAttribute('aria-pressed', 'true');
    await expect(activity(editor, 1).getByLabel('Activity', { exact: true })).toHaveValue('TA_Sit_Throne');
    await expect(activity(editor, 1).getByLabel('Start')).toHaveValue('07:00');
    await expect(activity(editor, 1).getByLabel('End')).toHaveValue('22:00');
    await expect(activity(editor, 1).getByLabel('Waypoint')).toHaveValue('NW_THRONE');
    await expect(activity(editor, 2).getByLabel('Activity', { exact: true })).toHaveValue('TA_Sleep');
    await expect(activity(editor, 2).getByLabel('Start')).toHaveValue('22:00');
  });

  test('a typed end moves the next activity with it, and Save writes both and re-indexes', async ({ page }) => {
    const editor = await openRoutineEditor(page);

    await activity(editor, 1).getByLabel('End').fill('21:30');
    await activity(editor, 1).getByLabel('End').blur();
    await expect(activity(editor, 2).getByLabel('Start')).toHaveValue('21:30');

    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();

    const saved = await savedFile(page);
    expect(saved).toContain('TA_Sit_Throne (07,00,21,30,"NW_THRONE");');
    expect(saved).toContain('TA_Sleep (21,30,07,00,"NW_BED");');

    // The NPC editor's list reads the index, which the save re-read.
    const npcEditor = page.getByRole('dialog', { name: /BAU_900_Onar/ });
    await expect(npcEditor.getByRole('list', { name: 'Daily: RTN_START_900' })).toContainText('07:00–21:30');
  });

  test('dragging a boundary on the timeline snaps to the quarter hour', async ({ page }) => {
    const editor = await openRoutineEditor(page);
    const bar = editor.getByTestId('routine-timeline');
    const handle = bar.getByRole('slider', { name: 'Boundary at 22:00' });
    const box = (await bar.boundingBox())!;
    const from = (await handle.boundingBox())!;

    // 20:37 on the bar's scale, which snaps to 20:30.
    const x = box.x + box.width * ((20 * 60 + 37) / 1440);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, from.y + from.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect(activity(editor, 1).getByLabel('End')).toHaveValue('20:30');
    await expect(activity(editor, 2).getByLabel('Start')).toHaveValue('20:30');
  });

  test('adding an activity splits the selected one, and it takes its own state and waypoint', async ({ page }) => {
    const editor = await openRoutineEditor(page);

    await activity(editor, 1).click();
    await editor.getByRole('button', { name: 'Add activity' }).click();
    await expect(activity(editor, 1).getByLabel('End')).toHaveValue('14:30');
    await expect(activity(editor, 2).getByLabel('Start')).toHaveValue('14:30');
    await expect(activity(editor, 2).getByLabel('End')).toHaveValue('22:00');

    await activity(editor, 2).getByLabel('Activity', { exact: true }).fill('TA_Stand_Guarding');
    await page.getByRole('option', { name: 'TA_Stand_Guarding', exact: true }).click();
    await activity(editor, 2).getByLabel('Waypoint').fill('WP_GATE');
    await activity(editor, 2).getByLabel('Waypoint').blur();

    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();
    const saved = (await savedFile(page))!;
    const lines = saved.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('TA_'));
    expect(lines).toEqual([
      'TA_Sit_Throne (07,00,14,30,"NW_THRONE");',
      'TA_Stand_Guarding (14,30,22,00,"WP_GATE");',
      'TA_Sleep (22,00,07,00,"NW_BED");',
    ]);
  });

  test('removing an activity gives its time to the one before, and undo brings it back', async ({ page }) => {
    const editor = await openRoutineEditor(page);

    await activity(editor, 2).getByRole('button', { name: 'Remove activity' }).click();
    await expect(activity(editor, 2)).toHaveCount(0);
    await expect(activity(editor, 1).getByLabel('End')).toHaveValue('07:00');

    await editor.getByRole('button', { name: 'Undo' }).click();
    await expect(activity(editor, 2).getByLabel('Activity', { exact: true })).toHaveValue('TA_Sleep');
    await expect(activity(editor, 1).getByLabel('End')).toHaveValue('22:00');
  });

  test('"In world" with no world open, and none the NPC\'s spawn names, offers the world picker', async ({ page }) => {
    // Never a dead end (Daniel, 2026-09-29). The harness has no world
    // (tests/e2e/README.md) and Onar has no STARTUP_ spawn here, so this is
    // the fallback: the World view, with its picker open. The auto-open is
    // tests/e2e-electron/routine-in-world.spec.ts.
    await page.getByRole('button', { name: 'Edit NPC BAU_900_Onar' }).click();
    const npcEditor = page.getByRole('dialog', { name: /BAU_900_Onar/ });
    await npcEditor.getByRole('button', { name: 'Edit routine RTN_START_900 in the world' }).click();

    await expect(npcEditor).toBeHidden();
    await expect(page.getByTestId('world-picker')).toBeVisible();
  });

  test('a gap in the day is an error, and red on the timeline', async ({ page }) => {
    const editor = await openRoutineEditor(page);
    await expect(editor.getByTestId('routine-gap')).toHaveCount(0);

    // Alt detaches the boundary: Throne ends at 21:00, Sleep still starts at
    // 22:00, and the hour between belongs to no activity.
    const bar = editor.getByTestId('routine-timeline');
    const handle = bar.getByRole('slider', { name: 'Boundary at 22:00' });
    const box = (await bar.boundingBox())!;
    const from = (await handle.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * ((21 * 60) / 1440), from.y + from.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Alt');

    await expect(activity(editor, 2).getByLabel('Start')).toHaveValue('22:00');
    const alert = editor.getByRole('alert');
    await expect(alert).toContainText('Gap 21:00–22:00');
    await expect(alert).toHaveClass(/MuiAlert-.*Error/);
    const gap = editor.getByTestId('routine-gap');
    await expect(gap).toHaveCount(1);
    await expect(gap).toHaveAttribute('title', 'Gap 21:00–22:00');
  });

  // #280: the same combo-box fix given to the Topic field on Log Entry --
  // MUI already opens an Autocomplete's list on a mouse click, but not when
  // the field is tabbed into, which is how this dense grid of activity rows
  // is meant to be worked through.
  test('the Activity field opens its options on focus alone, not just on click', async ({ page }) => {
    const editor = await openRoutineEditor(page);

    await activity(editor, 2).getByLabel('Activity', { exact: true }).focus();

    await expect(page.getByRole('option', { name: 'TA_Stand_Guarding', exact: true })).toBeVisible();
  });

  test('Cancel leaves the file as it was', async ({ page }) => {
    const before = await savedFile(page);
    const editor = await openRoutineEditor(page);

    await activity(editor, 1).getByLabel('End').fill('21:00');
    await activity(editor, 1).getByLabel('End').blur();
    await editor.getByRole('button', { name: 'Cancel' }).click();
    await expect(editor).toBeHidden();

    expect(await savedFile(page)).toBe(before);
  });
});

// A routine changes with the chapter only because a script switches to a
// variant at the chapter change; the editor names that switch, and the
// chapter it is for, beside the variant.
test.describe('Routine editor: chapter variants', () => {
  test('lists the variant with the chapter that switches to it, and edits it like the daily routine', async ({ page }) => {
    await openProject(page, { 'Story/Kapitel3.d': CHAPTER_FILE });
    const editor = await openRoutineEditor(page);

    const variant = editor.getByRole('button', { name: 'KAPITEL3: RTN_KAPITEL3_900' });
    await expect(variant).toBeVisible();
    await expect(editor.getByText('Chapter 3')).toBeVisible();
    await expect(editor.getByText('Switched to in B_ENTER_NEWWORLD_KAPITEL_3')).toBeVisible();

    await variant.click();
    await expect(activity(editor, 1).getByLabel('Activity', { exact: true })).toHaveValue('TA_Stand_Guarding');
    await activity(editor, 1).getByLabel('Waypoint').fill('NW_TOWER');
    await activity(editor, 1).getByLabel('Waypoint').blur();
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();

    const saved = await page.evaluate(() => localStorage.getItem('mockapi_file_project/Story/Kapitel3.d'));
    expect(saved).toContain('TA_Stand_Guarding (08,00,20,00,"NW_TOWER");');
  });
});

const FARMER_FILE = `INSTANCE BAU_901_Bauer (C_NPC)
{
	name = "Bauer";
	id = 901;
};
`;

// npc-editor.md §6 slice 5 (#316): a routine is created, never switched to by
// the editor — the switch is the dialog editor's exchange-routine action,
// written where the story decides it.
test.describe('Routine editor: creating routines', () => {
  test('creates a daily routine for an NPC that has none, and declares it', async ({ page }) => {
    await openProject(page, { 'NPC/BAU_901_Bauer.d': FARMER_FILE });
    await page.getByRole('button', { name: 'Edit NPC BAU_901_Bauer' }).click();
    const npcEditor = page.getByRole('dialog', { name: /BAU_901_Bauer/ });
    await npcEditor.getByRole('button', { name: 'Create routine' }).click();
    const editor = page.getByRole('dialog', { name: 'Routines of BAU_901_Bauer' });

    const form = editor.getByRole('group', { name: 'New routine' });
    await form.getByLabel('Activity', { exact: true }).fill('TA_Stand_Guarding');
    await page.getByRole('option', { name: 'TA_Stand_Guarding', exact: true }).click();
    await form.getByLabel('Waypoint').fill('WP_FARM');
    await form.getByRole('button', { name: 'Create daily routine' }).click();

    await expect(editor.getByRole('button', { name: 'Daily: RTN_START_901' })).toHaveAttribute('aria-pressed', 'true');
    await expect(activity(editor, 1).getByLabel('Activity', { exact: true })).toHaveValue('TA_Stand_Guarding');
    const saved = await page.evaluate(() => localStorage.getItem('mockapi_file_project/NPC/BAU_901_Bauer.d'));
    expect(saved).toContain('daily_routine = Rtn_Start_901;');
    expect(saved).toContain('TA_Stand_Guarding (00,00,00,00,"WP_FARM");');
  });

  test('a new routine starts as a copy of the one shown, and says nothing switches to it yet', async ({ page }) => {
    await openProject(page);
    const editor = await openRoutineEditor(page);

    await editor.getByRole('button', { name: 'New routine' }).click();
    const form = editor.getByRole('group', { name: 'New routine' });
    await form.getByLabel('Name').fill('Ship');
    await form.getByRole('button', { name: 'Create routine' }).click();

    await expect(editor.getByRole('button', { name: 'SHIP: RTN_SHIP_900' })).toHaveAttribute('aria-pressed', 'true');
    await expect(editor.getByText('Nothing in the scripts switches to it by name')).toBeVisible();
    await expect(activity(editor, 1).getByLabel('Activity', { exact: true })).toHaveValue('TA_Sit_Throne');
    const saved = (await savedFile(page))!;
    const ship = saved.slice(saved.indexOf('Rtn_Ship_900'));
    expect(ship).toContain('TA_Sit_Throne (07,00,22,00,"NW_THRONE");');
    expect(ship).toContain('TA_Sleep (22,00,07,00,"NW_BED");');
  });

  test('refuses a name whose routine already exists', async ({ page }) => {
    await openProject(page);
    const editor = await openRoutineEditor(page);

    await editor.getByRole('button', { name: 'New routine' }).click();
    const form = editor.getByRole('group', { name: 'New routine' });
    await form.getByLabel('Name').fill('Start');
    await expect(form.getByText('Rtn_Start_900 already exists')).toBeVisible();
    await expect(form.getByRole('button', { name: 'Create routine' })).toBeDisabled();
  });
});

test.describe('Routine editor: a long day', () => {
  test('twelve activities stay one compact line each, with the column names said once', async ({ page }) => {
    // Retail days run to 10+ activities (Daniel, 2026-09-28).
    const lines = Array.from({ length: 12 }, (_, i) => {
      const hour = (h: number) => String(h % 24).padStart(2, '0');
      return `\tTA_Sleep (${hour(i * 2)},00,${hour(i * 2 + 2)},00,"WP_${i}");`;
    });
    const longDay = NPC_FILE.replace(/(FUNC VOID Rtn_Start_900\(\)\n\{\n)[\s\S]*?(\n\};)/, `$1${lines.join('\n')}$2`);
    await openProject(page, {}, longDay);
    const editor = await openRoutineEditor(page);

    await expect(activity(editor, 12).getByLabel('Waypoint')).toHaveValue('WP_11');
    for (const n of [1, 6, 12]) {
      const box = (await activity(editor, n).boundingBox())!;
      expect(box.height).toBeLessThanOrEqual(36);
    }
    await expect(editor.getByTestId('routine-columns')).toContainText('Activity');
  });
});
