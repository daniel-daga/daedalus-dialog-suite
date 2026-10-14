import { test, expect, Page } from '@playwright/test';
import { resolve } from 'node:path';

/**
 * Browser mock-harness specs for the World surface (level-editor.md §6).
 *
 * The harness runs the real renderer against a mock backend, without Gothic
 * or the native binding. The marker-only fixture below verifies GPU sprites
 * and direction projection; it does not verify loading a real ZenGin world.
 *
 * So these specs cover exactly the flow that lives in the renderer: the view is
 * reachable, it is lazily loaded, it explains what it needs, and a refused open
 * surfaces the refusal instead of leaving a spinner running. Native world
 * loading is covered by the real-Electron suite; scene-graph tests cover the
 * remaining rendering rules.
 */

async function openWorldView(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();

  // The view toggles live in the main layout, which needs a file open first.
  await page.evaluate(() => {
    localStorage.setItem('mockapi_file_project/world.d', '// empty\n');
    localStorage.setItem(
      'recent_projects',
      JSON.stringify([{ path: 'project', name: 'project', lastOpened: Date.now() }]),
    );
  });

  page.on('dialog', async (dialog) => {
    if (dialog.message().includes('project folder path')) await dialog.accept('project');
    else await dialog.dismiss();
  });
  await page.getByRole('button', { name: /Open Project/i }).first().click();

  await page.getByTestId('world-toggle').click();
}

