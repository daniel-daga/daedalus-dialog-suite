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

  // A VOB that is actually drawn: only a placed one has an instance for the
  // gizmo to sit on, and 10,825 of NewWorld's 23,288 are not placed at all.
  const selected = await page.evaluate(async () => {
    const settle = () => new Promise((resolve) => {
      globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
    });

    // Only the rows react-window has actually rendered are in the DOM — 23 of
    // 23,288 with the root collapsed, which is the point of the virtualization.
    for (const row of globalThis.document.querySelectorAll('[data-testid^="world-vob-row-"]')) {
      row.click();
      await settle();
      if (globalThis.__worldViewport.gizmoPosition() !== null) {
        return Number(row.getAttribute('data-testid').replace('world-vob-row-', ''));
      }
    }
    return null;
  });
  check(selected !== null, 'no visible scene-tree row selected a VOB the gizmo could attach to');
  if (selected === null) { await app.close(); return report(); }

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

  const row = (label, value) => console.log(`  ${String(label).padEnd(28)}${value}`);
  console.log('\none VOB moved, through the real app\n');
  row('VOB', selected);
  row('Moved', `${before.map(Math.round).join(', ')} -> ${to.map(Math.round).join(', ')}`);
  row('Undo / redo', 'both followed by the grid and the gizmo');

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
