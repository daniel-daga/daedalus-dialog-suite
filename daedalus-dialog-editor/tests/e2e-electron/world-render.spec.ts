import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchApp, seedProjectDir, type AppFixture } from './harness';

/**
 * Real-Electron E2E — board §16.1. `DDE_SMOKE_OPEN_WORLD` (build-windows.yml)
 * proves the packaged native addon can read a real ZEN, but it routes straight
 * through `WorldService` and exits without ever creating a window — a World
 * surface that mounts nothing, or throws on first paint, would still pass it.
 * This spec drives the real UI in a real window instead: open a project, open
 * a world through the same button a user clicks, and read the GPU's own
 * framebuffer back through `__worldViewport.renderFrom` (the mechanism
 * `scripts/verify-world-render.js` already uses against a real Gothic
 * install) to prove the mesh was actually drawn, not just fetched.
 *
 * Runs wherever the native addon is present for the dev build — this repo's
 * `e2e-electron-windows` job (build-windows.yml) sets
 * `ZENKIT_NODE_FORCE_BUILD=1` before `pnpm install` for exactly this spec.
 */

const FIXTURE_WORLD = path.resolve(
  __dirname, '..', '..', '..', 'zenkit-node', 'test', 'fixtures', 'minimal.g2.zen',
);

/**
 * A `zen-world`-shaped install with no real archives. `gothicAssetSources`
 * falls back to the loose `_work/Data/<kind>/_compiled` layout and accepts an
 * empty directory there — this test looks at the fixture's own mesh geometry,
 * not a texture, so nothing needs to actually be inside it.
 */
function makeFakeInstall(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dde-e2e-install-'));
  fs.mkdirSync(path.join(dir, '_work', 'Data', 'Meshes', '_compiled'), { recursive: true });
  return dir;
}

function writeProjectFile(projectDir: string, installDir: string): void {
  fs.writeFileSync(
    path.join(projectDir, `${path.basename(projectDir)}.gothicproject.json`),
    JSON.stringify({
      version: 1,
      target: 'g2-notr',
      scriptsRoot: '.',
      worlds: [],
      assetSources: ['.', installDir],
    }, null, 2),
    'utf8',
  );
}

// The ubuntu `editor-e2e-electron` job runs this same testDir but never
// force-builds the native addon (`zenkit-node/scripts/install.js` skips the
// source build in CI unless `ZENKIT_NODE_FORCE_BUILD=1`, which only
// `e2e-electron-windows` sets) — `WorldService` would just reject every open.
// This checks the same thing that job's own runtime would, from the test
// process, which is a pnpm-workspace sibling of the addon it is asking about.
let addonAvailable = true;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('zenkit-node');
} catch {
  addonAvailable = false;
}

test.describe('World surface renders a real window', () => {
  test.skip(!addonAvailable, 'requires the built zenkit-node native addon');

  let fixture: AppFixture;
  let projectDir: string;
  let installDir: string;

  test.beforeEach(async () => {
    projectDir = seedProjectDir([]);
    installDir = makeFakeInstall();
    writeProjectFile(projectDir, installDir);
    fixture = await launchApp();

    // Two different `showOpenDialog` calls in one flow (project folder,
    // world file) — matched on title, the same way
    // `scripts/verify-world-render.js` drives the real app.
    await fixture.app.evaluate(({ dialog }, paths) => {
      (dialog as { showOpenDialog: (options: { title: string }) => unknown }).showOpenDialog = async (
        options: { title: string },
      ) => {
        switch (options.title) {
          case 'Select Gothic Mod Project Folder': return { canceled: false, filePaths: [paths.project] };
          case 'Open a ZenGin world': return { canceled: false, filePaths: [paths.world] };
          default: throw new Error(`unexpected dialog: ${options.title}`);
        }
      };
    }, { project: projectDir, install: installDir, world: FIXTURE_WORLD });
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  test('opening a world draws the mesh, not just the clear colour', async () => {
    const { page } = fixture;

    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await page.getByTestId('world-toggle').click();
    await page.getByTestId('world-open').click();
    // The picker lists worlds under the asset sources (level-editor.md
    // §16.31); the fixture world is elsewhere, so this is Browse….
    await page.getByTestId('world-picker-browse').click();
    await page.getByTestId('world-viewport').waitFor();
    await page.waitForFunction(() => window.__worldViewport !== undefined);

    // The fixture's whole mesh is a 100x100 quad at y in [-1, 1] (its own
    // golden bbox) — centred and close enough that a blank canvas and a drawn
    // one cannot be mistaken for each other.
    const frame = await page.evaluate(
      ([eye, at]) => window.__worldViewport!.renderFrom(eye, at),
      [[50, 300, 50], [50, 0, 50]] as [[number, number, number], [number, number, number]],
    );

    expect(frame.width).toBeGreaterThan(0);
    expect(frame.height).toBeGreaterThan(0);

    const pixels = Buffer.from(frame.rgba, 'base64');
    const CLEAR = [0x10, 0x14, 0x1c];
    let drawn = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (!CLEAR.every((value, channel) => Math.abs(pixels[i + channel] - value) <= 2)) drawn++;
    }
    expect(drawn).toBeGreaterThan(0);
  });
});