test.describe('World surface', () => {
  test('renders larger facing arrows with the stored direction and the scene mirror', async ({ page }) => {
    await openWorldView(page);
    await expect(page.getByTestId('world-open')).toBeVisible();
    const shaderErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /shader|WebGLProgram/i.test(message.text())) shaderErrors.push(message.text());
    });
    await page.evaluate(async (fixturePath) => {
      const { SUMMARY, vobIndex } = await import(/* @vite-ignore */ fixturePath);
      const bbox = [-400, -100, -400, 400, 100, 400];
      const api = (window as unknown as { editorAPI: Record<string, unknown> }).editorAPI;
      api.listWorlds = async () => [{ path: SUMMARY.worldPath, name: 'NewWorld.zen', source: 'C:/Gothic', isDefault: false }];
      api.openWorld = async () => ({
        ...SUMMARY, bbox, assetSources: [],
        vobIndex: vobIndex([[-150, 0, 0], [150, 0, 0]], ['zCVobLight', 'zCVob'],
          undefined, ['LIGHT', 'PARTICLE'], ['', 'FIRE.PFX']),
      });
      api.getWorldMesh = async () => ({ groups: [], bbox });
      api.getWorldVisuals = async () => ({ visuals: [], decals: { groups: [], count: 0 }, stats: {
        visualsSeen: 0, visualsResolved: 0, vobsPlaced: 0, instancedDrawGroups: 0,
        levelCompos: 0, unresolvedByType: {}, unresolved: [],
      } });
      const net = {
        count: 1, names: ['WP_FACE'], positions: new Float32Array(3).buffer,
        directions: new Float32Array([1, 0, 0]).buffer,
        waterDepths: new Int32Array(1).buffer, flags: new Uint32Array(1).buffer,
        edgeCount: 0, edges: new Uint32Array().buffer, danglingEdges: 0,
      };
      api.getWorldWaynet = async () => net;
      api.getWorldHistoryDepth = async () => ({ undo: 0, redo: 0 });
      api.getWorldPortalFindings = async () => [];
      api.getVobFolders = async () => ({ folders: [] });
    }, `/@fs${resolve(__dirname, '../worldFixtures.ts')}`);
    const open = async () => {
      await page.getByTestId('world-open').click();
      await page.getByTestId('world-picker-entry-NewWorld.zen').click();
      await expect(page.getByTestId('world-viewport')).toBeVisible();
    };
    await open();
    await page.getByRole('button', { name: 'Waynet', exact: true }).click();
    const arrow = async () => page.evaluate(async () => {
      const probe = (window as unknown as { __worldViewport?: {
        renderFrom: (from: number[], at: number[]) => Promise<{ width: number; height: number; rgba: string }>;
      } }).__worldViewport;
      if (!probe) return { count: 0, offset: 0, lights: 0, particles: 0 };
      const frame = await probe.renderFrom([0, 1200, 600], [0, 0, 0]);
      const pixels = Uint8Array.from(atob(frame.rgba), (character) => character.charCodeAt(0));
      let count = 0;
      let xSum = 0;
      let lights = 0;
      let particles = 0;
      for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
        const [r, g, b] = pixels.subarray(pixel * 4, pixel * 4 + 3);
        if (r < 130 && g > 140 && b > 180) { count++; xSum += pixel % frame.width + 0.5; }
        if (r > 200 && g > 180 && b < 160) lights++;
        if (r > 200 && b > 210 && g < 180) particles++;
      }
      return { count, offset: count ? xSum / count - frame.width / 2 : 0, lights, particles };
    });
    await expect.poll(async () => (await arrow()).count).toBeGreaterThan(50);
    const left = await arrow();
    // ZenGin +X mirrors to screen-left in this camera; the filled head is
    // heavier than the tail, so its coloured-pixel centroid must be left.
    expect(left.offset).toBeLessThan(-1);
    expect(left.lights).toBeGreaterThan(10);
    expect(left.particles).toBeGreaterThan(10);
    await page.screenshot({ path: test.info().outputPath('marker-types.png') });
    for (const mode of ['Faint', 'Fully visible', 'Occluded']) {
      await page.getByRole('combobox', { name: 'Marker occlusion' }).click();
      await page.getByRole('option', { name: mode, exact: true }).click();
      const frame = await arrow();
      expect(frame.count).toBeGreaterThan(50);
      expect(frame.offset).toBeLessThan(-1);
    }
    const canvas = page.getByTestId('world-viewport').locator('canvas');
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error('Viewport canvas has no bounds');
    await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
    await expect(page.getByRole('textbox', { name: 'Waypoint name' })).toHaveValue('WP_FACE');
    await canvas.click({ position: { x: 10, y: 10 } });
    await expect(page.getByTestId('world-waypoint-panel')).toHaveCount(0);
    // Reopen with changed stored facing: the new payload must draw right.
    await page.evaluate(async () => {
      const api = (window as unknown as { editorAPI: { getWorldWaynet: () => Promise<{ directions: ArrayBuffer }> } }).editorAPI;
      const net = await api.getWorldWaynet();
      new Float32Array(net.directions).set([-1, 0, 0]);
    });
    await open();
    await expect.poll(async () => (await arrow()).offset).toBeGreaterThan(1);
    expect(shaderErrors).toEqual([]);
  });
  test('marker distance and wall occlusion are independent view options', async ({ page }) => {
    await openWorldView(page);
    await expect(page.getByTestId('world-open')).toBeVisible();
    // Open through the real UI with a backend summary. Leave geometry pending:
    // this test covers view controls, while overlay tests cover GPU buffers.
    await page.evaluate(async (fixturePath) => {
      const { SUMMARY } = await import(/* @vite-ignore */ fixturePath);
      const api = (window as unknown as { editorAPI: Record<string, unknown> }).editorAPI;
      api.listWorlds = async () => [{
        path: SUMMARY.worldPath, name: 'NewWorld.zen', source: 'C:/Gothic', isDefault: false,
      }];
      api.openWorld = async () => SUMMARY;
      api.getWorldMesh = () => new Promise(() => {});
    }, `/@fs${resolve(__dirname, '../worldFixtures.ts')}`);
    await page.getByTestId('world-open').click();
    await page.getByTestId('world-picker-entry-NewWorld.zen').click();
    const markers = page.getByRole('button', { name: 'VOB markers' });
    const walls = page.getByRole('combobox', { name: 'Marker occlusion' });
    const distance = page.getByRole('combobox', { name: 'Marker distance' });
    await expect(markers).toBeEnabled();
    await expect(markers).toHaveAttribute('aria-pressed', 'true');
    await expect(walls).toHaveText('Occluded');
    await expect(distance).toHaveText('100 m');
    await markers.click();
    await expect(markers).toHaveAttribute('aria-pressed', 'false');
    await walls.click();
    await page.getByRole('option', { name: 'Faint', exact: true }).click();
    await expect(walls).toHaveText('Faint');
    await distance.click();
    await page.getByRole('option', { name: '25 m', exact: true }).click();
    await expect(distance).toHaveText('25 m');
    await expect(walls).toHaveText('Faint');
    await walls.click();
    await page.getByRole('option', { name: 'Fully visible', exact: true }).click();
    await expect(distance).toHaveText('25 m');
    await walls.click();
    await page.getByRole('option', { name: 'Occluded', exact: true }).click();
    await distance.click();
    await page.getByRole('option', { name: 'Unlimited', exact: true }).click();
    await expect(distance).toHaveText('Unlimited');
    await markers.click();
    await expect(markers).toHaveAttribute('aria-pressed', 'true');
    await expect(walls).toHaveText('Occluded');
  });
  test('marker view controls are visible and disabled before opening a world', async ({ page }) => {
    await openWorldView(page);
    await expect(page.getByRole('button', { name: 'VOB markers' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'VOB markers' })).toBeDisabled();
    await expect(page.getByRole('combobox', { name: 'Marker distance' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Marker distance' })).toBeDisabled();
  });
  test('the World view is reachable and says what it needs before it can show anything', async ({ page }) => {
    await openWorldView(page);

    // World mounts are owned by the active project configuration. The toolbar
    // exposes only the world-file action; asset sources are edited at project
    // level.
    await expect(page.getByTestId('world-open')).toBeVisible();
    // Open world, Save world, Save world as, Quick test.
    await expect(page.getByTestId('world-toolbar-file').getByRole('button')).toHaveCount(4);
  });

  test('the toolbar keeps its file controls in the file group', async ({ page }) => {
    // A regression tripwire for the toolbar restructure
    // (level-editor.md §17): the split into
    // WorldToolbar's four groups must not have left world-open or
    // asset-source controls outside the project-level action, and this is the
    // one thing the browser harness can check pre-open without a world.
    await openWorldView(page);

    const fileGroup = page.getByTestId('world-toolbar-file');
    await expect(fileGroup.getByTestId('world-open')).toBeVisible();
    await expect(fileGroup.getByTestId('world-save-as')).toBeVisible();
    await expect(fileGroup.getByTestId('world-gmbt-test')).toBeVisible();
    await expect(fileGroup.getByRole('button')).toHaveCount(4);
  });

  test('the add actions are in the bar before a world is open, disabled and named', async ({ page }) => {
    // The three used to be reachable only by clicking the ground first — and
    // two of them only with the Waynet overlay on. In the bar they are found
    // before they are needed; the tooltip says what each does.
    await openWorldView(page);

    const addGroup = page.getByTestId('world-toolbar-add');
    for (const testId of ['world-add-vob', 'world-add-npc', 'world-add-waypoint-toolbar']) {
      await expect(addGroup.getByTestId(testId)).toBeVisible();
      await expect(addGroup.getByTestId(testId)).toBeDisabled();
    }
    // A disabled button takes no pointer events; the tooltip hangs on the
    // span around it, which is what a real hover lands on.
    await addGroup.getByTestId('world-add-npc').locator('..').hover();
    await expect(page.getByRole('tooltip').filter({ hasText: /NPC/ })).toBeVisible();
    // And the counts are no longer in the bar at all.
    await expect(page.getByTestId('world-toolbar-stats')).toHaveCount(0);
  });

  test('the viewport is not mounted until a world is actually open', async ({ page }) => {
    // The scene costs tens of megabytes of GPU buffers; mounting it eagerly
    // would pay that for a view the user only glanced at.
    await openWorldView(page);
    await expect(page.getByTestId('world-viewport')).toHaveCount(0);
  });

  test('switching away from the World view hides it without unmounting it', async ({ page }) => {
    // `docs/refactoring-targets.md` §8: the surface holds the world's geometry
    // in local state and never refetches it on mount, so a conditional mount
    // loses it on every navigate-away. It is hidden by a display toggle now —
    // off screen but still in the DOM, and still the same instance.
    await openWorldView(page);
    await expect(page.getByTestId('world-open')).toBeVisible();

    await page.getByRole('button', { name: 'Dialog Editor' }).click();
    await expect(page.getByTestId('world-open')).toHaveCount(1);
    await expect(page.getByTestId('world-open')).not.toBeVisible();

    await page.getByTestId('world-toggle').click();
    await expect(page.getByTestId('world-open')).toBeVisible();
  });

  test('a refused open is reported, not left spinning', async ({ page }) => {
    // The mock API refuses `openWorld` outright, which is the same shape as the
    // real refusals a user will actually hit — no Gothic install configured, or
    // a world path outside the whitelist.
    await openWorldView(page);

    await page.evaluate(() => {
      const api = (window as unknown as { editorAPI: Record<string, unknown> }).editorAPI;
      api.openWorldDialog = async () => 'C:/Gothic II/NewWorld.zen';
    });

    await page.getByTestId('world-open').click();
    await page.getByTestId('world-picker-browse').click();
    await expect(page.getByTestId('world-error')).toBeVisible();
    await expect(page.getByTestId('world-viewport')).toHaveCount(0);
  });

  // The worlds the project's asset sources hold, listed instead of a native
  // file dialog aimed at one install (level-editor.md §16.31).
  test('lists the project`s own worlds and opens the one picked', async ({ page }) => {
    await openWorldView(page);

    await page.evaluate(() => {
      const api = (window as unknown as { editorAPI: Record<string, unknown> }).editorAPI;
      api.listWorlds = async () => [
        {
          path: 'C:/beppo/thirdparty/Worlds/BURGDORF.ZEN',
          name: 'BURGDORF.ZEN',
          source: 'C:/beppo/thirdparty',
          isDefault: false,
        },
        {
          path: 'C:/beppo/thirdparty/Worlds/SURFACE_BEPPO.ZEN',
          name: 'SURFACE_BEPPO.ZEN',
          source: 'C:/beppo/thirdparty',
          isDefault: true,
        },
      ];
      api.openWorld = async (request: { worldPath: string }) => {
        throw new Error(`refused: ${request.worldPath}`);
      };
    });

    await page.getByTestId('world-open').click();

    const picker = page.getByTestId('world-picker');
    await expect(picker.getByText('BURGDORF.ZEN')).toBeVisible();
    await expect(picker.getByText('SURFACE_BEPPO.ZEN')).toBeVisible();
    // The GMBT project's own default world is called out.
    await expect(picker.getByText('GMBT default')).toBeVisible();

    await picker.getByText('SURFACE_BEPPO.ZEN').click();

    // The refusal carries the picked path, which is what proves the list entry
    // and not the file dialog drove the open.
    await expect(page.getByTestId('world-error'))
      .toContainText('C:/beppo/thirdparty/Worlds/SURFACE_BEPPO.ZEN');
    await expect(picker).toHaveCount(0);
  });
});
