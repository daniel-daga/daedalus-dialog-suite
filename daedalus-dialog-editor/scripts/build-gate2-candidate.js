#!/usr/bin/env node
/**
 * Build the Gate 2 candidate: a world edited **through the real UI**, carrying
 * every op the engine has never seen (level-editor.md §11, Phase 1b).
 *
 * The 2026-08-25 acceptance record covers an untouched re-save and the two
 * Phase-0 mutations, and says so explicitly: no engine run covers a world edited
 * through the app, a rotated VOB, a renamed one, a swapped visual, a changed
 * flag or a placed one. This script produces the world that answers that, and
 * stops there — the engine half needs a person, a game and the checklist in
 * `zenkit-node/docs/engine-acceptance-2026-08-25.md` §8.
 *
 *   node scripts/build-gate2-candidate.js [--out <dir>] [--install <Gothic II>]
 *
 * Developer-local, like `verify-world-edit.js`: it needs a Gothic install, the
 * built native addon and a GPU, and it drives the built app.
 *
 * **Most of the edits are made to VOBs this script places at `START`**, and that
 * is deliberate rather than convenient: a candidate is only useful if the tester
 * can actually find what changed, and a VOB edited somewhere in 600 m of
 * Khorinis is a search. Everything below is at the hero's feet on a new game.
 *
 * The exception is the one retail VOB it moves and turns, which is there for the
 * question new VOBs cannot ask: a placed VOB's bounding box was fitted by this
 * app, while a retail VOB's was written by ZenGin, and re-fitting one on a
 * rotation is the measurement `check-vob-bbox.js` justified and the engine has
 * never confirmed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('@playwright/test');

function arg(name, fallback = null) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

const INSTALL = arg('install', 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Gothic II');
const WORLD = arg('world', path.join(INSTALL, '_work', 'Data', 'Worlds', 'NewWorld', 'NewWorld.zen'));
const OUT = path.resolve(arg('out', path.join(os.tmpdir(), 'gate2-candidate')));
const SAVE_TO = path.join(OUT, '03-ui-edited.zen');

/** The `START` waypoint — where a new game puts the hero. */
const START = [29628.5, 5198.3, -15176.8];
/** Two visuals known to exist on retail G2 and to look different from each other. */
const CRATE = 'NW_CRATE.3DS';
const TABLE = 'NW_CITY_TABLE_PEASANT_01.3DS';

const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };
const log = (message) => console.log(message);

/**
 * A throwaway project the World surface can open a world from.
 *
 * §16.28 removed the World bar's install picker: asset sources are now a list
 * in the project file, and `world:open` refuses a project whose sources do not
 * mount the world's assets. So the Gothic install has to be seeded here, as
 * the second source after the project root, rather than clicked in afterwards.
 */
function seedProject(prefix, fixture) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(project, 'world.d'), fixture);
  fs.writeFileSync(
    path.join(project, `${path.basename(project)}.gothicproject.json`),
    JSON.stringify({
      version: 1,
      target: 'g2-notr',
      scriptsRoot: '.',
      worlds: [],
      assetSources: ['.', INSTALL],
    }, null, 2),
  );
  return project;
}

