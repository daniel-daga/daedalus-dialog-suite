// Favorites and categories on the asset browser (level-editor.md §16.26,
// "Wanted on top") — pure state over visual names, persisted by the editor
// as a project sidecar and seeded from vobbilder's category tree.

import {
  addManyToCategory, addToCategory, assetKey, createCategory, emptyAssetCatalog, isFavorite, mergeCatalogs,
  parseAssetCatalog, removeFromCategory, toggleFavorite, visualsOf,
} from '../src/model';

describe('assetKey', () => {
  it('is the bare name without its extension, case-folded, so a compiled name and its source name agree', () => {
    // A VOB carries `NW_CRATE.3DS`, the VFS lists `NW_CRATE.MRM`, vobbilder
    // says `nw_crate`: one visual, three spellings.
    expect(assetKey('NW_CRATE.MRM')).toBe('NW_CRATE');
    expect(assetKey('nw_crate.3ds')).toBe('NW_CRATE');
    expect(assetKey('Meshes/_compiled/NW_CRATE.MRM')).toBe('NW_CRATE');
    expect(assetKey('NW_CRATE')).toBe('NW_CRATE');
  });
});

describe('favorites', () => {
  it('toggle on, toggle off, matched by key rather than spelling', () => {
    const on = toggleFavorite(emptyAssetCatalog(), 'NW_CRATE.MRM');
    expect(on.favorites).toEqual(['NW_CRATE.MRM']);
    expect(isFavorite(on, 'nw_crate.3ds')).toBe(true);
    const off = toggleFavorite(on, 'NW_CRATE.3DS');
    expect(off.favorites).toEqual([]);
  });
});

describe('categories', () => {
  it('creates a category once, and files a visual once', () => {
    let state = createCategory(emptyAssetCatalog(), 'Mine/Crates');
    state = createCategory(state, 'Mine/Crates');
    state = addToCategory(state, 'Mine/Crates', 'NW_CRATE.MRM');
    state = addToCategory(state, 'Mine/Crates', 'nw_crate.3ds');
    expect(state.categories).toEqual([{ path: 'Mine/Crates', visuals: ['NW_CRATE.MRM'] }]);
  });

  it('files into a category that does not exist yet by creating it', () => {
    const state = addToCategory(emptyAssetCatalog(), 'Mine/Crates', 'NW_CRATE.MRM');
    expect(state.categories).toEqual([{ path: 'Mine/Crates', visuals: ['NW_CRATE.MRM'] }]);
  });

  it('removes by key', () => {
    const state = removeFromCategory(addToCategory(emptyAssetCatalog(), 'Mine/Crates', 'NW_CRATE.MRM'), 'Mine/Crates', 'NW_CRATE.3DS');
    expect(state.categories).toEqual([{ path: 'Mine/Crates', visuals: [] }]);
  });
});

describe('mergeCatalogs', () => {
  const seed = {
    favorites: [],
    categories: [{ path: 'Items/Schwerter', visuals: ['ITMW_1H_SWORD_01.3DS'] }],
  };

  it('shows the seed and the project sidecar as one tree, seed categories first, the user’s visuals after the seed’s', () => {
    const user = {
      favorites: ['NW_CRATE.MRM'],
      categories: [
        { path: 'Mine/Crates', visuals: ['NW_CRATE.MRM'] },
        { path: 'Items/Schwerter', visuals: ['MY_SWORD.3DS', 'itmw_1h_sword_01.mrm'] },
      ],
    };
    const merged = mergeCatalogs(seed, user);
    expect(merged.favorites).toEqual(['NW_CRATE.MRM']);
    expect(merged.categories).toEqual([
      { path: 'Items/Schwerter', visuals: ['ITMW_1H_SWORD_01.3DS', 'MY_SWORD.3DS'] },
      { path: 'Mine/Crates', visuals: ['NW_CRATE.MRM'] },
    ]);
    expect(visualsOf(merged, 'Items/Schwerter')).toEqual(['ITMW_1H_SWORD_01.3DS', 'MY_SWORD.3DS']);
    expect(visualsOf(merged, 'Nowhere')).toEqual([]);
  });
});

describe('parseAssetCatalog', () => {
  it('collapses anything malformed to the empty state rather than throwing', () => {
    expect(parseAssetCatalog(null)).toEqual(emptyAssetCatalog());
    expect(parseAssetCatalog('x')).toEqual(emptyAssetCatalog());
    expect(parseAssetCatalog({ favorites: 'no', categories: 3 })).toEqual(emptyAssetCatalog());
  });

  it('keeps the well-formed entries and drops the rest', () => {
    expect(parseAssetCatalog({
      favorites: ['A.MRM', 3, null],
      categories: [{ path: 'P', visuals: ['B.MRM', 7] }, { path: 4 }, 'x', { path: 'Q', visuals: 'no' }],
    })).toEqual({ favorites: ['A.MRM'], categories: [{ path: 'P', visuals: ['B.MRM'] }] });
  });
});

// #295: the Archolos set is hundreds of visuals, and filing was one tile at a
// time — one sidecar write each.
describe('addManyToCategory', () => {
  it('files every name at once, creating the category, in the order given', () => {
    const next = addManyToCategory(emptyAssetCatalog(), 'Archolos/Büsche', ['KM_BUSH_01.MRM', 'KM_BUSH_02.MRM']);
    expect(next.categories).toEqual([{ path: 'Archolos/Büsche', visuals: ['KM_BUSH_01.MRM', 'KM_BUSH_02.MRM'] }]);
  });

  it('skips what is already filed there, and a name given twice, by key', () => {
    const filed = addToCategory(emptyAssetCatalog(), 'Mine', 'NW_CRATE.3DS');
    const next = addManyToCategory(filed, 'Mine', ['nw_crate.mrm', 'KM_BUSH_01.MRM', 'KM_BUSH_01.3DS']);
    expect(visualsOf(next, 'Mine')).toEqual(['NW_CRATE.3DS', 'KM_BUSH_01.MRM']);
  });

  it('leaves other categories alone, and the state unchanged when there is nothing new', () => {
    const filed = addToCategory(addToCategory(emptyAssetCatalog(), 'A', 'X.MRM'), 'B', 'Y.MRM');
    expect(addManyToCategory(filed, 'A', ['X.3DS'])).toBe(filed);
    expect(visualsOf(addManyToCategory(filed, 'A', ['Z.MRM']), 'B')).toEqual(['Y.MRM']);
  });
});
