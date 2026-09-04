import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchApp, seedProjectDir, type AppFixture } from './harness';

/**
 * Real-Electron E2E for the World surface's interaction layer
 * (level-editor.md §17) — the honest home for "a new UI workflow gets a
 * Playwright spec"
 * (AGENTS.md), modeled on `world-render.spec.ts`: a real window, a real
 * fixture world, and a fake install (this spec never reads a texture).
 *
 * The browser mock harness (`tests/e2e/`) cannot cover any of this by
 * design — it opens no world at all — so the context menu, the Delete
 * confirm and the panel splitter are untested UI workflows until this spec.
 *
 * Runs wherever the native addon is present for the dev build; see
 * `world-render.spec.ts`'s own doc comment for which CI job builds it.
 */

const FIXTURE_WORLD = path.resolve(
  __dirname, '..', '..', '..', 'zenkit-node', 'test', 'fixtures', 'minimal.g2.zen',
);

/** `FIXTURE_ROOT`, `minimal.g2.zen`'s one root VOB (flat index 0) — a real
 *  row to right-click and select, not a fabricated one. */
const ROOT_VOB_ROW = 'world-vob-row-0';

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

let addonAvailable = true;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('zenkit-node');
} catch {
  addonAvailable = false;
}

test.describe('World surface UI workflows in a real window', () => {
  test.skip(!addonAvailable, 'requires the built zenkit-node native addon');

  let fixture: AppFixture;
  let projectDir: string;
  let installDir: string;
  let worldPath: string;

  test.beforeEach(async () => {
    projectDir = seedProjectDir([]);
    installDir = makeFakeInstall();
    worldPath = path.join(projectDir, 'minimal.g2.zen');
    fs.copyFileSync(FIXTURE_WORLD, worldPath);
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
    }, { project: projectDir, install: installDir, world: worldPath });
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  /** The same sequence `world-render.spec.ts` drives: project, install,
   *  world, and a wait for the viewport's imperative handle so a test
   *  never races the scene's own async build. */
  async function openWorld(): Promise<void> {
    const { page } = fixture;
    await page.getByRole('button', { name: /Open Project/i }).first().click();
    await page.getByTestId('world-toggle').click();
    await page.getByTestId('world-open').click();
    // The picker lists worlds under the asset sources (level-editor.md
    // §16.31); the fixture world is elsewhere, so this is Browse….
    await page.getByTestId('world-picker-browse').click();
    await page.getByTestId('world-viewport').waitFor();
    await page.waitForFunction(() => window.__worldViewport !== undefined);
  }

  test('right-clicking a VOB opens its context menu, and Escape closes it', async () => {
    const { page } = fixture;
    await openWorld();

    await page.getByTestId(ROOT_VOB_ROW).click({ button: 'right' });
    await expect(page.getByTestId('world-context-menu')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('world-context-menu')).not.toBeVisible();
  });

  test('Delete opens the confirm, and Cancel leaves the VOB standing', async () => {
    const { page } = fixture;
    await openWorld();

    await page.getByTestId(ROOT_VOB_ROW).click();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('world-delete-warning')).toBeVisible();

    await page.getByTestId('world-delete-cancel').click();
    await expect(page.getByTestId('world-delete-warning')).not.toBeVisible();
    // The confirm gates the op — cancelling it must not have sent one.
    await expect(page.getByTestId(ROOT_VOB_ROW)).toBeVisible();
  });

  test('dragging the left splitter changes the scene panel width', async () => {
    const { page } = fixture;
    await openWorld();

    const panel = page.getByTestId('world-panel-left');
    const before = await panel.evaluate((el) => el.getBoundingClientRect().width);

    const handle = page.getByTestId('world-splitter-left');
    const box = await handle.boundingBox();
    if (box === null) throw new Error('world-splitter-left has no layout box');
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, y);
    await page.mouse.up();

    const after = await panel.evaluate((el) => el.getBoundingClientRect().width);
    expect(after - before).toBeCloseTo(80, 0);
  });

  test('Save overwrites the opened world without opening a Save As dialog', async () => {
    const { app, page } = fixture;
    await openWorld();

    await app.evaluate(({ dialog }) => {
      (dialog as { showSaveDialog: unknown }).showSaveDialog = async () => {
        throw new Error('Save must not open a Save As dialog');
      };
    });

    await page.getByTestId('world-save').click();
    const confirmation = page.getByRole('dialog', { name: 'Save this world?' });
    await expect(confirmation).toContainText(worldPath);
    await confirmation.getByRole('button', { name: 'Overwrite opened file' }).click();

    const outcome = await Promise.race([
      page.getByText(`Saved to ${worldPath}`).waitFor().then(() => ({ saved: true })),
      page.getByTestId('world-save-error').waitFor().then(async () => ({
        error: await page.getByTestId('world-save-error').textContent(),
      })),
    ]);
    expect(outcome).toEqual({ saved: true });
  });
});