async function main() {
  for (const [what, where] of [['install', INSTALL], ['world', WORLD]]) {
    if (!fs.existsSync(where)) throw new Error(`No ${what} at ${where}`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  if (fs.existsSync(SAVE_TO)) fs.rmSync(SAVE_TO);

  const project = seedProject('gate2-', '// fixture\n');

  const app = await electron.launch({ args: ['.'], cwd: path.join(__dirname, '..') });
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async (options) => {
      switch (options.title) {
        case 'Open a ZenGin world': return { canceled: false, filePaths: [paths.world] };
        case 'Select Gothic Mod Project Folder': return { canceled: false, filePaths: [paths.project] };
        default: throw new Error(`unexpected dialog: ${options.title}`);
      }
    };
    // Never the installed world: this writes one.
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.save });
  }, { world: WORLD, project, save: SAVE_TO });

  const page = await app.firstWindow();
  page.setDefaultTimeout(180_000);
  page.on('console', (message) => {
    if (/error|Error/.test(message.text())) console.error('  [renderer]', message.text());
  });

  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await page.getByTestId('world-toggle').click();

  log(`opening ${path.basename(WORLD)} …`);
  await page.getByTestId('world-open').click();
  // Open world is a picker over the project's asset sources now
  // (level-editor.md §16.31); these drive a world by path, so Browse….
  await page.getByTestId('world-picker-browse').click();
  await page.getByTestId('world-viewport').waitFor();
  await page.waitForFunction(() => globalThis.__worldViewport !== undefined);

  const noRefusal = async (what) => {
    check(await page.getByTestId('world-edit-error').count() === 0, `${what} was refused by the surface`);
  };
  const treeCount = () => page.getByTestId('world-tree-count').textContent()
    .then((text) => Number((text ?? '').replace(/[^0-9]/g, '')));
  const readGrid = () => page.getByTestId('world-prop-position').textContent()
    .then((text) => text.split(',').map((value) => Number(value.trim())));

  const until = async (holds, message, timeout = 20_000) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await holds()) return true;
      if (Date.now() > deadline) { check(false, message); return false; }
      await page.waitForTimeout(100);
    }
  };

  // ── one retail VOB: moved and turned ─────────────────────────────────────
  //
  // Found the way `verify-world-edit.js` finds one — the rendered scene-tree
  // rows are the only VOBs reachable without a search box, and 10,825 of the
  // 23,288 are not drawn at all, so a row is tried until the gizmo attaches.
  const retail = await page.evaluate(async () => {
    const settle = () => new Promise((resolve) => {
      globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
    });
    for (const row of globalThis.document.querySelectorAll('[data-testid^="world-vob-row-"]')) {
      row.click();
      await settle();
      if (globalThis.__worldViewport.gizmoPosition() !== null) {
        return Number(row.getAttribute('data-testid').replace('world-vob-row-', ''));
      }
    }
    return null;
  });
  check(retail !== null, 'no rendered scene-tree row selected a VOB the gizmo could attach to');

  let retailReport = null;
  if (retail !== null) {
    const from = await page.evaluate(() => globalThis.__worldViewport.gizmoPosition());
    const to = [from[0], from[1] + 300, from[2]];
    await page.evaluate((target) => globalThis.__worldViewport.dragGizmo(target), to);
    await until(async () => {
      const at = await readGrid();
      return at.every((value, i) => Math.abs(value - to[i]) < 0.5);
    }, 'the retail VOB never moved');
    await noRefusal('the retail move');

    // Rotate mode, then a quarter turn about ZenGin's Y.
    await page.keyboard.press('e');
    await page.waitForSelector('[data-testid="world-gizmo-rotate"][aria-pressed="true"]', { timeout: 5_000 })
      .catch(() => check(false, 'the rotate gizmo never became active'));
    await page.evaluate(() => globalThis.__worldViewport.turnGizmo([0, 1, 0], Math.PI / 2));
    await noRefusal('the retail turn');
    await page.keyboard.press('w');

    const name = await page.getByTestId('world-prop-name-input').inputValue().catch(() => '');
    retailReport = { vob: retail, name: name || '(unnamed)', at: to };
    log(`  retail VOB ${retail} "${retailReport.name}" raised 300 and turned 90° about Y`);
  }

  // ── the placed VOBs, all at START ────────────────────────────────────────
  //
  // A placed VOB is appended as a root, so it is the last row in the tree —
  // which is how this selects one without a search box. The name is checked
  // after the click, because "the last row" is an assumption about the tree and
  // editing the wrong VOB would be invisible in the report.
  const selectLastRow = async (expectedName) => {
    await page.evaluate(async () => {
      const settle = () => new Promise((resolve) => {
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
      });
      const tree = globalThis.document.querySelector('[role="tree"]');
      const scroller = [...tree.querySelectorAll('*')]
        .find((el) => el.scrollHeight > el.clientHeight + 10);
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      await settle();
      const rows = [...globalThis.document.querySelectorAll('[data-testid^="world-vob-row-"]')];
      rows[rows.length - 1]?.click();
      await settle();
    });
    const shown = await page.getByTestId('world-prop-name-input').inputValue().catch(() => '');
    check(shown === expectedName,
      `selecting the last tree row gave "${shown}", not the VOB just placed ("${expectedName}")`);
    return shown === expectedName;
  };

  const place = async (name, visual, offset) => {
    const before = await treeCount();
    await page.evaluate((point) => globalThis.__worldViewport.pickTerrain(point),
      [START[0] + offset[0], START[1] + offset[1], START[2] + offset[2]]);
    await page.getByTestId('world-place-vob').click();
    await page.getByTestId('world-place-name').fill(name);
    await page.getByTestId('world-place-visual').fill(visual);
    await page.getByTestId('world-place-confirm').click();
    await until(async () => (await treeCount()) === before + 1, `${name} was never added to the index`);
    await noRefusal(`placing ${name}`);
    log(`  placed ${name} (${visual}) at START + ${offset.join(', ')}`);
    return before;
  };

  await place('GATE2_PLAIN_01', CRATE, [0, 60, 120]);

  await place('GATE2_TURNED_01', TABLE, [200, 60, 0]);
  if (await selectLastRow('GATE2_TURNED_01')) {
    await page.keyboard.press('e');
    await page.waitForSelector('[data-testid="world-gizmo-rotate"][aria-pressed="true"]', { timeout: 5_000 })
      .catch(() => check(false, 'the rotate gizmo never became active for the placed VOB'));
    await page.evaluate(() => globalThis.__worldViewport.turnGizmo([0, 1, 0], Math.PI / 2));
    await noRefusal('turning the placed VOB');
    await page.keyboard.press('w');
    log('  turned GATE2_TURNED_01 90° about Y');
  }

  await place('GATE2_PROPS_01', CRATE, [-200, 60, 0]);
  if (await selectLastRow('GATE2_PROPS_01')) {
    const nameField = page.getByTestId('world-prop-name-input');
    await nameField.fill('GATE2_RENAMED_01');
    await nameField.press('Enter');
    await until(async () => (await nameField.inputValue()) === 'GATE2_RENAMED_01',
      'the rename never took');
    await noRefusal('the rename');

    const visualField = page.getByTestId('world-prop-visual-input');
    await visualField.fill(TABLE);
    await visualField.press('Enter');
    await until(async () => (await visualField.inputValue()) === TABLE, 'the visual swap never took');
    await noRefusal('the visual swap');

    const flag = page.getByTestId('world-prop-flag-cdDynamic');
    const was = await flag.isChecked();
    await flag.click();
    await until(async () => (await flag.isChecked()) !== was, 'the flag never changed');
    await noRefusal('the flag change');
    log(`  GATE2_PROPS_01 -> renamed GATE2_RENAMED_01, visual -> ${TABLE}, cdDynamic ${was} -> ${!was}`);
  }

  // ── save ─────────────────────────────────────────────────────────────────
  await page.getByTestId('world-save').click();
  await page.getByTestId('world-save-confirm').click();
  await page.getByTestId('world-saved').waitFor({ timeout: 180_000 })
    .catch(async () => check(false,
      `the save never reported success: ${await page.getByTestId('world-save-error').textContent().catch(() => 'no error shown')}`));

  const vobs = await treeCount();
  await app.close();
  fs.rmSync(project, { recursive: true, force: true });

  // ── what the file says, read by the binding, nothing of the app's in the path
  let dump = null;
  if (fs.existsSync(SAVE_TO)) {
    const zenkit = require('zenkit-node');
    dump = zenkit.normalizeWorld(zenkit.loadWorld(SAVE_TO, 'g2'));
    check(dump.vobs.length === vobs,
      `the saved world holds ${dump.vobs.length} VOBs, the app showed ${vobs}`);
  } else {
    check(false, `nothing was written to ${SAVE_TO}`);
  }

  log('');
  if (problems.length > 0) {
    console.error(`${problems.length} problem(s) — the candidate is NOT trustworthy:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  const size = fs.statSync(SAVE_TO).size;
  log(`Gate 2 candidate written: ${SAVE_TO}`);
  log(`  ${dump.vobs.length.toLocaleString()} VOBs, ${(size / 1e6).toFixed(1)} MB`);
  log('');
  log('WHAT TO LOOK FOR IN THE GAME — all at the START spawn unless noted');
  log('  GATE2_PLAIN_01     a crate, 60 up and 120 north of the spawn point');
  log(`  GATE2_TURNED_01    a table 200 east, turned a quarter turn about Y —`);
  log('                     the op no engine has ever seen');
  log(`  GATE2_RENAMED_01   200 west, placed as a crate and now a ${TABLE},`);
  log('                     renamed after placement, cdDynamic toggled');
  if (retailReport !== null) {
    log(`  retail VOB ${retailReport.vob} "${retailReport.name}" — raised 300 and turned 90° about Y,`);
    log(`                     at ${retailReport.at.map(Math.round).join(', ')} (ZenGin cm)`);
  }
  log('');
  log('NEXT, AND IT NEEDS A PERSON AT THE KEYBOARD:');
  log(`  node ../zenkit-node/tools/mutate.js "${OUT}"      # stages 00-control-original.zen`);
  log(`  pwsh ../zenkit-node/tools/engine-batch.ps1 -Exe Spacer2 -Dir "${OUT}"`);
  log(`  pwsh ../zenkit-node/tools/engine-batch.ps1 -Exe Gothic2 -Dir "${OUT}"`);
  log('  Control first, fullscreen (windowed crashes here), and rows 7, 8 and 9');
  log('  of the checklist must actually run this time — see');
  log('  zenkit-node/docs/engine-acceptance-2026-08-25.md §8.');
}

main().catch((error) => { console.error(error); process.exit(1); });
