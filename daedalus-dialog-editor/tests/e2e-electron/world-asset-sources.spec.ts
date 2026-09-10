import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchApp, seedProjectDir, type AppFixture } from './harness';

/**
 * The Assets panel grouped by asset source (architecture level-editor.md §6, #237) —
 * real Electron, real `openVfs`, real mounts.
 *
 * This is the one place the whole claim can be checked at once: a merged
 * namespace hides where a file came from, and an overridden copy is simply gone
 * from it, so nothing short of a real mount of two overlapping sources proves
 * that the browser is reading provenance rather than repeating whatever the
 * fixture handed it. Two loose `_compiled` trees hold a file of the same name;
 * the panel has to name the later one, and — narrowed to the earlier — has to
 * mark the copy it shadows.
 *
 * Runs wherever the dev build has the native addon, like `world-render.spec.ts`
 * (`ZENKIT_NODE_FORCE_BUILD=1` in `e2e-electron-windows`). It needs no GPU: the
 * left panel mounts on the world summary, not on the viewport.
 */

const FIXTURE_WORLD = path.resolve(
  __dirname, '..', '..', '..', 'zenkit-node', 'test', 'fixtures', 'minimal.g2.zen',
);

/**
 * A `zen-world`-shaped install whose two loose trees overlap. `gothicAssetSources`
 * mounts `Meshes/_compiled` before `Textures/_compiled`, which is ZenGin's own
 * load order, so the Textures copy of the shared name is the one the merged
 * namespace serves.
 */
function makeOverlappingInstall(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dde-e2e-sources-'));
  const meshes = path.join(dir, '_work', 'Data', 'Meshes', '_compiled');
  const textures = path.join(dir, '_work', 'Data', 'Textures', '_compiled');
  fs.mkdirSync(meshes, { recursive: true });
  fs.mkdirSync(textures, { recursive: true });
  fs.writeFileSync(path.join(meshes, 'SHARED.MRM'), 'meshes');
  fs.writeFileSync(path.join(meshes, 'MESH_ONLY.MRM'), 'meshes');
  fs.writeFileSync(path.join(textures, 'SHARED.MRM'), 'textures');
  fs.writeFileSync(path.join(textures, 'TEX_ONLY-C.TEX'), 'textures');
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

let addonAvailable = true;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('zenkit-node');
} catch {
  addonAvailable = false;
}

test.describe('The Assets panel says which source an asset came from', () => {
  test.skip(!addonAvailable, 'requires the built zenkit-node native addon');

  let fixture: AppFixture;
  let projectDir: string;
  let installDir: string;

  test.beforeEach(async () => {
    projectDir = seedProjectDir([]);
    installDir = makeOverlappingInstall();
    writeProjectFile(projectDir, installDir);
    fixture = await launchApp();

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
    }, { project: projectDir, world: FIXTURE_WORLD });
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  test('names the mount serving each entry, and shades what a later mount overrides', async () => {
    const { page } = fixture;

    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await page.getByTestId('world-toggle').click();
    await page.getByTestId('world-open').click();
    // The picker lists worlds under the asset sources; the fixture world is
    // elsewhere, so this is Browse….
    await page.getByTestId('world-picker-browse').click();

    await page.getByTestId('world-panel-assets').click();
    await expect(page.getByTestId('world-asset-SHARED.MRM')).toBeVisible();

    // Mounted second, so its copy is the one the merged namespace serves.
    await expect(page.getByTestId('world-asset-origin-SHARED.MRM')).toHaveText('Textures/_compiled');
    await expect(page.getByTestId('world-asset-origin-MESH_ONLY.MRM')).toHaveText('Meshes/_compiled');
    await expect(page.getByTestId('world-asset-SHARED.MRM')).not.toHaveAttribute('data-overridden', 'true');

    // Narrowed to the mesh tree: everything it holds, including the copy the
    // texture tree shadows, and nothing the texture tree alone has.
    await page.getByTestId('world-asset-source').selectOption({ label: 'Meshes/_compiled' });
    await expect(page.getByTestId('world-asset-SHARED.MRM')).toHaveAttribute('data-overridden', 'true');
    await expect(page.getByTestId('world-asset-MESH_ONLY.MRM')).toBeVisible();
    await expect(page.getByTestId('world-asset-MESH_ONLY.MRM')).not.toHaveAttribute('data-overridden', 'true');
    await expect(page.getByTestId('world-asset-TEX_ONLY-C.TEX')).toHaveCount(0);
  });
});
