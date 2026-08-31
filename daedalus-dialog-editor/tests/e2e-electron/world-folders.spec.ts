import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchApp, type AppFixture } from './harness';

/**
 * User-created VOB folders (VOB folders slice), in a real window — the honest
 * home for this, the same reason `world-editing-ui.spec.ts` is: the browser
 * mock harness (`tests/e2e/`) opens no world at all, and this feature's whole
 * point is a `<worldname>.folders.json` sidecar actually written to disk,
 * which that harness is explicitly forbidden from asserting on.
 *
 * The fixture world is copied into a fresh temp directory before each test,
 * never opened from `zenkit-node/test/fixtures/` directly — folder edits save
 * immediately (unlike a VOB edit, which waits for an explicit Save), so
 * opening the committed fixture in place would write a stray sidecar into the
 * repo on every run.
 */

const FIXTURE_SOURCE = path.resolve(
  __dirname, '..', '..', '..', 'zenkit-node', 'test', 'fixtures', 'minimal.g2.zen',
);
const ROOT_VOB_ROW = 'world-vob-row-0';

function makeFakeInstall(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dde-e2e-install-'));
  fs.mkdirSync(path.join(dir, '_work', 'Data', 'Meshes', '_compiled'), { recursive: true });
  return dir;
}

/** A private copy of the fixture world, so a sidecar write lands beside the
 *  copy rather than the committed fixture. */
function copyFixtureWorld(): { dir: string; worldPath: string; sidecarPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dde-e2e-world-'));
  const worldPath = path.join(dir, 'minimal.g2.zen');
  fs.copyFileSync(FIXTURE_SOURCE, worldPath);
  return { dir, worldPath, sidecarPath: path.join(dir, 'minimal.g2.folders.json') };
}

let addonAvailable = true;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('zenkit-node');
} catch {
  addonAvailable = false;
}

test.describe('VOB folders in a real window', () => {
  test.skip(!addonAvailable, 'requires the built zenkit-node native addon');

  let fixture: AppFixture;
  let projectDir: string;
  let installDir: string;
  let world: { dir: string; worldPath: string; sidecarPath: string };

  test.beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dde-e2e-project-'));
    installDir = makeFakeInstall();
    world = copyFixtureWorld();
    fixture = await launchApp();

    await fixture.app.evaluate(({ dialog }, paths) => {
      (dialog as { showOpenDialog: (options: { title: string }) => unknown }).showOpenDialog = async (
        options: { title: string },
      ) => {
        switch (options.title) {
          case 'Select Gothic Mod Project Folder': return { canceled: false, filePaths: [paths.project] };
          case 'Select the Gothic installation directory': return { canceled: false, filePaths: [paths.install] };
          case 'Open a ZenGin world': return { canceled: false, filePaths: [paths.world] };
          default: throw new Error(`unexpected dialog: ${options.title}`);
        }
      };
    }, { project: projectDir, install: installDir, world: world.worldPath });
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
    fs.rmSync(installDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(world.dir, { recursive: true, force: true });
  });

  async function openWorld(): Promise<void> {
    const { page } = fixture;
    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await page.getByTestId('world-toggle').click();
    await page.getByTestId('world-choose-install').click();
    await page.getByTestId('world-install-path').waitFor();

    await page.getByTestId('world-open').click();
    await page.getByTestId('world-viewport').waitFor();
    await page.waitForFunction(() => window.__worldViewport !== undefined);
  }

  test('creating a folder from the context menu writes the sidecar beside the world file', async () => {
    const { page } = fixture;
    await openWorld();

    await page.getByTestId(ROOT_VOB_ROW).click({ button: 'right' });
    await page.getByTestId('world-context-add-to-folder').click();
    await page.getByTestId('world-context-folder-new').click();
    await page.getByTestId('world-context-folder-new-name').fill('Quest NPCs');
    await page.getByTestId('world-context-folder-new-name').press('Enter');

    // Written by the main process, not the renderer — wait for it rather than
    // asserting the instant the click handler returns.
    await expect.poll(() => fs.existsSync(world.sidecarPath)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(world.sidecarPath, 'utf8'));
    expect(saved.folders).toHaveLength(1);
    expect(saved.folders[0]).toMatchObject({ name: 'Quest NPCs', vobPaths: ['0'] });
    expect(typeof saved.folders[0].id).toBe('string');

    // And the Folders tab reflects the same state the file now holds.
    await page.getByTestId('world-panel-folders').click();
    await expect(page.getByText('Quest NPCs')).toBeVisible();
  });

  test('the folder survives closing and reopening the world', async () => {
    const { page } = fixture;
    await openWorld();

    await page.getByTestId(ROOT_VOB_ROW).click({ button: 'right' });
    await page.getByTestId('world-context-add-to-folder').click();
    await page.getByTestId('world-context-folder-new').click();
    await page.getByTestId('world-context-folder-new-name').fill('Survives reopen');
    await page.getByTestId('world-context-folder-new-name').press('Enter');
    await expect.poll(() => fs.existsSync(world.sidecarPath)).toBe(true);

    // No UI affordance closes a world outright; reopening the same path is
    // the app's own path back through `openWorld` — a fresh `vobFolders`
    // reset to empty (WorldSurface.tsx) and a re-read of the sidecar.
    await openWorld();

    await page.getByTestId('world-panel-folders').click();
    await expect(page.getByText('Survives reopen')).toBeVisible();
  });
});
