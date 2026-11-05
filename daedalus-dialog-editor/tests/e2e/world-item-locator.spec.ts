import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { viteFsUrl } from '../viteFsUrl';

/**
 * Spacer's Item Locator (#417, slice 3 of #412) — the World surface's Locator
 * tab: an `oCItem` search by radius around the camera, a "bad only" switch for
 * the instances the project cannot resolve, a name search, and a ring drawn per
 * match that can be selected.
 *
 * Browser mock-harness spec, so the world is a fixture: what it proves is the
 * flow — the tab, the three filters, the rows, the rings the viewport is
 * drawing, and a click that selects. The radius is the panel's own metres
 * against the viewport's own camera, which is why the two are driven here
 * through the real controls and read back off the real scene rather than
 * computed in the spec.
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

async function openProjectWithItems(page: Page): Promise<void> {
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
  await page.getByTestId('world-toggle').click();
}

/**
 * Three item VOBs: the apple and an instance no script declares, both by the
 * world's own origin, and the gold ten million units out — a distance no
 * default radius reaches, so "widen the radius and it appears" is a fact about
 * the filter rather than about where the camera happens to be.
 */
async function openWorldWithItems(page: Page): Promise<void> {
  await openProjectWithItems(page);
  await page.evaluate(async (fixturePath) => {
    const { SUMMARY, vobIndex } = await import(/* @vite-ignore */ fixturePath);
    const window_ = window as unknown as { editorAPI: Record<string, unknown> };
    const api = window_.editorAPI;
    api.listWorlds = async () => [{ path: SUMMARY.worldPath, name: 'NewWorld.zen', source: 'C:/Gothic', isDefault: false }];
    api.openWorld = async () => ({
      ...SUMMARY,
      assetSources: [],
      vobIndex: vobIndex(
        [[0, 0, 0], [100, 0, 0], [20_000_000, 0, 0]],
        'oCItem', undefined, ['APPLE', 'UNKNOWN', 'GOLD'], ['', '', ''],
      ),
    });
    api.getWorldMesh = async () => ({ groups: [], bbox: SUMMARY.bbox });
    api.getWorldVisuals = async () => ({ visuals: [], decals: { groups: [], count: 0 }, stats: {
      visualsSeen: 0, visualsResolved: 0, vobsPlaced: 0, instancedDrawGroups: 0,
      levelCompos: 0, unresolvedByType: {}, unresolved: [],
    } });
    api.getWorldItemInstances = async () => ({
      vobs: [0, 1, 2], instances: ['ItFo_Apple', 'ItFo_Unknown', 'ItMi_Gold'],
    });
    api.getVobProps = async () => ({ class: 'oCItem', instance: 'ItFo_Apple' });
    api.getWorldPortalFindings = async () => [];
    api.getVobFolders = async () => ({ folders: [] });
    api.getWorldHistoryDepth = async () => ({ undo: 0, redo: 0 });
    api.getAssetThumbnail = async () => ({ key: 'k', dataUrl: null });
  }, viteFsUrl(resolve(__dirname, '../worldFixtures.ts')));
  await page.getByTestId('world-open').click();
  await page.getByTestId('world-picker-entry-NewWorld.zen').click();
  await expect(page.getByTestId('world-viewport')).toBeVisible();
}

/** The VOBs the viewport's locator layer is drawing rings for. */
async function rings(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const probe = (window as unknown as {
      __worldViewport?: { locatorVobs: () => number[] };
    }).__worldViewport;
    return probe === undefined ? [] : probe.locatorVobs();
  });
}

test.describe('the item locator', () => {
  test('finds item VOBs by radius, bad instance and name, and selects a match', async ({ page }) => {
    await openWorldWithItems(page);

    // A tab of its own beside the three the panel already has.
    for (const tab of ['scene', 'assets', 'folders', 'locator']) {
      await expect(page.getByTestId(`world-panel-${tab}`)).toBeVisible();
    }
    await page.getByTestId('world-panel-locator').click();

    // Off until it is asked for: a ring nobody switched on would be a second
    // VOB overlay appearing with the world.
    await expect(page.getByTestId('world-locator-toggle')).not.toBeChecked();
    await expect(page.getByTestId('world-locator-vob-0')).toHaveCount(0);
    await page.getByTestId('world-locator-toggle').check();

    // The radius is the default 30 m — the reference's 3,000 — and it holds the
    // two items by the origin, not the one ten million units out.
    await expect(page.getByTestId('world-locator-vob-0')).toContainText('Apfel');
    await expect(page.getByTestId('world-locator-vob-1')).toContainText('ItFo_Unknown');
    await expect(page.getByTestId('world-locator-vob-2')).toHaveCount(0);
    await expect(page.getByTestId('world-locator-count')).toHaveText('2 of 3 items within 30 m');
    // The rings are the same set the rows are, not a second answer.
    await expect.poll(() => rings(page)).toEqual([0, 1]);

    // Widening the radius reaches the far one.
    await page.getByTestId('world-locator-radius').fill('300000');
    await expect(page.getByTestId('world-locator-vob-2')).toContainText('Gold');
    await expect.poll(() => rings(page)).toEqual([0, 1, 2]);

    // An instance no script declares is the one the property grid would refuse,
    // and it is the only thing "bad only" keeps.
    await page.getByTestId('world-locator-bad-only').check();
    await expect(page.getByTestId('world-locator-vob-0')).toHaveCount(0);
    await expect(page.getByTestId('world-locator-vob-1')).toBeVisible();
    await expect.poll(() => rings(page)).toEqual([1]);
    await page.getByTestId('world-locator-bad-only').uncheck();

    // The search is by the name a player reads or the instance, as the Items
    // tab's is: "apf" is in neither the VOB's name nor the filter's class.
    await page.getByTestId('world-locator-search').fill('apf');
    await expect(page.getByTestId('world-locator-vob-0')).toBeVisible();
    await expect(page.getByTestId('world-locator-vob-1')).toHaveCount(0);
    await expect(page.getByTestId('world-locator-vob-2')).toHaveCount(0);
    await expect.poll(() => rings(page)).toEqual([0]);
    await page.getByTestId('world-locator-search').fill('itmi_gold');
    await expect(page.getByTestId('world-locator-vob-2')).toBeVisible();
    await expect.poll(() => rings(page)).toEqual([2]);
    await page.getByTestId('world-locator-search').fill('keule');
    await expect(page.getByTestId('world-locator-empty')).toBeVisible();
    await expect.poll(() => rings(page)).toEqual([]);
    await page.getByTestId('world-locator-search').fill('');

    // A row is the store's selection, not a second one: clicking it selects the
    // VOB the property grid then describes.
    await page.getByTestId('world-locator-vob-1').click();
    await expect(page.getByTestId('world-prop-index')).toContainText('1');
  });
});
