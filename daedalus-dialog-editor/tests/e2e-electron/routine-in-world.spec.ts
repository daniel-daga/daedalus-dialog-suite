import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchApp, seedProjectDir, type AppFixture } from './harness';

/**
 * Real-Electron E2E for editing a routine in the World surface
 * (docs/plans/npc-editor.md §6, reworked 2026-09-29 after Daniel's review).
 *
 * - The NPC editor's "In world" never dead-ends: with no world open it opens
 *   the one the NPC's `STARTUP_<WORLD>` spawn names, and asks before it
 *   throws away unsaved edits to another.
 * - A waypoint's panel is the entry point from inside the world: it lists who
 *   spawns there and whose routine stops there, a row previews that routine on
 *   the map, and its button opens the editor.
 * - The editor is the same modal the NPC editor uses, over the world. Pick
 *   hides it, the bottom bar says what the next click does and offers Abort,
 *   and a waypoint click brings it back with the stop filled in.
 *
 * The browser mock harness opens no world, so this is the only suite that can
 * hold any of it. The viewport's projection is stood in for by
 * `__worldViewport.pickWaypoint` — everything past it is the real thing.
 */

const FIXTURE_WORLD = path.resolve(
  __dirname, '..', '..', '..', 'zenkit-node', 'test', 'fixtures', 'minimal.g2.zen',
);

const NPC = 'BAU_900_Onar';

// Someone else in the same world, whose spawn routine mode must not draw.
const OTHER_NPC_FILE = `INSTANCE BAU_901_Bauer (C_NPC)
{
	name = "Bauer";
	id = 901;
};
`;

// A second NPC on Onar's spawn, with a routine of his own.
const SHARED_SPAWN_NPC_FILE = `INSTANCE BAU_902_Knecht (C_NPC)
{
	name = "Knecht";
	id = 902;
	daily_routine = Rtn_Start_902;
};

FUNC VOID Rtn_Start_902()
{
	TA_Sleep (00,00,00,00,"WP_FIXTURE_C");
};
`;

const NPC_FILE = `INSTANCE BAU_900_Onar (C_NPC)
{
	name = "Onar";
	id = 900;
	daily_routine = Rtn_Start_900;
};

FUNC VOID Rtn_Start_900()
{
	TA_Stand_Guarding (07,00,22,00,"WP_FIXTURE_A");
	TA_Sleep (22,00,07,00,"WP_FIXTURE_B");
};
`;

// Retail-shaped wrappers: the index learns a routine state's layout from the
// parameters it hands on to the engine's TA_Min.
const TA_FILE = `FUNC VOID TA_Stand_Guarding(var int start_h, var int start_m, var int stop_h, var int stop_m, var string waypoint)
{
	TA_Min (self, start_h, start_m, stop_h, stop_m, ZS_Stand_Guarding, waypoint);
};

FUNC VOID TA_Sleep(var int start_h, var int start_m, var int stop_h, var int stop_m, var string waypoint)
{
	TA_Min (self, start_h, start_m, stop_h, stop_m, ZS_Sleep, waypoint);
};
`;

// The engine spawns a world's NPCs from the function named after its file, so
// this is what says Onar lives in MINIMAL.ZEN.
const STARTUP_FILE = `FUNC VOID STARTUP_MINIMAL()
{
	Wld_InsertNpc (BAU_900_Onar, "WP_FIXTURE_A");
	Wld_InsertNpc (BAU_901_Bauer, "WP_FIXTURE_C");
	Wld_InsertNpc (BAU_902_Knecht, "WP_FIXTURE_A");
};
`;

let addonAvailable = true;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('zenkit-node');
} catch {
  addonAvailable = false;
}

