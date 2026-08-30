'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  visualExtension,
  tallyVisualTypes,
  ambiguousExtensions,
} = require('../scripts/check-visual-types.js');

// The tabulation behind `check-visual-types.js`, which reports extension ×
// visual class over the retail corpus (level-editor.md §14.1 1.7, and the
// table in `docs/architecture/level-editor.md` under "A visual is renamed,
// never re-typed"). The script itself needs the extracted worlds; these pin
// the pure step it rests on.

/** A `vobIndex`-shaped column pair from a list of `[visual, type]` pairs. */
function fakeIndex(pairs) {
  const visuals = [];
  const visualTypes = [];
  const visualIndex = new Uint32Array(pairs.length);
  const visualTypeIndex = new Uint32Array(pairs.length);
  pairs.forEach(([visual, type], at) => {
    let v = visuals.indexOf(visual);
    if (v < 0) { v = visuals.push(visual) - 1; }
    let t = visualTypes.indexOf(type);
    if (t < 0) { t = visualTypes.push(type) - 1; }
    visualIndex[at] = v;
    visualTypeIndex[at] = t;
  });
  return {
    count: pairs.length,
    visuals,
    visualTypes,
    visualIndex: visualIndex.buffer,
    visualTypeIndex: visualTypeIndex.buffer,
  };
}

test('an extension is the last suffix, upper-cased', () => {
  assert.strictEqual(visualExtension('OW_MISC_WALL_TORCH_01.3DS'), '.3DS');
  // Retail mixes case within one world: `.pfx` and `.PFX` are one extension.
  assert.strictEqual(visualExtension('FIRE_SPARKS.pfx'), '.PFX');
  // A dotted stem does not make the stem the extension.
  assert.strictEqual(visualExtension('SOME.NAME.MDS'), '.MDS');
});

test('a VOB with no visual has no extension at all', () => {
  // Distinct from a name that happens to carry no dot: an empty visual is what
  // the 15,749 `UNKNOWN` VOBs hold, and the table reports it as its own row.
  assert.strictEqual(visualExtension(''), null);
  assert.strictEqual(visualExtension('NODOT'), null);
});

test('the tally counts each VOB under its extension and its visual class', () => {
  const tally = tallyVisualTypes(fakeIndex([
    ['A.3DS', 'MULTI_RESOLUTION_MESH'],
    ['B.3DS', 'MULTI_RESOLUTION_MESH'],
    ['C.3DS', 'MESH'],
    ['D.TGA', 'DECAL'],
    ['', 'UNKNOWN'],
    ['', 'UNKNOWN'],
  ]));

  assert.strictEqual(tally.total, 6);
  assert.deepStrictEqual(
    Object.fromEntries(tally.byExtension.get('.3DS')),
    { MULTI_RESOLUTION_MESH: 2, MESH: 1 },
  );
  assert.deepStrictEqual(Object.fromEntries(tally.byExtension.get('.TGA')), { DECAL: 1 });
  assert.deepStrictEqual(Object.fromEntries(tally.byExtension.get(null)), { UNKNOWN: 2 });
});

test('a second world accumulates into the same tally', () => {
  const tally = tallyVisualTypes(fakeIndex([['A.3DS', 'MULTI_RESOLUTION_MESH']]));
  tallyVisualTypes(fakeIndex([['B.3DS', 'MESH'], ['C.PFX', 'PARTICLE_EFFECT']]), tally);

  assert.strictEqual(tally.total, 3);
  assert.deepStrictEqual(
    Object.fromEntries(tally.byExtension.get('.3DS')),
    { MULTI_RESOLUTION_MESH: 1, MESH: 1 },
  );
});

test('an extension carrying two visual classes is the ambiguous one', () => {
  // The whole reason `setVobProp.visual` renames in place rather than deriving
  // the class: `.3DS` is `zCProgMeshProto` 20,716 times and `zCMesh` 31 times.
  const tally = tallyVisualTypes(fakeIndex([
    ['A.3DS', 'MULTI_RESOLUTION_MESH'],
    ['B.3DS', 'MESH'],
    ['C.TGA', 'DECAL'],
  ]));
  assert.deepStrictEqual(ambiguousExtensions(tally), ['.3DS']);
});
