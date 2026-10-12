'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { tallyDecalAlphaFuncs } = require('../scripts/check-decal-alpha-funcs.js');

// The tabulation behind `check-decal-alpha-funcs.js` (level-editor.md §16.40,
// #262): how many groups the decal layer draws if it groups by (texture,
// alphaFunc) rather than by texture. The script needs the extracted worlds;
// these pin the pure step the answer rests on.

test('counts decals per alpha function by name', () => {
  const tally = tallyDecalAlphaFuncs([
    { texture: 'A.TGA', alphaFunc: 2 },
    { texture: 'B.TGA', alphaFunc: 2 },
    { texture: 'C.TGA', alphaFunc: 3 },
  ]);

  assert.strictEqual(tally.total, 3);
  assert.deepStrictEqual([...tally.byFunc], [['BLEND', 2], ['ADD', 1]]);
});

test('a texture carried under two funcs is one texture group and two func groups', () => {
  const tally = tallyDecalAlphaFuncs([
    { texture: 'A.TGA', alphaFunc: 2 },
    { texture: 'A.TGA', alphaFunc: 2 },
    { texture: 'A.TGA', alphaFunc: 3 },
    { texture: 'B.TGA', alphaFunc: 3 },
  ]);

  assert.strictEqual(tally.textureGroups, 2);
  assert.strictEqual(tally.funcGroups, 3);
  assert.deepStrictEqual(tally.mixedTextures, ['A.TGA']);
});

test('groups only what the viewport draws, keyed as it keys them', () => {
  // `buildDecalBillboards` groups by the visual name verbatim and skips a decal
  // with no area or no texture, so the count it is compared against does too.
  const tally = tallyDecalAlphaFuncs([
    { texture: 'a.tga', alphaFunc: 2 },
    { texture: 'A.TGA', alphaFunc: 2 },
    { texture: 'B.TGA', alphaFunc: 3, dimension: [0, 40] },
    { texture: '', alphaFunc: 5 },
  ]);

  assert.strictEqual(tally.total, 4);
  assert.strictEqual(tally.textureGroups, 2);
  assert.strictEqual(tally.funcGroups, 2);
});

test('a value outside the enum is reported, not dropped', () => {
  const tally = tallyDecalAlphaFuncs([{ texture: 'A.TGA', alphaFunc: 9 }]);
  assert.deepStrictEqual([...tally.byFunc], [['9', 1]]);
});
