import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { viteFsUrl } from '../viteFsUrl';

/**
 * The Items tab of the World surface's Assets panel (#412, slice 1) — Spacer's
 * Objects window: the project's item instances listed by name and picture
 * rather than as files, searched, and placed with `oCItem.instance` filled in.
 *
 * Browser mock-harness spec, so the world itself is a fixture: what it proves is
 * the flow — the tab is in the same row as Browse/Favorites/Categories, the list
 * is the project's instances with the visual each declares, the search narrows
 * it, and a click arms a placement whose op carries the item's instance. The
 * op's own acceptance and the engine's verdict are the binding's and Gate 2b's.
 */

// Retail shapes: `name` is what a player reads, `visual` the mesh the instance
// supplies — an `oCItem` VOB stores neither (#424).
const ITEMS_FILE = `//__MOCK_MODEL__${JSON.stringify({
  items: {
    ItFo_Apple: {
      name: 'ItFo_Apple',
      parent: 'C_ITEM',
      displayName: 'Apfel',
      sourceText: 'INSTANCE ItFo_Apple (C_ITEM)\n{\n\tname = "Apfel";\n\tvisual = "ItFo_Apple.3DS";\n};',
    },
    ItMi_Gold: {
      name: 'ItMi_Gold',
      parent: 'C_ITEM',
      displayName: 'Gold',
      sourceText: 'INSTANCE ItMi_Gold (C_ITEM)\n{\n\tname = "Gold";\n\tvisual = "ItMi_Gold.3DS";\n};',
    },
  },
})}\n`;

// The surface's item index is the *merged* model — the project's globals, the
// dialog-less files that declare the items — which is the index `oCItem.instance`
// is checked against (§7). Project load merges them with no NPC selected (#526),
// so the spec picks none.

interface Harness {
  ops: Array<Array<Record<string, unknown>>>;
  /** Every name the thumbnail queue asked for — the item's visual, for a preview. */
  thumbnails: string[];
}

async function openWorldWithItems(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('Welcome to Dandelion')).toBeVisible();
  await page.evaluate(({ items }) => {
    localStorage.setItem('mockapi_file_project/world.d', '// empty\n');
    localStorage.setItem('mockapi_file_project/Items.d', items);
  }, { items: ITEMS_FILE });
  page.on('dialog', async (dialog) => {
    if (dialog.message().includes('project folder path')) await dialog.accept('project');
    else await dialog.dismiss();
  });
  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await expect(page.getByTestId('project-opening-overlay')).toBeHidden({ timeout: 15000 });

  // The World view is a view toggle of the main layout, which needs a project.
  await page.getByTestId('world-toggle').click();

  await page.evaluate(async (fixturePath) => {
    const { SUMMARY, vobIndex } = await import(/* @vite-ignore */ fixturePath);
    const window_ = window as unknown as { editorAPI: Record<string, unknown>; __ops: unknown[]; __thumbs: string[] };
    const api = window_.editorAPI;
    window_.__ops = [];
    window_.__thumbs = [];
    api.listWorlds = async () => [{ path: SUMMARY.worldPath, name: 'NewWorld.zen', source: 'C:/Gothic', isDefault: false }];
    api.openWorld = async () => ({
      ...SUMMARY, assetSources: [], vobIndex: vobIndex([[0, 0, 0]], 'zCVob', undefined, ['BARREL'], ['']),
    });
    api.getWorldMesh = async () => ({ groups: [], bbox: SUMMARY.bbox });
    api.getWorldVisuals = async () => ({ visuals: [], decals: { groups: [], count: 0 }, stats: {
      visualsSeen: 0, visualsResolved: 0, vobsPlaced: 0, instancedDrawGroups: 0,
      levelCompos: 0, unresolvedByType: {}, unresolved: [],
    } });
    api.getWorldItemInstances = async () => ({ vobs: [], instances: [] });
    api.getVobProps = async () => ({ class: 'zCVob' });
    api.getWorldPortalFindings = async () => [];
    api.getVobFolders = async () => ({ folders: [] });
    api.getWorldHistoryDepth = async () => ({ undo: 0, redo: 0 });
    api.applyWorldOps = async (ops: unknown[]) => { window_.__ops.push(ops); };
    api.getAssetThumbnail = async (name: string) => {
      window_.__thumbs.push(name);
      return { key: 'k', dataUrl: null };
    };
  }, viteFsUrl(resolve(__dirname, '../worldFixtures.ts')));
}

async function readHarness(page: Page): Promise<Harness> {
  return page.evaluate(() => {
    const window_ = window as unknown as { __ops: Harness['ops']; __thumbs: string[] };
    return { ops: window_.__ops, thumbnails: window_.__thumbs };
  });
}

async function openWorld(page: Page) {
  await page.getByTestId('world-open').click();
  await page.getByTestId('world-picker-entry-NewWorld.zen').click();
  await expect(page.getByTestId('world-viewport')).toBeVisible();
}

test.describe('the Items tab', () => {
  test('lists the project`s items, searches them, and places one as an oCItem', async ({ page }) => {
    await openWorldWithItems(page);
    await openWorld(page);

    await page.getByTestId('world-panel-assets').click();
    // A tab beside the three the panel already has, not a replacement for them.
    for (const mode of ['browse', 'favorites', 'categories', 'items']) {
      await expect(page.getByTestId(`world-asset-mode-${mode}`)).toBeVisible();
    }
    await page.getByTestId('world-asset-mode-items').click();

    // Items, not files: the two the project declares, by the name a player reads
    // and by the instance the placement will send.
    const apple = page.getByTestId('world-item-ITFO_APPLE');
    await expect(apple).toBeVisible();
    await expect(apple).toContainText('Apfel');
    await expect(apple).toContainText('ItFo_Apple');
    await expect(page.getByTestId('world-item-ITMI_GOLD')).toContainText('Gold');
    await expect(page.getByTestId('world-item-count')).toHaveText('2 items');

    // The preview is the asset browser's own queue, asked for the visual the
    // item's declaration assigns — an item stores none in the world.
    await expect.poll(async () => (await readHarness(page)).thumbnails).toContain('ItFo_Apple.3DS');

    // Searching by the name, which is a term no instance name carries.
    await page.getByTestId('world-item-filter').fill('gold');
    await expect(page.getByTestId('world-item-ITMI_GOLD')).toBeVisible();
    await expect(page.getByTestId('world-item-ITFO_APPLE')).toHaveCount(0);
    await page.getByTestId('world-item-filter').fill('apf');
    await expect(page.getByTestId('world-item-ITFO_APPLE')).toBeVisible();
    await page.getByTestId('world-item-filter').fill('keule');
    await expect(page.getByTestId('world-item-filter-empty')).toBeVisible();
    await page.getByTestId('world-item-filter').fill('');

    // Placing: the click arms it, the ground click puts it down.
    await page.getByTestId('world-item-ITFO_APPLE').click();
    await expect(page.getByTestId('world-terrain-hint')).toContainText('ItFo_Apple');
    await page.evaluate(() => {
      (window as unknown as { __worldViewport: { pickTerrain: (point: number[]) => void } })
        .__worldViewport.pickTerrain([100, 0, 250]);
    });

    await expect.poll(async () => (await readHarness(page)).ops).toHaveLength(1);
    const [add] = (await readHarness(page)).ops[0];
    expect(add).toMatchObject({
      op: 'AddVob',
      from: null,
      to: { class: 'oCItem', instance: 'ItFo_Apple', position: [100, 0, 250] },
    });
    // An item carries no visual on disk: the instance supplies it.
    expect((add.to as Record<string, unknown>).visual).toBeUndefined();
  });
});
