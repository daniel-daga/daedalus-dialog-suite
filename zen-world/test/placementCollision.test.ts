// The collision a freshly placed VOB is given (#291). Everything collides except
// soft vegetation — bushes, grass, ferns and the like — which the player walks
// through in retail and which Florian otherwise switched off one VOB at a time.

import {
  addToCategory, emptyAssetCatalog, mergeCatalogs, parseAssetCatalog, placementCollision, setCategoryCollision,
} from '../src/model';

const ON = { cdStatic: true, cdDynamic: true };
const OFF = { cdStatic: false, cdDynamic: false };

describe('placementCollision', () => {
  it('turns collision off for bushes, grass, ferns, reeds and other soft plants', () => {
    for (const visual of [
      'NW_NATURE_BUSH_01.3DS',
      'OW_BUSHES_01.3DS',
      'ADDON_CANYONPLANT_BUSHES_01_120P.3DS',
      'NW_NATURE_GRASSGROUP_01.3DS',
      'NW_NATURE_WATERGRASS_56P.3DS',
      'NW_NATURE_FARN_102P.3DS',
      'ADDON_PLANTS_WALLFERN_01_117P.3DS',
      'NW_NATURE_GREAT_WEED_XGROUP.3DS',
      'OW_LOB_BUSH_REED_V1.3DS',
      'NW_NATURE_LIANA_01_87P.3DS',
      'NW_NATURE_PLANT_01.3DS',
      'NW_NATURE_WATERLILI_WHITE_32P.3DS',
      'OW_MUSHROOM_V1.3DS',
      // A mod's own bush — Archolos' naming, never in any seed.
      'KM_VOB_BIG_BUSH_01.3DS',
    ]) {
      expect([visual, placementCollision(visual)]).toEqual([visual, OFF]);
    }
  });

  it('keeps collision on for trees, stumps and cacti even when their name also says plant', () => {
    // `Pflanzen` in the seed holds these next to the bushes, and a tree the
    // player walks through is the bug this rule must not introduce.
    for (const visual of [
      'ADDON_CANYONPLANT_TREE_01_1010P.3DS',
      'ADDON_CANYONPLANT_CACTUSBIG_01_165P.3DS',
      'ADDON_PLANTS_JUNGLETREE_01_1845P.3DS',
      'ADDON_PLANTS_SMALLPALM_01_73P.3DS',
      'NW_NATURE_HOHETANNE_59P.3DS',
      'NW_NATURE_BAUMSTUMPF_115P.3DS',
      'NW_NATURE_BAUMSTAMM_166P.3DS',
      'OW_LOB_TREE_ROOT_V1.3DS',
    ]) {
      expect([visual, placementCollision(visual)]).toEqual([visual, ON]);
    }
  });

  it('keeps collision on for everything that is not vegetation', () => {
    for (const visual of ['NW_CRATE.3DS', 'NW_NATURE_STONE_01.3DS', 'NW_CITY_BENCH_01.3DS', 'ORC_WALL.MRM']) {
      expect([visual, placementCollision(visual)]).toEqual([visual, ON]);
    }
  });

  it('reads the name the way the catalogue does — any case, any extension, any directory', () => {
    expect(placementCollision('nw_nature_bush_01.mrm')).toEqual(OFF);
    expect(placementCollision('Meshes/_compiled/NW_NATURE_BUSH_01.MRM')).toEqual(OFF);
    // The directory is not the name: a crate filed under a folder called
    // "Bushes" is still a crate.
    expect(placementCollision('Bushes/NW_CRATE.3DS')).toEqual(ON);
  });
});

describe('the per-category override (#291)', () => {
  const withBushes = addToCategory(emptyAssetCatalog(), 'Archolos/Büsche', 'KM_ODD_SHRUBBERY_01.3DS');

  it('is absent until set, and the name rule decides', () => {
    expect(withBushes.categories[0].collision).toBeUndefined();
    expect(placementCollision('KM_ODD_SHRUBBERY_01.3DS', withBushes)).toEqual(ON);
  });

  it('turns a category off, whatever its visuals are called', () => {
    const off = setCategoryCollision(withBushes, 'Archolos/Büsche', false);
    // Matched by key, as a favourite is: the compiled name the browser lists
    // is the same visual.
    expect(placementCollision('KM_ODD_SHRUBBERY_01.MRM', off)).toEqual(OFF);
    // A visual the category does not hold is still the rule's.
    expect(placementCollision('NW_CRATE.3DS', off)).toEqual(ON);
  });

  it('turns a category on, over a name the rule would have turned off', () => {
    const on = setCategoryCollision(
      addToCategory(emptyAssetCatalog(), 'Hecken', 'NW_NATURE_BUSH_WALL.3DS'), 'Hecken', true,
    );
    expect(placementCollision('NW_NATURE_BUSH_WALL.3DS', on)).toEqual(ON);
  });

  it('goes back to the rule when cleared', () => {
    const cleared = setCategoryCollision(setCategoryCollision(withBushes, 'Archolos/Büsche', false), 'Archolos/Büsche', undefined);
    expect(cleared.categories[0]).toEqual({ path: 'Archolos/Büsche', visuals: ['KM_ODD_SHRUBBERY_01.3DS'] });
  });

  it('can be set on a category the project has not filed anything into, which is how a seed category gets one', () => {
    const seed = addToCategory(emptyAssetCatalog(), 'Pflanzen', 'NW_NATURE_PLANT_01.3DS');
    const own = setCategoryCollision(emptyAssetCatalog(), 'Pflanzen', true);
    expect(own.categories).toEqual([{ path: 'Pflanzen', visuals: [], collision: true }]);
    // The project's setting reaches the seed's visuals through the merge.
    const merged = mergeCatalogs(seed, own);
    expect(merged.categories).toEqual([{ path: 'Pflanzen', visuals: ['NW_NATURE_PLANT_01.3DS'], collision: true }]);
    expect(placementCollision('NW_NATURE_PLANT_01.3DS', merged)).toEqual(ON);
  });

  it('takes the first category in catalogue order when two disagree', () => {
    let both = addToCategory(emptyAssetCatalog(), 'A', 'NW_NATURE_BUSH_01.3DS');
    both = addToCategory(both, 'B', 'NW_NATURE_BUSH_01.3DS');
    both = setCategoryCollision(setCategoryCollision(both, 'A', true), 'B', false);
    expect(placementCollision('NW_NATURE_BUSH_01.3DS', both)).toEqual(ON);
  });

  it('survives a round trip through the sidecar parser, and drops a value that is not a boolean', () => {
    const off = setCategoryCollision(withBushes, 'Archolos/Büsche', false);
    expect(parseAssetCatalog(JSON.parse(JSON.stringify(off)))).toEqual(off);
    expect(parseAssetCatalog({ categories: [{ path: 'X', visuals: [], collision: 'off' }] }).categories)
      .toEqual([{ path: 'X', visuals: [] }]);
  });
});
