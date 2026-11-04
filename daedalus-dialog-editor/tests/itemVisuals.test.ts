/**
 * An `oCItem` stores no visual — the engine reads it off the script instance the
 * VOB names (#424), so the item's mesh is only drawable once the instance is
 * resolved against the project's scripts. These are the two pure steps that do
 * it: the visual a `C_ITEM` declaration assigns, and the join with the item VOBs
 * the world carries. Both are here rather than in the surface because that is
 * where they can be checked without a world, a project or a GPU.
 */

import { itemVisualOfSource, visualOverridesOf } from '../src/renderer/world/itemVisuals';

// Retail shapes, verbatim enough: the field is a quoted file name in both, and
// the two differ in everything around it.
const APPLE = `
instance ItFo_Apple(C_ITEM)
{
    name            = "Apfel";
    mainflag        = ITEM_KAT_FOOD;
    flags           = ITEM_EAT;
    nutrition       = NUTRITION_VALUE;
    value           = NUTRITION_VALUE;
    visual          = "ItFo_Apple.3DS";
    visual_skin     = 0;
    scemeName       = "FOOD";
    material        = MAT_APPLE;
};
`;

const SWORD = `
prototype ItMw_1H_Sword(C_ITEM)
{
    name            = "Schwert";
    mainflag        = ITEM_KAT_NF;
    damageTotal     = 20;
    visual          = "ItMw_Sword_01.3DS";
    visual_skin     = 0;
    scemeName       = "1HSSWORD";
};
`;

describe('itemVisualOfSource', () => {
  test('reads the visual an item declaration assigns', () => {
    expect(itemVisualOfSource(APPLE)).toBe('ItFo_Apple.3DS');
    expect(itemVisualOfSource(SWORD)).toBe('ItMw_Sword_01.3DS');
  });

  test('is null where the declaration assigns none, or assigns a symbol', () => {
    // A constant is not a file name, and the reader does not evaluate the
    // script: the item keeps its marker rather than being drawn as garbage.
    expect(itemVisualOfSource('instance ITFO_APPLE(C_ITEM)\n{\n    name = "Apfel";\n};'))
      .toBeNull();
    expect(itemVisualOfSource('instance I(C_ITEM) { visual = ITEM_VISUAL; };')).toBeNull();
    expect(itemVisualOfSource(undefined)).toBeNull();
  });
});

describe('visualOverridesOf', () => {
  const project = new Map([['ITPL_BLUEPLANT', 'ItPl_Blueplant.3DS']]);

  test('joins the world\'s item VOBs with the project\'s item sources', () => {
    expect(visualOverridesOf({ vobs: [3, 209], instances: ['ITPL_BLUEPLANT', 'itpl_blueplant'] }, project))
      .toEqual({ vobs: [3, 209], visuals: ['ItPl_Blueplant.3DS', 'ItPl_Blueplant.3DS'] });
  });

  test('leaves out an item the project does not resolve', () => {
    // Nothing was placed for it, so the marker it has today is what it keeps —
    // the same answer an item that assigns its visual through a constant gets.
    expect(visualOverridesOf({ vobs: [3, 7], instances: ['ITPL_BLUEPLANT', 'ITFO_APPLE'] }, project))
      .toEqual({ vobs: [3], visuals: ['ItPl_Blueplant.3DS'] });
  });

  test('is undefined where nothing resolves, and for a world with no items', () => {
    expect(visualOverridesOf({ vobs: [], instances: [] }, project)).toBeUndefined();
    expect(visualOverridesOf({ vobs: [7], instances: ['ITFO_APPLE'] }, project)).toBeUndefined();
    expect(visualOverridesOf({ vobs: [], instances: [] }, new Map())).toBeUndefined();
  });
});
