/**
 * The shipped category seed (level-editor.md §16.26, "Wanted on top") —
 * vobbilder's hand-authored tree, converted by `scripts/convert-vobbilder.js`
 * and checked in as data. What is asserted is the shape every reader relies
 * on and a few facts about the source that a re-run of the converter against
 * a different tool version would change.
 *
 * @jest-environment node
 */

import { parseAssetCatalog } from 'zen-world';
import seed from '../src/shared/assetCategorySeed.json';

describe('the asset category seed', () => {
  it('names its source and author', () => {
    expect(seed.$source).toMatch(/vobbilder/);
    expect(seed.$source).toMatch(/Felix Horn/);
    expect(seed.version).toBe(1);
  });

  it('parses as a catalogue with vobbilder’s category tree, Gothic II entries only', () => {
    const catalog = parseAssetCatalog(seed);
    expect(catalog.favorites).toEqual([]);
    expect(catalog.categories.length).toBeGreaterThanOrEqual(30);
    const paths = catalog.categories.map((category) => category.path);
    expect(paths).toContain('Items/Bögen und Armbrüste');
    expect(paths).toContain('Items/Schwerter');
    expect(paths).toContain('Bäume');
    // Every path is unique, every entry a `.3DS` source name, uppercased, once.
    expect(new Set(paths).size).toBe(paths.length);
    for (const category of catalog.categories) {
      expect(category.visuals.length).toBeGreaterThan(0);
      expect(new Set(category.visuals).size).toBe(category.visuals.length);
      for (const visual of category.visuals) expect(visual).toMatch(/^[A-Z0-9_\-!&()+.]+\.3DS$/);
    }
    // Two retail names, where the tool files them.
    expect(catalog.categories.find((c) => c.path === 'Items/Bögen und Armbrüste')?.visuals).toContain('ITRW_ARROW.3DS');
    expect(catalog.categories.find((c) => c.path === 'Items/Schwerter')?.visuals).toContain('ITMW_010_1H_SWORD_SHORT_01.3DS');
    // A G1-only name must not be here: G1 is not installed and the seed is G2.
    for (const category of catalog.categories) expect(category.visuals).not.toContain('ITRW_BOW_LONG_01.3DS');
  });

  // #406, measured: what the furniture question can be answered from here.
  // The catalogue files the beds — in a German category, under their English
  // file names — and holds no armchair at all, because the tree is vobbilder's
  // `.3DS` meshes and the interactive furniture is an `.ASC`/`.MDS` model
  // (zen-world's `MOB_SCHEMES`: `BENCH_1_OC.ASC`, `CHAIR_1_OC.ASC`). Neither
  // list can match a German object word: the categories are German, the
  // visuals are the file names, and there is no word-to-visual table here.
  it('holds three beds under a German category, no armchair, and no German object word', () => {
    const catalog = parseAssetCatalog(seed);
    const furniture = catalog.categories.find((category) => category.path === 'Einrichtungsgegenstände');
    expect(furniture?.visuals.filter((visual) => visual.includes('BED')))
      .toEqual(['DT_BED_V1.3DS', 'ORC_BED_01.3DS', 'ORC_E_BED.3DS']);
    const everyVisual = catalog.categories.flatMap((category) => category.visuals);
    expect(everyVisual.filter((visual) => /CHAIR|SESSEL|BENCH|STUHL/.test(visual))).toEqual([]);
    expect(everyVisual.filter((visual) => /BETT|TISCH|SCHRANK|REGAL|KASTEN/.test(visual))).toEqual([]);
  });
});
