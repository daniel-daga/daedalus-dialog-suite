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
 * The other limit is the one `verify-world-pipeline.js` already records: the
 * position read back comes from the renderer's projection, so this cannot prove
 * the *native* VOB moved is the one the flat index named. That needs the world
 * saved and re-loaded, which is Phase 1b's half of Gate 2.
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

const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };
const near = (a, b) => a !== null && b !== null
  && a.every((value, i) => Math.abs(value - b[i]) < 0.5);

async function main() {
  for (const [what, where] of [['install', INSTALL], ['world', WORLD]]) {
    if (!fs.existsSync(where)) throw new Error(`No ${what} at ${where}`);
  }

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'world-edit-'));
  fs.writeFileSync(path.join(project, 'world.d'), '// edit fixture\n');

  const app = await electron.launch({ args: ['.'], cwd: path.join(__dirname, '..') });

  // Matched on exact titles: "Select Gothic Mod Project Folder" also contains
  // "Gothic", and answering it with the installation directory opens the whole
  // Gothic install as the editor's project.
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async (options) => {
      switch (options.title) {
        case 'Open a ZenGin world': return { canceled: false, filePaths: [paths.world] };
        case 'Select the Gothic installation directory':
          return { canceled: false, filePaths: [paths.install] };
        case 'Select Gothic Mod Project Folder': return { canceled: false, filePaths: [paths.project] };
        default: throw new Error(`unexpected dialog: ${options.title}`);
      }
    };
  }, { world: WORLD, install: INSTALL, project });

  const page = await app.firstWindow();
  page.setDefaultTimeout(180_000);
  page.on('console', (message) => {
    if (/error|Error/.test(message.text())) console.error('  [renderer]', message.text());
  });

  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await page.getByTestId('world-toggle').click();
  await page.getByTestId('world-choose-install').click();
  await page.getByTestId('world-install-path').waitFor();

  console.log(`opening ${path.basename(WORLD)} …`);
  await page.getByTestId('world-open').click();
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

  await page.waitForFunction(gridReads, before, { timeout: 15_000 })
    .catch(() => undefined);
  const settled = await readGrid();
  check(near(settled, before), `held keys left the VOB at ${settled}, not ${before}`);
  console.log(`  6x undo/redo/undo -> ${settled.map(Math.round).join(', ')}`);

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

  const row = (label, value) => console.log(`  ${String(label).padEnd(28)}${value}`);
  console.log('\nVOBs moved, through the real app\n');
  row('VOB', selected);
  row('Moved', `${before.map(Math.round).join(', ')} -> ${to.map(Math.round).join(', ')}`);
  row('Undo / redo', 'both followed by the grid and the gizmo');
  row('Turned', 'a quarter turn about Y, checked in both projections, undone');
  if (both) {
    row('Multi-select', `${both.first} + ${both.second}, one gizmo, one batch`);
    row('  kept their spacing', [0, 1, 2]
      .map((axis) => Math.round(both.movedTo[both.first][axis] - both.movedTo[both.second][axis]))
      .join(', '));
    row('  one undo', 'put both back');
  }

  await app.close();
  fs.rmSync(project, { recursive: true, force: true });
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
