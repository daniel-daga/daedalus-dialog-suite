#!/usr/bin/env node
/**
 * Move a VOB in the real app, on a real world (level-editor.md §7, Phase 1b).
 *
 * Developer-local, like `verify-world-pipeline.js` and `measure-viewport.js`:
 * it needs a Gothic install, the built native addon and a GPU. What it drives
 * is the whole edit loop as a user meets it — the Electron app, the World
 * surface, the gizmo, the IPC, the op log in the main process, ZenKit's world
 * in the worker, and the panels that read the projection back.
 *
 *   npm run build            # renderer AND main; this drives the built app
 *   node scripts/verify-world-edit.js
 *
 * **What it stands in for, stated rather than implied.** The drag is delivered
 * through `window.__worldViewport.dragGizmo`, which moves the gizmo's proxy and
 * fires the two events `TransformControls` fires. So three's own
 * pointer-to-position maths is the one thing here that is not exercised;
 * everything below it is the real thing, including the live preview, the op,
 * the native `setVobPosition`, undo, redo and the property grid.
 *
 * **The projection is no longer the only witness.** Every panel check here reads
 * a projection — the property grid reads the renderer's index, the gizmo reads
 * the scene — and neither could prove the VOB the *native* world moved is the
 * one the flat index named. So this now also saves the edited world to a temp
 * file and re-loads it **in this process, through the binding**, with nothing of
 * the app's in the path, and compares the dump against a fresh load of the
 * original: exactly one VOB differs, and it is the one that was edited.
 *
 * What that still is **not** is a Gate 2 pass. A world the engine accepts is
 * decided by the engine (`zenkit-node/docs/engine-acceptance-*.md`), and no
 * engine run covers a UI-edited world or a rotated VOB yet.
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
const NUDGE = 500;   // ZenGin centimetres — far past any float noise
/** Never inside the Gothic install: this writes a world. */
const SAVE_TO = path.join(os.tmpdir(), `verify-world-edit-${process.pid}.zen`);

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

const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };

/**
 * Poll a condition until it holds, and record a problem if it never does.
 *
 * Deliberately not a fixed pause: an edit is an IPC round trip into the worker
 * and back through React, and a sleep here makes this script report failures
 * that were only late answers — while hiding real races behind its own latency.
 * That mistake is already recorded for the gizmo half below.
 */
async function expect_(holds, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await holds()) return true;
    if (Date.now() > deadline) { check(false, message); return false; }
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
}
const near = (a, b) => a !== null && b !== null
  && a.every((value, i) => Math.abs(value - b[i]) < 0.5);