test.describe('Routine editing in the World surface', () => {
  test.skip(!addonAvailable, 'requires the built zenkit-node native addon');

  let fixture: AppFixture;
  let projectDir: string;
  let installDir: string;

  test.beforeEach(async () => {
    projectDir = seedProjectDir([]);
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dde-e2e-install-'));
    fs.mkdirSync(path.join(installDir, '_work', 'Data', 'Meshes', '_compiled'), { recursive: true });
    fs.copyFileSync(FIXTURE_WORLD, path.join(projectDir, 'MINIMAL.ZEN'));
    fs.copyFileSync(FIXTURE_WORLD, path.join(projectDir, 'OTHER.ZEN'));
    fs.writeFileSync(path.join(projectDir, 'Onar.d'), NPC_FILE, 'latin1');
    fs.writeFileSync(path.join(projectDir, 'Bauer.d'), OTHER_NPC_FILE, 'latin1');
    fs.writeFileSync(path.join(projectDir, 'Knecht.d'), SHARED_SPAWN_NPC_FILE, 'latin1');
    fs.writeFileSync(path.join(projectDir, 'TA.d'), TA_FILE, 'latin1');
    fs.writeFileSync(path.join(projectDir, 'Startup.d'), STARTUP_FILE, 'latin1');
    fs.writeFileSync(
      path.join(projectDir, `${path.basename(projectDir)}.gothicproject.json`),
      JSON.stringify({
        version: 1, target: 'g2-notr', scriptsRoot: '.', worlds: [], assetSources: ['.', installDir],
      }, null, 2),
      'utf8',
    );
    fixture = await launchApp();
    await fixture.app.evaluate(({ dialog }, project) => {
      (dialog as { showOpenDialog: (options: { title: string }) => unknown }).showOpenDialog = async (
        options: { title: string },
      ) => {
        if (options.title === 'Select Gothic Mod Project Folder') return { canceled: false, filePaths: [project] };
        throw new Error(`unexpected dialog: ${options.title}`);
      };
    }, projectDir);
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  async function openProject(page: Page): Promise<void> {
    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await expect(page.getByText(NPC)).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('project-opening-overlay')).toBeHidden({ timeout: 20000 });
  }

  async function openWorldFromPicker(page: Page, name: string): Promise<void> {
    await page.getByTestId('world-toggle').click();
    await page.getByTestId('world-open').click();
    await page.getByTestId(`world-picker-entry-${name}`).click();
    await page.getByTestId('world-viewport').waitFor();
    await page.waitForFunction(() => window.__worldViewport !== undefined);
  }

  async function editInWorldFromNpcEditor(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Dialog Editor' }).click();
    await page.getByRole('button', { name: `Edit NPC ${NPC}` }).click();
    const npcEditor = page.getByRole('dialog', { name: new RegExp(NPC) });
    await npcEditor.getByRole('button', { name: 'Edit routine RTN_START_900 in the world' }).click();
  }

  const routineStops = (page: Page) => page.evaluate(() => window.__worldViewport?.routineStops() ?? null);
  const spawnMarkers = (page: Page) => page.evaluate(() => window.__worldViewport?.spawnMarkers() ?? null);
  const pickWaypoint = (page: Page, name: string) => page.evaluate((wanted) => {
    const viewport = window.__worldViewport!;
    viewport.pickWaypoint(viewport.waypointIndex(wanted));
  }, name);
  const editor = (page: Page) => page.getByRole('dialog', { name: `Routines of ${NPC}` });
  const activity = (page: Page, n: number) => editor(page).getByRole('group', { name: `Activity ${n}`, exact: true });

  test('"In world" with no world open opens the NPC\'s own world, with the routine editor over it', async () => {
    const { page } = fixture;
    await openProject(page);

    await editInWorldFromNpcEditor(page);

    // Opened straight away — the spawn's STARTUP_MINIMAL names the world, so
    // there is nothing to pick.
    await page.getByTestId('world-viewport').waitFor({ timeout: 30000 });
    await expect(page.getByTestId('world-picker')).toHaveCount(0);
    await expect(editor(page)).toBeVisible();
    await expect(activity(page, 1).getByLabel('Waypoint', { exact: true })).toHaveValue('WP_FIXTURE_A');
    // The routine is drawn over the world while it is edited — and only the
    // routine: the whole waynet would read as every routine's stops. Spawns
    // are on, since that is who the routine is about (Daniel, 2026-09-30) —
    // and only this NPC's: everyone's clutters the map (Daniel, 2026-09-30).
    await expect.poll(() => routineStops(page)).toEqual(['WP_FIXTURE_A', 'WP_FIXTURE_B']);
    await expect(page.getByTestId('world-waynet-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('world-spawns-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => spawnMarkers(page)).toEqual(['WP_FIXTURE_A']);
  });

  test('closing the editor takes the routine off the map and puts the spawn layer back', async () => {
    const { page } = fixture;
    await openProject(page);
    await editInWorldFromNpcEditor(page);
    await expect(editor(page)).toBeVisible({ timeout: 30000 });
    await expect.poll(() => routineStops(page)).toEqual(['WP_FIXTURE_A', 'WP_FIXTURE_B']);

    await editor(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(editor(page)).toHaveCount(0);
    await expect.poll(() => routineStops(page)).toBeNull();
    // It was off before "In world" switched it on.
    await expect(page.getByTestId('world-spawns-toggle')).toHaveAttribute('aria-pressed', 'false');

    // Outside routine mode the layer is everyone's again.
    await page.getByTestId('world-spawns-toggle').click();
    await expect.poll(() => spawnMarkers(page)).toEqual(['WP_FIXTURE_A', 'WP_FIXTURE_C']);
  });

  test('Pick hides the editor and the bar says what to click; Abort returns, a waypoint fills the stop', async () => {
    const { page } = fixture;
    await openProject(page);
    await editInWorldFromNpcEditor(page);
    await expect(editor(page)).toBeVisible({ timeout: 30000 });

    await activity(page, 1).getByRole('button', { name: 'Pick the waypoint of activity 1 in the world' }).click();
    await expect(editor(page)).toBeHidden();
    const bar = page.getByTestId('world-routine-pick-bar');
    await expect(bar).toContainText('Routine edit');
    await expect(bar).toContainText('activity 1 (TA_Stand_Guarding)');
    // The waynet is the pick's targets, drawn for the pick only.
    await expect(page.getByTestId('world-waynet-toggle')).toHaveAttribute('aria-pressed', 'true');

    await bar.getByRole('button', { name: 'Abort' }).click();
    await expect(editor(page)).toBeVisible();
    await expect(page.getByTestId('world-routine-pick-bar')).toHaveCount(0);
    await expect(page.getByTestId('world-waynet-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(activity(page, 1).getByLabel('Waypoint', { exact: true })).toHaveValue('WP_FIXTURE_A');

    await activity(page, 1).getByRole('button', { name: 'Pick the waypoint of activity 1 in the world' }).click();
    await expect(editor(page)).toBeHidden();
    await pickWaypoint(page, 'WP_FIXTURE_C');

    await expect(editor(page)).toBeVisible();
    await expect(activity(page, 1).getByLabel('Waypoint', { exact: true })).toHaveValue('WP_FIXTURE_C');
    await expect.poll(() => routineStops(page)).toEqual(['WP_FIXTURE_C', 'WP_FIXTURE_B']);
  });

  test('a routine is drawn only while its NPC\'s spawn waypoint is selected', async () => {
    const { page } = fixture;
    await openProject(page);
    await openWorldFromPicker(page, 'MINIMAL.ZEN');
    expect(await routineStops(page)).toBeNull();

    // A spawn: the first NPC spawned there, drawn without asking.
    await pickWaypoint(page, 'WP_FIXTURE_A');
    const spawns = page.getByTestId('world-waypoint-spawns');
    await expect(spawns).toContainText('BAU_902_KNECHT');
    await expect.poll(() => routineStops(page)).toEqual(['WP_FIXTURE_A', 'WP_FIXTURE_B']);
    // Two NPCs share it; the row says whose.
    await spawns.getByRole('button', { name: 'Show the routine of BAU_902_KNECHT' }).click();
    await expect.poll(() => routineStops(page)).toEqual(['WP_FIXTURE_C']);

    // Only a stop of Onar's routine, no spawn: nothing drawn, nothing offered.
    await pickWaypoint(page, 'WP_FIXTURE_B');
    await expect(page.getByTestId('world-waypoint-panel')).toBeVisible();
    await expect.poll(() => routineStops(page)).toBeNull();
    await expect(page.getByRole('button', { name: /^Show the routine/ })).toHaveCount(0);

    // A spawn whose NPC has no routine draws none.
    await pickWaypoint(page, 'WP_FIXTURE_C');
    await expect(spawns).toContainText('BAU_901_BAUER');
    await expect.poll(() => routineStops(page)).toBeNull();
  });

  test('a routine stop is listed on its waypoint, and its button opens the editor', async () => {
    const { page } = fixture;
    await openProject(page);
    await openWorldFromPicker(page, 'MINIMAL.ZEN');

    await pickWaypoint(page, 'WP_FIXTURE_B');
    const panel = page.getByTestId('world-waypoint-panel');
    await expect(panel).toBeVisible();

    await panel.getByRole('button', { name: `Edit routines of ${NPC.toUpperCase()}` }).first().click();
    await expect(editor(page)).toBeVisible();
    await expect(activity(page, 2).getByLabel('Waypoint', { exact: true })).toHaveValue('WP_FIXTURE_B');
  });

  test('a spawn is listed on its waypoint with the same button', async () => {
    const { page } = fixture;
    await openProject(page);
    await openWorldFromPicker(page, 'MINIMAL.ZEN');

    await pickWaypoint(page, 'WP_FIXTURE_A');
    const spawns = page.getByTestId('world-waypoint-spawns');
    await expect(spawns).toContainText(NPC.toUpperCase());
    await spawns.getByRole('button', { name: `Edit routines of ${NPC.toUpperCase()}` }).click();
    await expect(editor(page)).toBeVisible();
  });

  test('"In world" over another world with unsaved edits asks before it switches', async () => {
    const { page } = fixture;
    await openProject(page);
    await openWorldFromPicker(page, 'OTHER.ZEN');

    // Any edit will do; a waypoint rename is one the panel makes directly.
    await pickWaypoint(page, 'WP_FIXTURE_C');
    const name = page.getByTestId('world-waypoint-name-input');
    await name.fill('WP_FIXTURE_RENAMED');
    await name.press('Enter');
    const renamedIndex = () => page.evaluate(() => window.__worldViewport?.waypointIndex('WP_FIXTURE_RENAMED') ?? null);
    await expect.poll(renamedIndex).not.toBe(-1);

    await editInWorldFromNpcEditor(page);

    const confirm = page.getByRole('dialog', { name: 'Discard unsaved world edits?' });
    await expect(confirm).toContainText('OTHER.ZEN');
    await expect(confirm).toContainText('MINIMAL.ZEN');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    // Still OTHER.ZEN, edit and all.
    expect(await renamedIndex()).not.toBe(-1);
    await expect(editor(page)).toHaveCount(0);

    await editInWorldFromNpcEditor(page);
    await page.getByRole('dialog', { name: 'Discard unsaved world edits?' })
      .getByRole('button', { name: 'Discard and open MINIMAL.ZEN' }).click();
    await expect(editor(page)).toBeVisible({ timeout: 30000 });
    // A fresh MINIMAL.ZEN: the rename was OTHER.ZEN's.
    await expect.poll(renamedIndex).toBe(-1);
  });
});
