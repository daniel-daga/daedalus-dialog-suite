/**
 * The Item Locator (#417) reads three facts per `oCItem` — where it stands, the
 * instance it names, and whether the project declares that instance — and two
 * of them arrive in different payloads. The join is pure, so it is checked here
 * without a world, a project or a GPU; only the radius needs a camera, which is
 * why it is a second step over the same list.
 */

import { describe, it, expect } from '@jest/globals';
import type { ItemInstances } from '../src/shared/worldTypes';
import { itemCatalogueOf } from '../src/renderer/world/itemCatalogue';
import { locatorItemsOf, nearbyItems } from '../src/renderer/world/itemLocator';
import { vobIndex } from './worldFixtures';

// Three item VOBs a hundred metres apart along +X, and the payload the worker
// answers with: an instance per VOB, one of which no script declares.
const INDEX = vobIndex([[0, 0, 0], [10_000, 0, 0], [20_000, 0, 0]]);
const INSTANCES: ItemInstances = {
  vobs: [0, 1, 2],
  instances: ['ItFo_Apple', 'ItFo_Unknown', 'ItMi_Gold'],
};

const CATALOGUE = itemCatalogueOf({
  ItFo_Apple: { name: 'ItFo_Apple', parent: 'C_ITEM', displayName: 'Apfel' },
  ItMi_Gold: { name: 'ItMi_Gold', parent: 'C_ITEM', displayName: 'Gold' },
}, new Map());

// The grid's own index: the instance names the loaded project declares, by the
// uppercased key it compares `oCItem.instance` against.
const DECLARED = new Set(['ITFO_APPLE', 'ITMI_GOLD']);

const ALL = { search: '', badOnly: false };

describe('the item locator', () => {
  it('lists every placed item with its position, name and whether it resolves', () => {
    expect(locatorItemsOf(INSTANCES, INDEX, DECLARED, CATALOGUE, ALL)).toEqual([
      { vob: 0, at: [0, 0, 0], instance: 'ItFo_Apple', name: 'Apfel', bad: false },
      { vob: 1, at: [10_000, 0, 0], instance: 'ItFo_Unknown', name: 'ItFo_Unknown', bad: true },
      { vob: 2, at: [20_000, 0, 0], instance: 'ItMi_Gold', name: 'Gold', bad: false },
    ]);
  });

  it('resolves an instance whatever case the world spells it in', () => {
    const spelled = locatorItemsOf(
      { vobs: [0], instances: ['itfo_apple'] }, INDEX, DECLARED, CATALOGUE, ALL,
    );
    expect(spelled).toMatchObject([{ name: 'Apfel', bad: false }]);
  });

  it('keeps only the bad ones when asked', () => {
    expect(locatorItemsOf(INSTANCES, INDEX, DECLARED, CATALOGUE, { search: '', badOnly: true }))
      .toMatchObject([{ vob: 1, bad: true }]);
  });

  it('searches the name a player reads and the instance it is named by', () => {
    const instances = (needle: string) => locatorItemsOf(
      INSTANCES, INDEX, DECLARED, CATALOGUE, { search: needle, badOnly: false },
    ).map((item) => item.vob);

    expect(instances('apf')).toEqual([0]);
    expect(instances('ITMI')).toEqual([2]);
    expect(instances('  ')).toEqual([0, 1, 2]);
    expect(instances('keule')).toEqual([]);
  });

  it('is empty for a world with no item payload, an index that does not place one, or an item with no instance', () => {
    expect(locatorItemsOf(null, INDEX, DECLARED, CATALOGUE, ALL)).toEqual([]);
    expect(locatorItemsOf({ vobs: [9], instances: ['ItMi_Gold'] }, INDEX, DECLARED, CATALOGUE, ALL))
      .toEqual([]);
    expect(locatorItemsOf({ vobs: [0], instances: [''] }, INDEX, DECLARED, CATALOGUE, ALL))
      .toEqual([]);
  });
});

describe('the locator`s radius', () => {
  const items = locatorItemsOf(INSTANCES, INDEX, DECLARED, CATALOGUE, ALL);

  const vobs = (center: [number, number, number], radiusCm: number) =>
    nearbyItems(items, center, radiusCm).map((item) => item.vob);

  it('keeps what a sphere around the camera reaches, nearest first', () => {
    expect(vobs([9_000, 0, 0], 2_000)).toEqual([1]);
    expect(vobs([0, 0, 0], 25_000)).toEqual([0, 1, 2]);
  });

  it('measures in three dimensions, not on the ground plane', () => {
    // Directly above the first VOB, far above the second's reach.
    expect(vobs([0, 1_500, 0], 2_000)).toEqual([0]);
  });

  it('is the whole list for a radius no camera could be outside', () => {
    expect(vobs([0, 0, 0], Infinity)).toEqual([0, 1, 2]);
  });
});