async function main() {
  for (const [what, where] of [['install', INSTALL], ['world', WORLD]]) {
    if (!fs.existsSync(where)) throw new Error(`No ${what} at ${where}`);
  }

  const project = seedProject('world-edit-', '// edit fixture\n');

  const app = await electron.launch({ args: ['.'], cwd: path.join(__dirname, '..') });

  // Matched on exact titles: "Select Gothic Mod Project Folder" also contains
  // "Gothic", and answering it with the installation directory opens the whole
  // Gothic install as the editor's project.
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async (options) => {
      switch (options.title) {
        case 'Open a ZenGin world': return { canceled: false, filePaths: [paths.world] };
        case 'Select Gothic Mod Project Folder': return { canceled: false, filePaths: [paths.project] };
        default: throw new Error(`unexpected dialog: ${options.title}`);
      }
    };
    // Never the Gothic directory: this script writes a world, and the one it
    // opened is a retail game file.
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.save });
  }, { world: WORLD, project, save: SAVE_TO });

  const page = await app.firstWindow();
  page.setDefaultTimeout(180_000);
  page.on('console', (message) => {
    if (/error|Error/.test(message.text())) console.error('  [renderer]', message.text());
  });

  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await page.getByTestId('world-toggle').click();

  console.log(`opening ${path.basename(WORLD)} …`);
  await page.getByTestId('world-open').click();
  // Open world is a picker over the project's asset sources now
  // (level-editor.md §16.31); these drive a world by path, so Browse….
  await page.getByTestId('world-picker-browse').click();
  await page.getByTestId('world-viewport').waitFor();
  await page.waitForFunction(() => globalThis.__worldViewport !== undefined);

  // VOBs that are actually drawn: only a placed one has an instance for the
  // gizmo to sit on, and 10,825 of NewWorld's 23,288 are not placed at all.
  // Two of them, because the second half of this script drags both at once.
  const drawn = await page.evaluate(async () => {
    const settle = () => new Promise((resolve) => {
      globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
    });

    // Only the rows react-window has actually rendered are in the DOM — 23 of
    // 23,288 with the root collapsed, which is the point of the virtualization.
    const found = [];
    for (const row of globalThis.document.querySelectorAll('[data-testid^="world-vob-row-"]')) {
      row.click();
      await settle();
      if (globalThis.__worldViewport.gizmoPosition() !== null) {
        found.push(Number(row.getAttribute('data-testid').replace('world-vob-row-', '')));
        if (found.length === 2) break;
      }
    }
    return found;
  });
  check(drawn.length > 0, 'no visible scene-tree row selected a VOB the gizmo could attach to');
  if (drawn.length === 0) { await app.close(); return report(); }
  const selected = drawn[0];

  /** Click a scene-tree row, optionally with Ctrl held — which adds to the selection. */
  const clickRow = (vob, additive = false) => page.evaluate(async ({ at, ctrl }) => {
    const row = globalThis.document.querySelector(`[data-testid="world-vob-row-${at}"]`);
    if (row === null) throw new Error(`no row for vob ${at}`);
    // `row.click()` cannot hold a modifier, and the modifier is the feature.
    row.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true, ctrlKey: ctrl }));
    await new Promise((resolve) => {
      globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
    });
  }, { at: vob, ctrl: additive });

  await clickRow(selected);

  const readGrid = () => page.getByTestId('world-prop-position').textContent()
    .then((text) => text.split(',').map((value) => Number(value.trim())));

  /** Runs in the page: does the property grid read this position yet? */
  const gridReads = (target) => {
    const text = globalThis.document.querySelector('[data-testid="world-prop-position"]')?.textContent ?? '';
    return text.split(',').map((value) => Number(value.trim()))
      .every((value, i) => Math.abs(value - target[i]) < 0.5);
  };

  const before = await page.evaluate(() => globalThis.__worldViewport.gizmoPosition());
  const shown = await readGrid();
  check(near(shown, before), `the gizmo and the property grid disagree: ${shown} vs ${before}`);

  // ── the drag ──────────────────────────────────────────────────────────────
  const to = before.map((value) => value + NUDGE);
  await page.evaluate((target) => globalThis.__worldViewport.dragGizmo(target), to);

  await page.waitForFunction(gridReads, to, { timeout: 10_000 })
    .catch(() => check(false, `the property grid never showed the moved position ${to}`));

  const editError = await page.getByTestId('world-edit-error').count();
  check(editError === 0, 'the edit was refused — see the warning on the surface');
  check(near(await page.evaluate(() => globalThis.__worldViewport.gizmoPosition()), to),
    'the gizmo did not stay with the VOB it moved');

  // ── undo, then redo, then undo again so the world is left as it was ───────
  /**
   * Press a shortcut and wait for the position to *become* what it should be.
   *
   * Deliberately not a fixed pause: an edit is an IPC round trip into the
   * worker and back through React, and a 250 ms sleep here made this script
   * report failures that were only late answers — while hiding a real race
   * behind the latency it added.
   */
  const press = async (key, shift = false, expected = null) => {
    const label = shift ? `Ctrl+Shift+${key}` : `Ctrl+${key}`;
    await page.keyboard.press(shift ? `Control+Shift+${key}` : `Control+${key}`);

    if (expected !== null) {
      await page.waitForFunction(gridReads, expected, { timeout: 10_000 })
        .catch(() => check(false, `${label} never produced ${expected.map(Math.round).join(', ')}`));
    }
    const at = await readGrid();
    console.log(`  ${label.padEnd(14)}-> ${at.map(Math.round).join(', ')}`);
    return at;
  };

  await press('z', false, before);
  check(near(await page.evaluate(() => globalThis.__worldViewport.gizmoPosition()), before),
    'the gizmo did not follow the undo');

  await press('y', false, to);
  await press('z', false, before);
  await press('z', true, to);   // the other redo binding

  // Left as it was found: nothing here saves, but what follows should not start
  // from a world someone else moved a VOB in.
  await press('z', false, before);

  // ── the same keys, held down ──────────────────────────────────────────────
  //
  // How the race was found. Every edit is an IPC round trip and the op log is
  // moved only once the worker answers, so keystrokes arriving faster than the
  // round trip used to overlap: two undos both took the same batch off the
  // stack. `WorldService` serialises them now, and nobody presses Ctrl+Z once.
  await page.evaluate((target) => globalThis.__worldViewport.dragGizmo(target), to);
  await page.waitForFunction(gridReads, to, { timeout: 10_000 });

  // Faster than the round trip, on purpose. Six of each: the stacks hold one
  // batch, so five of every six find nothing to do — and the one that does must
  // not be taken twice.
  for (let i = 0; i < 6; i++) await page.keyboard.press('Control+z');
  for (let i = 0; i < 6; i++) await page.keyboard.press('Control+y');
  for (let i = 0; i < 6; i++) await page.keyboard.press('Control+z');

  // Two waits, not one, because the single wait could not tell the two failures
  // apart — and it reported the wrong one. Eighteen keystrokes arrive faster
  // than the round trip and `WorldService` serialises them, so at 15 s the
  // stack can still be draining; a VOB left at `to` is exactly what one
  // *pending* undo looks like AND exactly what one *dropped* undo looks like.
  // If it settles on the second wait it was latency. If it never settles, an
  // undo really was taken twice — the race this section exists to catch.
  const settles = (timeout) => page.waitForFunction(gridReads, before, { timeout })
    .then(() => true).catch(() => false);

  let settled = await settles(15_000);
  if (!settled) {
    settled = await settles(45_000);
    if (settled) console.log('  (the undo queue was still draining at 15 s)');
  }
  const at = await readGrid();
  check(settled, `held keys left the VOB at ${at}, not ${before}, and it never settled there — `
    + 'an undo was taken twice');
  console.log(`  6x undo/redo/undo -> ${at.map(Math.round).join(', ')}`);

  // ── the same gizmo, two VOBs (level-editor.md §7, multi-select) ───────────
  //
  // What this half is for: a drag of a selection is a *delta*, and the delta is
  // measured from where the gizmo was when the drag began. Every piece of that
  // lives inside the viewport's Three.js effect, where Jest cannot reach it —
  // the surface's tests stub the viewport out entirely. Two VOBs at different
  // places is what tells a delta from a destination: a batch that moved both to
  // the *same* point would pass every check that only looks at one of them.
  let both = null;
  if (drawn.length < 2) {
    console.log('\n  only one drawn VOB among the visible rows — multi-select not exercised');
  } else {
    const [first, second] = drawn;

    const positionOf = async (vob) => {
      await clickRow(vob);
      return { grid: await readGrid(), gizmo: await page.evaluate(() => globalThis.__worldViewport.gizmoPosition()) };
    };

    const wereAt = { [first]: (await positionOf(first)).grid, [second]: (await positionOf(second)).grid };
    check(!near(wereAt[first], wereAt[second]),
      'both test VOBs are at the same position — a delta and a destination cannot be told apart');

    // Select both: `second` is clicked last, so the gizmo anchors on it.
    await clickRow(first);
    await clickRow(second, true);
    const count = await page.getByTestId('world-prop-selection').textContent();
    check(/2/.test(count ?? ''), `the property grid did not report 2 selected: ${count}`);

    const anchor = await page.evaluate(() => globalThis.__worldViewport.gizmoPosition());
    check(near(anchor, wereAt[second]), 'the gizmo did not anchor on the last VOB selected');

    await page.evaluate((target) => globalThis.__worldViewport.dragGizmo(target),
      anchor.map((value) => value + NUDGE));

    const movedTo = {};
    for (const vob of [first, second]) {
      const expected = wereAt[vob].map((value) => value + NUDGE);
      await page.waitForFunction(gridReads, expected, { timeout: 10_000 })
        .catch(() => undefined);
      const at = await positionOf(vob);
      movedTo[vob] = at.grid;
      // The index and the scene are two different projections of the same edit,
      // and only the first is what an op wrote. A batch that moved the VOBs on
      // top of each other reads correct in neither.
      check(near(at.grid, expected), `vob ${vob} moved to ${at.grid}, not ${expected}`);
      check(near(at.gizmo, expected), `vob ${vob} is drawn at ${at.gizmo}, not ${expected}`);
    }

    // One batch is one undo entry: a single Ctrl+Z must put *both* back, and a
    // second one must find nothing left of this drag to undo.
    await page.keyboard.press('Control+z');
    for (const vob of [first, second]) {
      await page.waitForFunction(gridReads, wereAt[vob], { timeout: 10_000 }).catch(() => undefined);
      const at = await positionOf(vob);
      check(near(at.grid, wereAt[vob]), `one undo left vob ${vob} at ${at.grid}, not ${wereAt[vob]}`);
    }
    both = { first, second, wereAt, movedTo };
  }

  // ── the turn gizmo (level-editor.md §7) ──────────────────────────────────
  //
  // A rotation is the second mutation the binding has, and unlike a move it
  // rewrites the VOB's bounding box: the engine culls by that box and an
  // axis-aligned box does not rotate into an axis-aligned box. Everything below
  // the gizmo is exercised by Jest; what only the real app can show is that the
  // three's-quaternion-to-ZenGin-matrix path produces the matrix the op claims.
  const readRotation = () => page.getByTestId('world-prop-rotation').textContent()
    .then((text) => text.split(/[\n,]/).map((value) => Number(value.trim())));

  await clickRow(selected);
  const rotationBefore = await readRotation();

  await page.keyboard.press('e');
  await page.waitForSelector('[data-testid="world-gizmo-rotate"][aria-pressed="true"]', { timeout: 5_000 })
    .catch(() => check(false, 'pressing E did not switch the gizmo to Turn'));

  // A quarter turn about ZenGin's Y (up). Predictable on purpose: the matrix
  // that comes back is the one this script can check by hand.
  await page.evaluate(() => globalThis.__worldViewport.turnGizmo([0, 1, 0], Math.PI / 2));

  const QUARTER_Y = [0, 0, 1, 0, 1, 0, -1, 0, 0];
  const turnedTo = (expected) => page.waitForFunction((want) => {
    const text = globalThis.document.querySelector('[data-testid="world-prop-rotation"]')?.textContent ?? '';
    const read = text.split(/[\n,]/).map((value) => Number(value.trim()));
    return read.length === 9 && read.every((value, i) => Math.abs(value - want[i]) < 0.01);
  }, expected, { timeout: 10_000 });

  // The expectation is computed here, by plain 3x3 algebra, from whatever
  // matrix the VOB actually had — the first VOB this picks on retail NewWorld
  // is already turned 23 degrees, so "it will be the quarter turn" would have
  // been a fixture assumption rather than a check. The app reaches the same
  // number through three's quaternion path and `multiplyRotation`; two
  // independent routes agreeing is the point.
  const times = (a, b) => Array.from({ length: 9 }, (_, at) => {
    const [r, c] = [Math.floor(at / 3), at % 3];
    return a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  });
  const expected = times(QUARTER_Y, rotationBefore);

  let turned = true;
  await turnedTo(expected).catch(() => { turned = false; });
  check(turned, `the grid never showed the turned matrix: ${(await readRotation()).join(', ')} `
    + `(wanted ${expected.map((v) => v.toFixed(2)).join(', ')})`);
  // The grid reads the index and the gizmo reads the scene — two projections of
  // the same op, and a turn that reached only one of them is a real defect.
  check((await page.evaluate(() => globalThis.__worldViewport.gizmoRotation()))
    .every((value, i) => Math.abs(value - expected[i]) < 0.01),
  'the scene does not draw the VOB at the matrix the property grid reports');

  check(await page.getByTestId('world-edit-error').count() === 0, 'the turn was refused');

  await page.keyboard.press('Control+z');
  await turnedTo(rotationBefore)
    .catch(() => check(false, 'undo did not put the matrix back'));

  await page.keyboard.press('w');

  // ── the property grid, which is where the invisible half is ───────────────
  //
  // Everything the gizmos write is on screen. Nothing `SetVobProp` writes is:
  // a name, a visual and six flags. So this is the one edit whose only witness
  // in the app is the panel that produced it — and the reason the save check
  // below now also reads the name and the flag out of the *file*.
  await clickRow(selected);

  const nameField = page.getByTestId('world-prop-name-input');
  const nameBefore = await nameField.inputValue();
  const RENAMED = `VERIFY_RENAMED_${process.pid}`;

  await nameField.fill(RENAMED);
  await nameField.press('Enter');
  await expect_(async () => (await page.getByTestId('world-prop-name-input').inputValue()) === RENAMED,
    'the property grid never showed the new name');
  check(await page.getByTestId('world-edit-error').count() === 0, 'the rename was refused');

  // A flag is a checkbox and a single key in the op — the grid must not post the
  // whole word, or an undo restores five flags nobody edited.
  const flag = page.getByTestId('world-prop-flag-cdDynamic');
  const flagBefore = await flag.isChecked();
  await flag.click();
  await expect_(async () => (await page.getByTestId('world-prop-flag-cdDynamic').isChecked()) !== flagBefore,
    'the flag checkbox did not follow the edit');

  // Two edits, two undo entries: the flag comes back first.
  await page.keyboard.press('Control+z');
  await expect_(async () => (await page.getByTestId('world-prop-flag-cdDynamic').isChecked()) === flagBefore,
    'undo did not put the flag back');
  await expect_(async () => (await page.getByTestId('world-prop-name-input').inputValue()) === RENAMED,
    'undoing the flag also undid the rename — one edit, one entry');

  await page.keyboard.press('Control+z');
  await expect_(async () => (await page.getByTestId('world-prop-name-input').inputValue()) === nameBefore,
    'undo did not put the name back');

  // Put the rename back so the save below carries it into the file.
  await page.keyboard.press('Control+y');
  await expect_(async () => (await page.getByTestId('world-prop-name-input').inputValue()) === RENAMED,
    'redo did not restore the rename');

  // ── placing a VOB, which changes the shape of the world ──────────────────
  //
  // The first edit that adds a VOB rather than changing one, and the only one
  // whose projection cannot be patched: a flat index is a VOB's position in a
  // depth-first traversal, so the index is re-read whole and the scene rebuilt.
  // Undone again before the save below, which counts on 23,288.
  const treeCount = () => page.getByTestId('world-tree-count').textContent()
    .then((text) => Number((text ?? '').replace(/[^0-9]/g, '')));

  const vobsBefore = await treeCount();
  const PLACED = `VERIFY_PLACED_${process.pid}`;

  await page.evaluate(() => globalThis.__worldViewport.pickTerrain([29628, 5300, -15176]));
  await page.getByTestId('world-place-vob').click();
  await page.getByTestId('world-place-name').fill(PLACED);
  await page.getByTestId('world-place-visual').fill('NW_CRATE.3DS');
  await page.getByTestId('world-place-confirm').click();

  await expect_(async () => (await treeCount()) === vobsBefore + 1,
    `the scene tree never showed ${vobsBefore + 1} VOBs after placing one`);
  check(await page.getByTestId('world-edit-error').count() === 0, 'the placement was refused');

  // The refresh is the half that only the real app exercises: the worker
  // re-reads its own index, the store takes a whole new summary, and every
  // cached reader over the old buffers has to be dropped with it.
  const placedIndex = vobsBefore;
  await clickRow(placedIndex).catch(() => undefined);

  await page.keyboard.press('Control+z');
  await expect_(async () => (await treeCount()) === vobsBefore,
    'undo did not remove the placed VOB from the index');

  // ── and placing one *under* a parent, which renumbers ─────────────────────
  //
  // The same call with a parent, and the case the enumeration constrains: a VOB
  // appended to the roots is enumerated last and shifts nothing, while one
  // appended under a parent is enumerated as soon as that parent's subtree ends
  // and every VOB after it moves up one. The parent is the selected VOB, and a
  // terrain point survives a click in the tree — only a viewport pick replaces
  // it — which is what makes "click the ground, then click the parent" a
  // gesture rather than a mode.
  let parented = null;
  const firstRoot = await page.evaluate(() => {
    const element = globalThis.document.querySelector('[data-testid^="world-vob-row-"]');
    return element === null ? null : Number(element.getAttribute('data-testid').replace('world-vob-row-', ''));
  });

  if (firstRoot !== null) {
    await page.evaluate(() => globalThis.__worldViewport.pickTerrain([29628, 5300, -15176]));
    await clickRow(firstRoot);
    await page.getByTestId('world-place-vob').click();
    await page.getByTestId('world-place-parent').check();
    await page.getByTestId('world-place-name').fill(`${PLACED}_CHILD`);
    await page.getByTestId('world-place-visual').fill('NW_CRATE.3DS');
    await page.getByTestId('world-place-confirm').click();

    await expect_(async () => (await treeCount()) === vobsBefore + 1,
      'the scene tree never grew after placing a VOB under a parent');
    check(await page.getByTestId('world-edit-error').count() === 0,
      'the parented placement was refused');
    // **The count alone would say exactly the same for a VOB appended to the
    // roots** — which is what this call did until it took a parent, so it is
    // precisely the wrong answer this step has to rule out. Three things that
    // look like they would, and do not: the number of rendered rows (the tree is
    // virtualized, so it is the viewport's worth either way), the number of
    // top-level rows (same reason), and *finding a row with this VOB's name*,
    // which passes for a root too because the tree is still scrolled to where
    // the previous step's placement was and the last root is on screen. Measured
    // — the sabotage went green on that one.
    //
    // What separates them is the flat index, which is the whole difference
    // between the two cases: a root is enumerated last and takes the index one
    // past the end, and this VOB is enumerated in the middle, as soon as its
    // parent's subtree ends.
    await page.getByTestId(`world-vob-toggle-${firstRoot}`).click();
    let placedAt = null;
    // `expect_`'s message is built before it polls, so it cannot name the index
    // it ended up seeing — the row below reports that, and it is written only if
    // this held.
    const landedInside = await expect_(async () => {
      placedAt = await page.evaluate((name) => {
        const found = [...globalThis.document.querySelectorAll('[data-testid^="world-vob-row-"]')]
          .find((element) => element.textContent.includes(name));
        return found === null || found === undefined
          ? null
          : Number(found.getAttribute('data-testid').replace('world-vob-row-', ''));
      }, `${PLACED}_CHILD`);
      return placedAt !== null && placedAt < vobsBefore;
    }, `the placed VOB is not enumerated inside the first ${vobsBefore} — it was appended to the roots, not to a parent`);
    await page.getByTestId(`world-vob-toggle-${firstRoot}`).click();

    await page.keyboard.press('Control+z');
    await expect_(async () => (await treeCount()) === vobsBefore,
      'undo did not remove the VOB placed under a parent');
    parented = landedInside
      ? `under ${firstRoot}, enumerated at index ${placedAt} rather than ${vobsBefore}, then undone`
      : `FAILED — landed at index ${placedAt}, which is where a root goes`;
  }

  // ── save, and the question only a save can answer ─────────────────────────
  //
  // Every check above reads the *projection*: the property grid reads the
  // renderer's index and the gizmo reads the scene, and both were built from
  // what the worker sent. Neither can prove the VOB the **native** world moved
  // is the one the flat index named — the two addresses a VOB has are different
  // numbers, and on a depth-first-enumerated retail world they agree often
  // enough that the wrong one passes.
  //
  // Saving and re-loading closes that. The file is read here, in this process,
  // by the binding itself — nothing of the app's is in the path.

  // ── a waypoint, which is not a VOB ────────────────────────────────────────
  //
  // Done before the VOB is re-selected, and deliberately: picking a waypoint
  // gives up the VOB selection — one gizmo — and the property grid below reads
  // the selected VOB's index to find it in the saved file.
  //
  // The waynet has to be switched on first. That is what fetches the payload,
  // and a waypoint that is not drawn cannot be picked: there is no overlay to
  // pick it out of.
  let waypointMoved = null;
  await page.getByTestId('world-waynet-toggle').click();
  await page.evaluate(() => globalThis.__worldViewport.pickWaypoint(0));
  const waypointHome = await expect_(
    async () => (await page.evaluate(() => globalThis.__worldViewport.gizmoPosition())) !== null,
    'the gizmo never attached to a waypoint — the overlay may not have loaded',
  ) ? await page.evaluate(() => globalThis.__worldViewport.gizmoPosition()) : null;

  if (waypointHome !== null) {
    const waypointAway = waypointHome.map((value) => value + NUDGE);
    await page.evaluate((target) => globalThis.__worldViewport.dragGizmo(target), waypointAway);
    // The gizmo is the only projection there is for a waypoint — it has no row
    // in the scene tree and no properties in the grid. The witness that matters
    // is the saved file, and that is `expectedWaypointMoves` below.
    const landed = await page.evaluate(() => globalThis.__worldViewport.gizmoPosition());
    check(near(landed, waypointAway),
      `the gizmo is at ${landed?.map(Math.round)} after the waypoint drag, not ${waypointAway.map(Math.round)}`);
    check(await page.getByTestId('world-edit-error').count() === 0,
      'the waypoint move was refused');
    waypointMoved = `waypoint 0 ${waypointHome.map(Math.round).join(', ')} -> ${waypointAway.map(Math.round).join(', ')}`;
  }

  await clickRow(selected);
  const home = await readGrid();
  const away = home.map((value) => value + NUDGE);
  await page.evaluate((target) => globalThis.__worldViewport.dragGizmo(target), away);
  await page.waitForFunction(gridReads, away, { timeout: 10_000 })
    .catch(() => check(false, 'the VOB to be saved never moved'));

  await page.getByTestId('world-save').click();
  await page.getByTestId('world-save-confirm').click();
  await page.getByTestId('world-saved').waitFor({ timeout: 120_000 })
    .catch(async () => check(false,
      `the save never reported success: ${await page.getByTestId('world-save-error').textContent().catch(() => 'no error shown')}`));

  let saved = null;
  let changed = null;
  /** How the waynet differed, for the summary — measured, not assumed. */
  let waypointsChanged = null;
  if (fs.existsSync(SAVE_TO)) {
    const zenkit = require('zenkit-node');
    const dump = zenkit.normalizeWorld(zenkit.loadWorld(SAVE_TO, 'g2'));
    // The flat index the UI selected, resolved to the path the binding used —
    // the same two addresses, checked against the file rather than against the
    // projection that produced them.
    const expectedPath = (await page.evaluate(
      () => globalThis.document.querySelector('[data-testid="world-prop-index"]')?.textContent ?? '',
    ));
    saved = dump.vobs[Number(expectedPath)];
    check(saved !== undefined, `the saved world has no VOB at index ${expectedPath}`);
    if (saved) {
      check(near(saved.position, away),
        `the saved world has that VOB at ${saved.position.map(Math.round)}, not ${away.map(Math.round)}`);
      // The property op reaching the *file*, which is the only witness that is
      // not a projection — and the one that matters, because a name and a flag
      // are invisible in the viewport either way.
      check(saved.name === RENAMED,
        `the saved world has that VOB named "${saved.name}", not "${RENAMED}"`);
      // The bbox travels with the position — the engine culls by it.
      check(Math.abs((saved.bbox[0] + saved.bbox[3]) / 2 - away[0]) < NUDGE,
        'the saved VOB kept a bounding box centred where it used to be');
    }
    // And **only** that VOB. Every check above could pass on a writer that
    // scrambled the rest of the tree; this is the one that says the edit is the
    // only difference. The comparison is against a fresh load of the original,
    // in this process, through the same dump both sides use.
    const original = zenkit.normalizeWorld(zenkit.loadWorld(WORLD, 'g2'));
    check(original.vobs.length === dump.vobs.length,
      `the saved world has ${dump.vobs.length} VOBs, the original ${original.vobs.length}`);

    const differing = [];
    for (let at = 0; at < Math.min(original.vobs.length, dump.vobs.length); at++) {
      if (JSON.stringify(original.vobs[at]) !== JSON.stringify(dump.vobs[at])) differing.push(at);
    }
    check(differing.length === 1 && differing[0] === Number(expectedPath),
      `${differing.length} VOBs differ from the original (${differing.slice(0, 5)}), expected only ${expectedPath}`);
    // The structures nothing here edits, and the ones the engine computes
    // collision from. `mesh` and `bsp` stay whole-section equality: no op in
    // this project touches either, and saying so is the point.
    for (const section of ['mesh', 'bsp']) {
      check(JSON.stringify(original[section]) === JSON.stringify(dump[section]),
        `the saved world's ${section} differs from the original`);
    }
    // The waynet is checked **differentially**, in the same shape as the VOB
    // comparison above, rather than as one whole-section equality.
    //
    // It was whole-section equality for as long as no op could touch it. The
    // first waynet op retires that claim, and an assertion that only knows how
    // to say "identical" has to be replaced *before* the op that makes it false
    // exists — otherwise the first waypoint move turns a real regression check
    // into a red row somebody deletes. Two properties of the dump make the
    // differential form cheap: waypoints are sorted by name and a move does not
    // rename, so the array order is stable; and edges are sorted
    // order-insensitively, so edge equality is not order noise.
    // One: the waypoint gizmo above drags waypoint 0 and does not undo it.
    // Still a named constant rather than a literal, because it is the number
    // that says how much of the waynet this driver is allowed to have touched —
    // and the assertion below narrows a difference to *position*, so a waypoint
    // that changed anything else is a red row whatever this says.
    const expectedWaypointMoves = 1;
    check(original.waynet.waypoints.length === dump.waynet.waypoints.length,
      `the saved world has ${dump.waynet.waypoints.length} waypoints, `
      + `the original ${original.waynet.waypoints.length}`);
    const movedWaypoints = [];
    for (let at = 0; at < Math.min(original.waynet.waypoints.length, dump.waynet.waypoints.length); at++) {
      const was = original.waynet.waypoints[at];
      const now = dump.waynet.waypoints[at];
      if (JSON.stringify(was) === JSON.stringify(now)) continue;
      // Named, and narrowed to *what* differs: a waypoint that changed anything
      // but its position is a different bug from one that moved.
      movedWaypoints.push(
        JSON.stringify({ ...now, position: was.position }) === JSON.stringify(was)
          ? `${now.name} (position)`
          : `${now.name} (NOT just its position)`,
      );
    }
    waypointsChanged = movedWaypoints;
    check(movedWaypoints.length === expectedWaypointMoves,
      `${movedWaypoints.length} waypoints differ from the original `
      + `(${movedWaypoints.slice(0, 5)}), expected ${expectedWaypointMoves}`);
    // A move cannot touch an edge — a moved waypoint is the same object every
    // edge already points at — and an assertion that says so is worth more than
    // one that does not look.
    check(JSON.stringify(original.waynet.edges) === JSON.stringify(dump.waynet.edges),
      "the saved world's waynet edges differ from the original");
    changed = differing.length;
  } else {
    check(false, `nothing was written to ${SAVE_TO}`);
  }

  // Put it back, so what follows starts from the world as it was found.
  await page.keyboard.press('Control+z');
  await page.waitForFunction(gridReads, home, { timeout: 10_000 }).catch(() => undefined);

  // ── reparenting, by dragging one row onto another ────────────────────────
  //
  // The third structural op, and the first one whose gesture is the tree rather
  // than the viewport. Driven by the drag events a row actually listens for —
  // Playwright's own drag helpers move a mouse, and an HTML5 drag is not a mouse
  // move — so what stands in for the pointer here is precisely the part the
  // browser owns, and everything below it is the real thing.
  //
  // **One event per task, and that is not a stylistic choice.** React 18 batches
  // the `setDragging` a `dragstart` handler does, and a `drop` dispatched in the
  // *same* JS task runs before that flush — so its handler still reads "nothing
  // is being dragged" and refuses, silently and with no edit error, which is
  // exactly what a passing count looked like. A real drag is three separate
  // user gestures in three separate tasks; three `page.evaluate` calls are too.
  // `fireEvent` in jsdom wraps each call in `act()` and so never had the problem,
  // which is why the component tests could not have found this.
  const drag = async (fromSelector, toSelector) => {
    const fire = (selector, type) => page.evaluate(({ at, kind }) => {
      globalThis.document.querySelector(at).dispatchEvent(
        new globalThis.Event(kind, { bubbles: true, cancelable: true }),
      );
    }, { at: selector, kind: type });

    await fire(fromSelector, 'dragstart');
    await fire(toSelector, 'dragover');
    await fire(toSelector, 'drop');
  };
  let reparented = null;
  const treeCountAfter = await treeCount();
  const twoRows = await page.evaluate(() => [...globalThis.document
    .querySelectorAll('[data-testid^="world-vob-row-"]')]
    .slice(0, 2)
    .map((element) => Number(element.getAttribute('data-testid').replace('world-vob-row-', ''))));

  if (twoRows.length === 2) {
    const [target, moved] = twoRows;
    await drag(`[data-testid="world-vob-row-${moved}"]`, `[data-testid="world-vob-row-${target}"]`);

    // **The count is not evidence that anything happened.** A reparent moves a
    // VOB and never loses one, so a refused op holds the count exactly as a
    // successful one does — and this step reported a pass for as long as the op
    // existed while the IPC validator was refusing every one of them by name.
    // What tells the two apart is the tree: both of these rows are roots, so a
    // VOB that really became a child of another is no longer a top-level row and
    // its own row is inside a collapsed parent.
    const isRow = async (vob) => await page.getByTestId(`world-vob-row-${vob}`).count() > 0;
    await expect_(async () => !(await isRow(moved)),
      `VOB ${moved} is still a row of its own — the reparent did not happen`);
    await expect_(async () => (await treeCount()) === treeCountAfter,
      'the VOB count changed across a reparent — a subtree was lost');
    check(await page.getByTestId('world-edit-error').count() === 0, 'the reparent was refused');

    await page.keyboard.press('Control+z');
    await expect_(async () => isRow(moved),
      `VOB ${moved} did not come back to the roots when the reparent was undone`);
    await expect_(async () => (await treeCount()) === treeCountAfter,
      'undoing the reparent changed the VOB count');
    reparented = `${moved} into ${target} and back, count held at ${treeCountAfter.toLocaleString()}`;
  }

  // ── reparenting to a position, by dropping between two rows ───────────────
  //
  // The other half of the gesture, and the only one that can name a *slot*: a
  // drop onto a row can only ever mean the end of its children. Every gap is
  // read as "immediately before the row under the line", so dropping the second
  // root on the line above the first makes it the first root.
  // **What it cannot be checked by is the row's index**, which is the trap this
  // op is about: after a reparent the enumeration changes, so `world-vob-row-5`
  // names a different VOB than it did a moment ago. The rows' *labels* survive
  // it, and a successful "second before first" is a swap of the top two.
  let slotted = null;
  const topTwo = () => page.evaluate(() => [...globalThis.document
    .querySelectorAll('[data-testid^="world-vob-row-"]')]
    .slice(0, 2)
    .map((element) => ({
      vob: Number(element.getAttribute('data-testid').replace('world-vob-row-', '')),
      label: element.textContent,
    })));

  const rootsBefore = await topTwo();
  if (rootsBefore.length === 2 && rootsBefore[0].label !== rootsBefore[1].label) {
    const [first, second] = rootsBefore;
    await drag(
      `[data-testid="world-vob-row-${second.vob}"]`,
      `[data-testid="world-vob-drop-before-${first.vob}"]`,
    );

    await expect_(async () => {
      const [a, b] = await topTwo();
      return a?.label === second.label && b?.label === first.label;
    }, 'the top two rows did not swap — the between-rows drop did not land');
    check(await page.getByTestId('world-edit-error').count() === 0, 'the between-rows drop was refused');

    await page.keyboard.press('Control+z');
    await expect_(async () => {
      const [a] = await topTwo();
      return a?.label === first.label;
    }, 'undoing the between-rows drop did not put the roots back in order');
    await expect_(async () => (await treeCount()) === treeCountAfter,
      'undoing the between-rows drop changed the VOB count');
    slotted = `"${second.label}" moved before "${first.label}" among the roots, and back`;
  }

  const row = (label, value) => console.log(`  ${String(label).padEnd(28)}${value}`);
  console.log('\nVOBs moved, through the real app\n');
  row('VOB', selected);
  row('Moved', `${before.map(Math.round).join(', ')} -> ${to.map(Math.round).join(', ')}`);
  row('Undo / redo', 'both followed by the grid and the gizmo');
  row('Turned', 'a quarter turn about Y, checked in both projections, undone');
  row('Renamed', `${nameBefore || '(unnamed)'} -> ${RENAMED}, and one flag, each its own undo`);
  row('Placed', `${PLACED} appended as a root, index re-read, undone`);
  row('Placed under a parent', parented ?? 'not exercised — no rows in the tree');
  row('Reparented', reparented ?? 'not exercised — fewer than two rows in the tree');
  row('Dropped between rows', slotted ?? 'not exercised — the top two rows are indistinguishable');
  row('Waypoint moved', waypointMoved ?? 'FAILED — the gizmo never took a waypoint');
  row('Saved and re-loaded', saved
    ? `VOB ${selected} is at ${saved.position.map(Math.round).join(', ')} in the file`
    : 'FAILED');
  row('  waypoints differing', waypointsChanged === null
    ? 'not compared'
    : `${waypointsChanged.length} of ${'2,959'} — ${waypointsChanged.join(', ') || 'none'}`);
  row('  VOBs differing', changed === null ? 'not compared' : `${changed} of ${'23,288'} — mesh and bsp identical, waynet compared waypoint by waypoint`);
  if (both) {
    row('Multi-select', `${both.first} + ${both.second}, one gizmo, one batch`);
    row('  kept their spacing', [0, 1, 2]
      .map((axis) => Math.round(both.movedTo[both.first][axis] - both.movedTo[both.second][axis]))
      .join(', '));
    row('  one undo', 'put both back');
  }

  await app.close();
  fs.rmSync(project, { recursive: true, force: true });
  fs.rmSync(SAVE_TO, { force: true });
  report();
}

function report() {
  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nEdit loop OK.');
}

main().catch((error) => { console.error('FAILED:', error); process.exit(1); });
