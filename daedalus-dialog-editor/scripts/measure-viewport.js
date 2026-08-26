#!/usr/bin/env node
/**
 * Measure the app's own viewport, on screen (level-editor.md §3).
 *
 * Developer-local, like `zen-roundtrip`: it needs a real Gothic install, the
 * built native addon and a real GPU, so it is not a CI job and never will be.
 * What it produces is what retired `zenkit-node/spike/viewport/` — the
 * framerate, draw-call and pick-latency rows measured against the scene the app
 * actually builds, rather than the one the spike built.
 *
 * It launches the real Electron app, opens a real world through the real IPC,
 * and runs `viewportBenchmark` through the live renderer. The main-process file
 * dialogs are stubbed rather than clicked, because a native dialog cannot be
 * driven from a script; every path they return still goes through the same
 * `PathValidationService` whitelisting a user's click would.
 *
 *   node scripts/measure-viewport.js --world "<...>\NewWorld.zen" --install "<...>\Gothic II"
 *   node scripts/measure-viewport.js ... --background   # the A/B control
 *
 * `--background` minimises the window before measuring. That is the degraded
 * state §3 inferred from a disagreement between two runs, measured on purpose:
 * every CPU-bound number comes back 2-3x slower while the scene renders
 * identically, draw call for draw call. Run it whenever a browser-side number
 * matters, because a minimised Electron window reports `hasFocus() === true`
 * and `visibilityState === 'visible'` throughout — the report's `valid` flag
 * comes from frames actually presented, which is the only signal that does not
 * lie here.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('@playwright/test');

function arg(name, fallback = null) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}
const wants = (name) => process.argv.includes(`--${name}`);

const INSTALL = arg('install', 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Gothic II');
const WORLD = arg('world', path.join(INSTALL, '_work', 'Data', 'Worlds', 'NewWorld', 'NewWorld.zen'));
const BACKGROUND = wants('background');
const OUT = arg('out', null);

async function main() {
  for (const [what, where] of [['install', INSTALL], ['world', WORLD]]) {
    if (!fs.existsSync(where)) throw new Error(`No ${what} at ${where}`);
  }

  // A throwaway project, only because the World view lives inside the main
  // layout and the main layout needs something open. Deliberately not a real
  // Gothic script project: indexing one would cost more than the measurement.
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'world-measure-'));
  fs.writeFileSync(path.join(project, 'world.d'), '// measurement fixture\n');

  const app = await electron.launch({ args: ['.'], cwd: path.join(__dirname, '..') });

  // The two dialogs the World surface opens, answered without a human. Told
  // apart by what they ask for, so neither can accidentally answer the other.
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async (options) => {
      const properties = options.properties || [];
      if (properties.includes('openFile')) return { canceled: false, filePaths: [paths.world] };
      if ((options.title || '').includes('Gothic')) return { canceled: false, filePaths: [paths.install] };
      return { canceled: false, filePaths: [paths.project] };
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

  console.log(`opening ${WORLD} …`);
  const openedAt = Date.now();
  await page.getByTestId('world-open').click();
  await page.getByTestId('world-viewport').waitFor();
  await page.waitForFunction(() => globalThis.__worldViewport !== undefined);
  console.log(`viewport mounted after ${Date.now() - openedAt} ms`);

  // Foreground or background, deliberately and before the sweep starts — the
  // report carries which it was, and refuses to call a backgrounded run valid.
  await app.evaluate(({ BrowserWindow }, background) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (background) { window.minimize(); return; }
    window.show();
    window.focus();
  }, BACKGROUND);

  console.log(`measuring (${BACKGROUND ? 'BACKGROUND — the A/B control' : 'foreground'}) …`);
  const result = await page.evaluate(() => globalThis.__worldViewport.benchmark());

  const report = { world: path.basename(WORLD), background: BACKGROUND, ...result };
  console.log(JSON.stringify(report, null, 1));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1));

  await app.close();
  fs.rmSync(project, { recursive: true, force: true });
}

main().catch((error) => { console.error(error); process.exit(1); });
