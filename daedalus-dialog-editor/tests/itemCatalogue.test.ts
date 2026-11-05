/**
 * The Items tab of the Assets panel (#412) reads the project's item instances as
 * a catalogue rather than as a file tree. Two pure steps turn the scripts into
 * it — the join with the visual an item declares, and the search — and both are
 * here rather than in the component because that is where they can be checked
 * without a project, a world or a GPU.
 */

import { describe, it, expect } from '@jest/globals';
import type { GlobalInstance } from '../src/shared/types';
import { itemCatalogueOf, searchItemCatalogue } from '../src/renderer/world/itemCatalogue';

const item = (name: string, displayName?: string): GlobalInstance => ({
  name,
  parent: 'C_ITEM',
  ...(displayName === undefined ? {} : { displayName }),
});

// Uppercased instance → visual, the key shape `WorldSurface`'s `itemVisuals`
// has, which is the one reader of a declaration's `visual` in the app.
const VISUALS = new Map<string, string>([
  ['ITFO_APPLE', 'ItFo_Apple.3DS'],
  ['ITMW_SWORD', 'ItMw_Sword_01.3DS'],
]);

describe('the item catalogue', () => {
  it('lists every instance with the name and visual its declaration carries', () => {
    const catalogue = itemCatalogueOf({
      ItFo_Apple: item('ItFo_Apple', 'Apfel'),
      ItMw_Sword: item('ItMw_Sword', 'Schwert'),
    }, VISUALS);

    expect(catalogue).toEqual([
      { instance: 'ItFo_Apple', name: 'Apfel', visual: 'ItFo_Apple.3DS' },
      { instance: 'ItMw_Sword', name: 'Schwert', visual: 'ItMw_Sword_01.3DS' },
    ]);
  });

  it('names an item with no display name by its instance, and gives it no visual', () => {
    const catalogue = itemCatalogueOf({ ItMi_Gold: item('ItMi_Gold') }, VISUALS);

    expect(catalogue).toEqual([{ instance: 'ItMi_Gold', name: 'ItMi_Gold', visual: null }]);
  });

  it('resolves a visual whatever case the declaration spells the instance in', () => {
    const catalogue = itemCatalogueOf({ itfo_apple: item('itfo_apple', 'Apfel') }, VISUALS);

    expect(catalogue[0].visual).toBe('ItFo_Apple.3DS');
  });

  it('is empty with no item index at all', () => {
    expect(itemCatalogueOf(undefined, VISUALS)).toEqual([]);
    expect(itemCatalogueOf({}, VISUALS)).toEqual([]);
  });
});

describe('searching the catalogue', () => {
  const catalogue = itemCatalogueOf({
    ItFo_Apple: item('ItFo_Apple', 'Apfel'),
    ItMw_Sword: item('ItMw_Sword', 'Schwert'),
    ItMi_Gold: item('ItMi_Gold', 'Gold'),
  }, VISUALS);

  it('matches the display name, not just the instance', () => {
    expect(searchItemCatalogue(catalogue, 'apf').map((entry) => entry.instance)).toEqual(['ItFo_Apple']);
  });

  it('matches the instance, in any case', () => {
    expect(searchItemCatalogue(catalogue, 'ITMW').map((entry) => entry.instance)).toEqual(['ItMw_Sword']);
  });

  it('shows everything for a blank needle and nothing for a miss', () => {
    expect(searchItemCatalogue(catalogue, '  ')).toEqual(catalogue);
    expect(searchItemCatalogue(catalogue, 'keule')).toEqual([]);
  });
});
