'use strict';

// §1 minimal mutations — setVobPosition + insertVob. They exist only to
// feed the in-engine pass (checklist row 10); nothing beyond that is in scope.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zenkit = require('..');

const FIXTURE = path.join(__dirname, 'fixtures', 'minimal.g2.zen');

function load() {
  return zenkit.loadWorld(FIXTURE, 'g2');
}

function dumpOf(handle) {
  return zenkit.normalizeWorld(handle);
}

function vobAt(dump, indexPath) {
  return dump.vobs.find((v) => v.path === indexPath);
}

test('setVobPosition moves the vob and translates its bbox by the same delta', () => {
  const handle = load();
  const before = vobAt(dumpOf(load()), '0/1');
  const delta = [
    100.5 - before.position[0],
    -3 - before.position[1],
    42.25 - before.position[2],
  ];

  zenkit.setVobPosition(handle, '0/1', [100.5, -3, 42.25]);

  const after = vobAt(dumpOf(handle), '0/1');
  assert.deepStrictEqual(after.position, [100.5, -3, 42.25]);
  assert.deepStrictEqual(after.bbox, [
    before.bbox[0] + delta[0],
    before.bbox[1] + delta[1],
    before.bbox[2] + delta[2],
    before.bbox[3] + delta[0],
    before.bbox[4] + delta[1],
    before.bbox[5] + delta[2],
  ]);
});

test('setVobPosition changes only the targeted vob', () => {
  const handle = load();
  zenkit.setVobPosition(handle, '0/1', [1, 2, 3]);

  const mutated = dumpOf(handle);
  const fresh = dumpOf(load());
  for (let i = 0; i < fresh.vobs.length; i++) {
    if (fresh.vobs[i].path === '0/1') continue;
    assert.deepStrictEqual(mutated.vobs[i], fresh.vobs[i]);
  }
  assert.deepStrictEqual(mutated.mesh, fresh.mesh);
  assert.deepStrictEqual(mutated.bsp, fresh.bsp);
  assert.deepStrictEqual(mutated.waynet, fresh.waynet);
});

test('setVobPosition throws on a bad index path', () => {
  const handle = load();
  for (const bad of ['9', '0/9', '0/1/0', 'abc', '', '0//1', '-1']) {
    assert.throws(() => zenkit.setVobPosition(handle, bad, [0, 0, 0]), Error, bad);
  }
});

// setVobRotation — the second mutation (level-editor.md §7). It takes the
// bounding box rather than deriving one, and that is the whole design decision:
// measured across the three retail worlds, a VOB's stored box is the tight
// world AABB of its own visual placed by its own transform (20,472 of 20,502,
// mean slack ~0.1 cm). It is a pure function of (visual, rotation, position),
// so it is recomputed by the caller that has the asset layer and passed in —
// never re-fitted from the box that is already there, which would grow on every
// rotation and make the op non-invertible.

const ROTATION_90_Y = [0, 0, 1, 0, 1, 0, -1, 0, 0];

test('setVobRotation writes the matrix row-major, as vobIndex reads it', () => {
  const handle = load();

  zenkit.setVobRotation(handle, '0/1', ROTATION_90_Y);

  const after = vobAt(dumpOf(handle), '0/1');
  assert.deepStrictEqual(after.rotation, ROTATION_90_Y);
  // The columnar index is the other reader of the same matrix, and it is the
  // one the gizmo and the property grid go through. The two disagreeing is a
  // transpose, which is invisible on any symmetric matrix — including identity.
  // `vobIndex` is the same enumeration in the same order as the dump, which is
  // what lets the flat index be found this way at all.
  const at = dumpOf(handle).vobs.findIndex((v) => v.path === '0/1');
  const rotations = new Float32Array(zenkit.vobIndex(handle).rotations);
  assert.deepStrictEqual([...rotations.slice(at * 9, at * 9 + 9)], ROTATION_90_Y);
});

test('setVobRotation leaves the bbox alone when it is not given one', () => {
  // A VOB whose visual does not resolve — a decal, a .pfx, an unresolved
  // model — has no bounds to recompute from. A guessed box is worse than the
  // stale one: the stale one at least bounded the visual in some pose.
  const handle = load();
  const before = vobAt(dumpOf(load()), '0/1');

  zenkit.setVobRotation(handle, '0/1', ROTATION_90_Y);

  assert.deepStrictEqual(vobAt(dumpOf(handle), '0/1').bbox, before.bbox);
});

test('setVobRotation writes the bbox it is given, verbatim', () => {
  const handle = load();
  const bbox = [-1, -2, -3, 4, 5, 6];

  zenkit.setVobRotation(handle, '0/1', ROTATION_90_Y, bbox);

  assert.deepStrictEqual(vobAt(dumpOf(handle), '0/1').bbox, bbox);
});

test('setVobRotation changes only the targeted vob', () => {
  const handle = load();
  zenkit.setVobRotation(handle, '0/1', ROTATION_90_Y, [-1, -2, -3, 4, 5, 6]);

  const mutated = dumpOf(handle);
  const fresh = dumpOf(load());
  for (let i = 0; i < fresh.vobs.length; i++) {
    if (fresh.vobs[i].path === '0/1') continue;
    assert.deepStrictEqual(mutated.vobs[i], fresh.vobs[i]);
  }
  assert.deepStrictEqual(mutated.mesh, fresh.mesh);
  assert.deepStrictEqual(mutated.bsp, fresh.bsp);
  assert.deepStrictEqual(mutated.waynet, fresh.waynet);
});

test('setVobRotation refuses a bad path, a bad matrix and a bad box', () => {
  const handle = load();
  for (const bad of ['9', '0/9', '0/1/0', 'abc', '', '0//1', '-1']) {
    assert.throws(() => zenkit.setVobRotation(handle, bad, ROTATION_90_Y), Error, bad);
  }
  // Nine numbers, not four and not twelve: the matrix is handed to native code
  // and read positionally.
  for (const bad of [[], [1, 2, 3], new Array(8).fill(0), new Array(10).fill(0), 'x', null]) {
    assert.throws(() => zenkit.setVobRotation(handle, '0/1', bad), Error);
  }
  for (const bad of [[1, 2, 3], new Array(7).fill(0), 'x']) {
    assert.throws(() => zenkit.setVobRotation(handle, '0/1', ROTATION_90_Y, bad), Error);
  }
});

test('setVobRotation survives a save and reload', () => {
  // The point of the op: the matrix has to be in the file, not just in memory.
  const handle = load();
  zenkit.setVobRotation(handle, '0/1', ROTATION_90_Y, [-1, -2, -3, 4, 5, 6]);

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zk-rot-')), 'rotated.zen');
  zenkit.saveWorld(handle, out);
  const reloaded = vobAt(dumpOf(zenkit.loadWorld(out, 'g2')), '0/1');

  assert.deepStrictEqual(reloaded.rotation, ROTATION_90_Y);
  assert.deepStrictEqual(reloaded.bbox, [-1, -2, -3, 4, 5, 6]);
});

// setVobProp — the third mutation (level-editor.md §7). Everything it writes is
// a scalar on `zCVob` itself, which is what separates it from the two before it:
// nothing here is derived, and nothing but the bbox has to be recomputed.
//
// The one rule that is not obvious is about the visual. A visual is its own
// object frame in the archive, with its own class, and the class is **not**
// implied by the file name: measured across the three retail worlds, `.3DS`
// carries `zCProgMeshProto` 20,716 times and `zCMesh` 31 times. So a rename
// writes `visual->name` and leaves the object's class exactly as it found it;
// giving a VOB a visual of a *different* type means replacing that object, which
// is a different operation and needs the type decided rather than guessed.

/** The variant with real visuals on it — the checked-in minimal fixture's VOBs
 *  all carry an empty name and type UNKNOWN, which is what "no visual" is. */
function authored() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-prop-'));
  const file = path.join(dir, 'visuals.zen');
  zenkit._authorFixtureWorld(file, 'binsafe', 'g2', 'mesh-extraction');
  return file;
}

test('setVobProp writes the name, through cp1252', () => {
  const handle = load();
  zenkit.setVobProp(handle, '0/1', { name: 'ITEM_RENAMED_ÄÖÜ_01' });

  assert.strictEqual(vobAt(dumpOf(handle), '0/1').name, 'ITEM_RENAMED_ÄÖÜ_01');
});

test('setVobProp writes every flag it is given, and only those', () => {
  const handle = load();
  const before = vobAt(dumpOf(load()), '0/1').flags;

  zenkit.setVobProp(handle, '0/1', {
    showVisual: true, cdStatic: false, cdDynamic: false,
    vobStatic: true, ambient: true, physicsEnabled: true,
  });

  const after = vobAt(dumpOf(handle), '0/1').flags;
  assert.deepStrictEqual(
    {
      showVisual: after.showVisual, cdStatic: after.cdStatic, cdDynamic: after.cdDynamic,
      vobStatic: after.vobStatic, ambient: after.ambient, physicsEnabled: after.physicsEnabled,
    },
    {
      showVisual: true, cdStatic: false, cdDynamic: false,
      vobStatic: true, ambient: true, physicsEnabled: true,
    },
  );
  // The enum-valued members of the same `flags` object are not this op's
  // business and must come through untouched.
  assert.strictEqual(after.spriteAlignment, before.spriteAlignment);
  assert.strictEqual(after.shadowType, before.shadowType);
  assert.strictEqual(after.animMode, before.animMode);
});

test('setVobProp sets one flag without disturbing its neighbours', () => {
  // A flag word written wholesale would pass the test above and clear every
  // flag the caller did not name here.
  const handle = load();
  const before = vobAt(dumpOf(load()), '0/1').flags;

  zenkit.setVobProp(handle, '0/1', { showVisual: true });

  const after = vobAt(dumpOf(handle), '0/1').flags;
  assert.strictEqual(after.showVisual, true);
  assert.strictEqual(after.cdStatic, before.cdStatic);
  assert.strictEqual(after.cdDynamic, before.cdDynamic);
  assert.strictEqual(after.vobStatic, before.vobStatic);
  assert.strictEqual(after.ambient, before.ambient);
  assert.strictEqual(after.physicsEnabled, before.physicsEnabled);
});

test('setVobProp renames the visual and keeps the visual object it found', () => {
  const file = authored();
  const handle = zenkit.loadWorld(file, 'g2');

  // `1/1` carries EX_HOUSE.3DS as a zCMesh, which is the minority reading of
  // that extension and exactly the case a name-derived type would get wrong.
  zenkit.setVobProp(handle, '1/1', { visual: 'EX_OTHER.3DS' });

  const after = vobAt(dumpOf(handle), '1/1');
  assert.strictEqual(after.visual, 'EX_OTHER.3DS');
  assert.strictEqual(after.visualType, 'MESH');
});

test('setVobProp refuses to name a visual on a VOB that has none', () => {
  // `1/2` has a Visual object with an empty name and type UNKNOWN — which is
  // what 15,749 of the 41,393 retail VOBs look like. Naming one leaves an
  // UNKNOWN visual carrying a real mesh name, which is not a state the engine
  // is ever handed. Giving a VOB a visual is replacing the object, not renaming
  // it, and that operation has to decide the class.
  const handle = zenkit.loadWorld(authored(), 'g2');

  assert.throws(() => zenkit.setVobProp(handle, '1/2', { visual: 'EX_CRATE.3DS' }), /visual/);
  assert.strictEqual(vobAt(dumpOf(handle), '1/2').visual, '');
});

test('setVobProp writes the bbox it is given, and takes one only with a visual', () => {
  // Same contract as setVobRotation: swapping a visual changes the box the
  // engine culls by, the box is a pure function of (visual, rotation,
  // position), and the caller that owns the asset layer is the one that can
  // compute it. A bbox with nothing to justify it is a caller error.
  const handle = zenkit.loadWorld(authored(), 'g2');
  const bbox = [-1, -2, -3, 4, 5, 6];

  zenkit.setVobProp(handle, '1/1', { visual: 'EX_OTHER.3DS', bbox });
  assert.deepStrictEqual(vobAt(dumpOf(handle), '1/1').bbox, bbox);

  assert.throws(() => zenkit.setVobProp(handle, '1/1', { bbox }), /bbox/);

  // And a refused props object writes *nothing*. Validating as it goes would
  // leave the name set and the box not — a state no op describes, so undo could
  // not restore it. The name is checked rather than the box because a box the
  // call refused was never going to be written anyway.
  const named = vobAt(dumpOf(handle), '1/1').name;
  assert.throws(() => zenkit.setVobProp(handle, '1/1', { name: 'HALF_APPLIED', bbox }), /bbox/);
  assert.strictEqual(vobAt(dumpOf(handle), '1/1').name, named);
  assert.throws(
    () => zenkit.setVobProp(handle, '1/2', { name: 'HALF_APPLIED', visual: 'EX_CRATE.3DS' }),
    /visual/,
  );
  assert.notStrictEqual(vobAt(dumpOf(handle), '1/2').name, 'HALF_APPLIED');
});

test('setVobProp leaves the bbox alone when a rename comes without one', () => {
  const handle = zenkit.loadWorld(authored(), 'g2');
  const before = vobAt(dumpOf(handle), '1/1').bbox;

  zenkit.setVobProp(handle, '1/1', { visual: 'EX_OTHER.3DS' });

  assert.deepStrictEqual(vobAt(dumpOf(handle), '1/1').bbox, before);
});

test('setVobProp refuses an unknown key and an empty props object', () => {
  // A misspelled key that silently does nothing is the whole failure mode this
  // op has: every field it writes is invisible in the viewport.
  const handle = load();
  assert.throws(() => zenkit.setVobProp(handle, '0/1', { showvisual: true }), /showvisual/);
  assert.throws(() => zenkit.setVobProp(handle, '0/1', { position: [1, 2, 3] }), /position/);
  assert.throws(() => zenkit.setVobProp(handle, '0/1', {}), /at least one/);
  for (const bad of [null, undefined, 'name', 42, []]) {
    assert.throws(() => zenkit.setVobProp(handle, '0/1', bad), Error);
  }
});

test('setVobProp refuses a wrongly typed value', () => {
  const handle = load();
  assert.throws(() => zenkit.setVobProp(handle, '0/1', { name: 42 }), /name/);
  assert.throws(() => zenkit.setVobProp(handle, '0/1', { showVisual: 'yes' }), /showVisual/);
  assert.throws(() => zenkit.setVobProp(handle, '0/1', { visual: null }), /visual/);
  for (const bad of [[1, 2, 3], new Array(7).fill(0), 'x']) {
    assert.throws(() => zenkit.setVobProp(handle, '0/1', { visual: 'A.3DS', bbox: bad }), Error);
  }
});

// The three remaining `zCVob` base fields the property grid can write
// (level-editor.md §16.17, V1). They are not flags and not the visual: a preset
// name is the Spacer template a VOB was made from, `visualCamAlign` is the
// sprite's behaviour towards the camera, and `bias` is the depth bias handed to
// Direct3D.
//
// **Both numbers are bounded by the packed layout, not by their C++ types.**
// ZenGin writes a VObject either packed — every scalar in one `dataRaw` blob —
// or unpacked, and every world this editor opens is packed. In that layout
// `visualCamAlign` is 2 bits and `bias` is 5 (`VirtualObject.cc`, `bit0`/`bit1`),
// so an `int32_t` bias of 32 is written as 0 and reported as written. Measured
// over the three retail worlds' 41,393 VOBs on 2026-08-28: bias is 0, 1 or 2 and
// alignment is 0-3 — 3 being one past the `SpriteAlignment` enum's three named
// values, which is why the bound is the layout's and not the enum's.

test('setVobProp writes the preset name, the camera alignment and the depth bias', () => {
  const handle = load();

  zenkit.setVobProp(handle, '0/1', {
    presetName: 'NW_STANDART_FIRE_DYNAMIC', visualCamAlign: 2, bias: 3,
  });

  const props = zenkit.getVobProps(handle, '0/1');
  assert.strictEqual(props.presetName, 'NW_STANDART_FIRE_DYNAMIC');
  assert.strictEqual(props.visualCamAlign, 2);
  assert.strictEqual(props.bias, 3);
  // The same field the dump has always carried under the enum's own name.
  assert.strictEqual(vobAt(dumpOf(handle), '0/1').flags.spriteAlignment, 2);
});

test('setVobProp writes the preset name through cp1252, and can clear it', () => {
  // A preset name is a string in the archive and an empty one is how the packed
  // layout says "no preset": clearing it is an edit, not a missing field.
  const handle = load();
  zenkit.setVobProp(handle, '0/1', { presetName: 'FACKEL_FEUER_ÄÖÜ' });
  assert.strictEqual(zenkit.getVobProps(handle, '0/1').presetName, 'FACKEL_FEUER_ÄÖÜ');

  zenkit.setVobProp(handle, '0/1', { presetName: '' });
  assert.strictEqual(zenkit.getVobProps(handle, '0/1').presetName, '');
});

test('setVobProp survives a save and reload for the three base fields', () => {
  // The point of the op: the packed writer has to carry them, and both numbers
  // go into bit fields rather than into words of their own.
  const handle = load();
  zenkit.setVobProp(handle, '0/1', {
    presetName: 'DEFAULTLIGHT_DARKBLUE', visualCamAlign: 1, bias: 31,
  });

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zk-base-')), 'base.zen');
  zenkit.saveWorld(handle, out);
  const props = zenkit.getVobProps(zenkit.loadWorld(out, 'g2'), '0/1');

  assert.strictEqual(props.presetName, 'DEFAULTLIGHT_DARKBLUE');
  assert.strictEqual(props.visualCamAlign, 1);
  assert.strictEqual(props.bias, 31);
});

test('setVobProp refuses a base field the packed layout cannot hold', () => {
  // Silent truncation is the failure this refusal exists for: `bias & 0b11111`
  // turns 32 into 0 and reports success, and every field here is invisible in
  // the viewport.
  const handle = load();
  for (const bad of [32, -1, 1.5, '2', null, [2]]) {
    assert.throws(() => zenkit.setVobProp(handle, '0/1', { bias: bad }), /bias/, String(bad));
  }
  for (const bad of [4, -1, 0.5, 'full', null]) {
    assert.throws(
      () => zenkit.setVobProp(handle, '0/1', { visualCamAlign: bad }), /visualCamAlign/, String(bad),
    );
  }
  assert.throws(() => zenkit.setVobProp(handle, '0/1', { presetName: 7 }), /presetName/);
  // And a refused base field writes nothing beside it.
  const before = zenkit.getVobProps(handle, '0/1');
  assert.throws(
    () => zenkit.setVobProp(handle, '0/1', { presetName: 'KEPT', bias: 99 }), /bias/,
  );
  assert.strictEqual(zenkit.getVobProps(handle, '0/1').presetName, before.presetName);
});

// V2's half of the same section: the shadow flag, and the seven fields a decal
// visual carries (level-editor.md §16.17).
//
// `dynamicShadows` is `(bit0 & 0b11000000) >> 6` in the packed layout, so it is
// bounded 0-3 like `visualCamAlign` and not by `ShadowType`'s two named values.
// Measured over the same 41,393 retail VOBs on 2026-08-28: 41,260 hold 0 and
// 133 hold 1, so nothing in the corpus needs the wider bound — the layout is
// what silently truncates, and that is what the bound is taken from.
//
// **`sleepMode` is not here and cannot be.** `VirtualObject` reads and writes it
// only under `is_save_game()`, so a value set on a world archive never reaches
// the file. It was listed for V2 before the field was traced.

test('setVobProp writes dynamicShadows, and it survives a save and reload', () => {
  const handle = load();

  zenkit.setVobProp(handle, '0/1', { dynamicShadows: 1 });
  assert.strictEqual(zenkit.getVobProps(handle, '0/1').dynamicShadows, 1);
  // The same field the dump has always carried under the enum's own name.
  assert.strictEqual(vobAt(dumpOf(handle), '0/1').flags.shadowType, 1);

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zk-shadow-')), 'shadow.zen');
  zenkit.saveWorld(handle, out);
  assert.strictEqual(
    zenkit.getVobProps(zenkit.loadWorld(out, 'g2'), '0/1').dynamicShadows, 1,
  );
});

test('setVobProp refuses a dynamicShadows the packed layout cannot hold', () => {
  const handle = load();
  for (const bad of [4, -1, 0.5, '1', null, [1]]) {
    assert.throws(
      () => zenkit.setVobProp(handle, '0/1', { dynamicShadows: bad }), /dynamicShadows/,
      String(bad),
    );
  }
});

// The decal fields need a fixture that carries a decal, and the committed
// `minimal.g2.zen` predates `fixture.cc` growing one — so this authors a world
// rather than loading that file. `0/2`, the container, is the decal; every other
// VOB in the fixture has an UNKNOWN visual, which is what the refusal below is
// checked against.
function loadWithDecal() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zk-decal-')), 'decal.zen');
  zenkit._authorFixtureWorld(out, 'binsafe', 'g2');
  return { handle: zenkit.loadWorld(out, 'g2'), dir: path.dirname(out) };
}

test('setVobProp writes all seven decal fields, and they survive a save and reload', () => {
  // The decal is the one visual carrying data of its own, and every field of it
  // goes through the archive as its own entry — `decalAlphaWeight` as a
  // `write_byte`, which is the field A5's lesson was learned on.
  const { handle, dir } = loadWithDecal();

  zenkit.setVobProp(handle, '0/2', {
    decalDimension: [55, 65], decalOffset: [-3, 7], decalTwoSided: false,
    decalAlphaFunc: 6, decalTextureAnimFps: 9.5, decalAlphaWeight: 128,
    decalIgnoreDaylight: true,
  });

  const expected = {
    dimension: [55, 65], offset: [-3, 7], twoSided: false, alphaFunc: 6,
    textureAnimFps: 9.5, alphaWeight: 128, ignoreDaylight: true,
  };
  assert.deepStrictEqual(zenkit.getVobProps(handle, '0/2').decal, expected);

  const out = path.join(dir, 'saved.zen');
  zenkit.saveWorld(handle, out);
  assert.deepStrictEqual(zenkit.getVobProps(zenkit.loadWorld(out, 'g2'), '0/2').decal, expected);
});

test('setVobProp refuses a decal field on a vob whose visual is not one', () => {
  // There is no decal object to write into, and defaulting one would replace the
  // visual — which is `props.visual`'s refusal, for the same reason.
  const { handle } = loadWithDecal();
  assert.throws(
    () => zenkit.setVobProp(handle, '0/1', { decalTwoSided: false }), /decal/,
  );
  // And the VOB beside it is untouched by the refusal.
  assert.strictEqual(zenkit.getVobProps(handle, '0/2').decal.twoSided, true);
});

test('setVobProp refuses a decal value the archive cannot hold', () => {
  const { handle } = loadWithDecal();
  const bad = {
    decalDimension: [[1], [1, 2, 3], 'x', [1, NaN], null],
    decalOffset: [[], [0, 0, 0], 5],
    decalAlphaFunc: [7, -1, 1.5, '2'],
    decalAlphaWeight: [256, -1, 0.5, '80'],
    decalTextureAnimFps: [-1, Infinity, '9'],
    decalTwoSided: [1, 'true', null],
    decalIgnoreDaylight: [0, 'false'],
  };
  for (const [key, values] of Object.entries(bad)) {
    for (const value of values) {
      assert.throws(
        () => zenkit.setVobProp(handle, '0/2', { [key]: value }),
        new RegExp(key), `${key}=${String(value)}`,
      );
    }
  }
  // A refused field writes nothing beside it.
  assert.throws(
    () => zenkit.setVobProp(handle, '0/2', { decalTwoSided: false, decalAlphaWeight: 999 }),
    /decalAlphaWeight/,
  );
  assert.strictEqual(zenkit.getVobProps(handle, '0/2').decal.twoSided, true);
});

test('setVobProp refuses a bad index path', () => {
  const handle = load();
  for (const bad of ['9', '0/9', '0/1/0', 'abc', '', '0//1', '-1']) {
    assert.throws(() => zenkit.setVobProp(handle, bad, { name: 'X' }), Error, bad);
  }
});

test('setVobProp changes only the targeted vob', () => {
  const handle = load();
  zenkit.setVobProp(handle, '0/1', { name: 'ONLY_THIS_ONE', showVisual: true, vobStatic: true });

  const mutated = dumpOf(handle);
  const fresh = dumpOf(load());
  for (let i = 0; i < fresh.vobs.length; i++) {
    if (fresh.vobs[i].path === '0/1') continue;
    assert.deepStrictEqual(mutated.vobs[i], fresh.vobs[i]);
  }
  assert.deepStrictEqual(mutated.mesh, fresh.mesh);
  assert.deepStrictEqual(mutated.bsp, fresh.bsp);
  assert.deepStrictEqual(mutated.waynet, fresh.waynet);
});

test('setVobProp survives a save and reload', () => {
  // The point of the op: the fields have to be in the file, not just in memory.
  const handle = zenkit.loadWorld(authored(), 'g2');
  zenkit.setVobProp(handle, '1/1', {
    name: 'SAVED_ÄÖÜ', visual: 'EX_OTHER.3DS', bbox: [-1, -2, -3, 4, 5, 6],
    showVisual: true, cdDynamic: false, ambient: true,
  });

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zk-prop-rt-')), 'props.zen');
  zenkit.saveWorld(handle, out);
  const reloaded = vobAt(dumpOf(zenkit.loadWorld(out, 'g2')), '1/1');

  assert.strictEqual(reloaded.name, 'SAVED_ÄÖÜ');
  assert.strictEqual(reloaded.visual, 'EX_OTHER.3DS');
  assert.strictEqual(reloaded.visualType, 'MESH');
  assert.deepStrictEqual(reloaded.bbox, [-1, -2, -3, 4, 5, 6]);
  assert.strictEqual(reloaded.flags.showVisual, true);
  assert.strictEqual(reloaded.flags.cdDynamic, false);
  assert.strictEqual(reloaded.flags.ambient, true);
});

// insertVob / deleteVob — the structural pair (level-editor.md §7).
//
// `insertVob` appends a **root** VOB and takes no parent, and that is the whole
// of its design. Every VOB is enumerated depth-first and its flat index is its
// position in that traversal, so a VOB inserted anywhere else renumbers every
// VOB after it — and every op already in the history addresses a VOB by that
// number and by an index path built from it. Appending a root is the one
// position that shifts nothing: it is enumerated last, and it takes the index
// one past the end.
//
// The visual's class is chosen from the extension here, which is the opposite of
// what `setVobProp` may do — and for the opposite reason. Renaming an existing
// visual must preserve whatever class ZenGin wrote, because `.3DS` is
// `zCProgMeshProto` 20,716 times and `zCMesh` 31 times and there is no telling
// which from the name. Authoring a *new* one has no such fact to preserve, and
// the majority reading is the only defensible choice.

test('insertVob appends a root vob and returns its path', () => {
  const handle = load();
  const before = zenkit.worldStats(handle).vobCount;
  const roots = dumpOf(handle).vobs.filter((v) => !v.path.includes('/')).length;

  const at = zenkit.insertVob(handle, null, {
    name: 'PLACED_ÄÖÜ_01',
    visual: 'NW_CRATE.3DS',
    position: [10, 20, 30],
  });

  assert.strictEqual(at, String(roots));
  assert.strictEqual(zenkit.worldStats(handle).vobCount, before + 1);

  const placed = vobAt(dumpOf(handle), at);
  assert.strictEqual(placed.class, 'zCVob');
  assert.strictEqual(placed.name, 'PLACED_ÄÖÜ_01');
  assert.strictEqual(placed.visual, 'NW_CRATE.3DS');
  assert.deepStrictEqual(placed.position, [10, 20, 30]);
  assert.deepStrictEqual(placed.rotation, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.strictEqual(placed.flags.showVisual, true);
});

test('a root insert takes the index one past the end, renumbering nothing', () => {
  // Why a null parent is worth keeping as its own case rather than a degenerate
  // parent. A VOB appended to the roots is enumerated last; one appended
  // anywhere else is enumerated before some of the VOBs that already exist, and
  // every one of those changes its flat index — which every op in the history
  // carries. The test below is the other half of that sentence.
  const handle = load();
  const before = dumpOf(load()).vobs;

  zenkit.insertVob(handle, null, { visual: 'NW_CRATE.3DS', position: [0, 0, 0] });

  const after = dumpOf(handle).vobs;
  assert.strictEqual(after.length, before.length + 1);
  for (let i = 0; i < before.length; i++) {
    assert.deepStrictEqual(after[i], before[i], `vob ${i} moved or changed`);
  }
});

test('insertVob appends under a parent and answers with the path it landed at', () => {
  const handle = load();
  const children = vobAt(dumpOf(handle), '0').childCount;

  const at = zenkit.insertVob(handle, '0', {
    name: 'UNDER_ROOT_01', visual: 'NW_CRATE.3DS', position: [10, 20, 30],
  });

  assert.strictEqual(at, `0/${children}`);
  const placed = vobAt(dumpOf(handle), at);
  assert.strictEqual(placed.name, 'UNDER_ROOT_01');
  assert.deepStrictEqual(placed.position, [10, 20, 30]);
  assert.strictEqual(vobAt(dumpOf(handle), '0').childCount, children + 1);
});

test('insertVob under a parent renumbers every VOB after that parent’s subtree', () => {
  // The claim the doc comment makes, measured rather than asserted about the
  // implementation. A root appended first sits after the fixture's whole tree;
  // inserting under `0` puts a VOB in the middle of the enumeration and the
  // root moves up one — which is exactly why an insert with a parent has to be
  // alone in its batch.
  const handle = load();
  const root = zenkit.insertVob(handle, null, { name: 'LAST_ROOT', position: [0, 0, 0] });
  const was = dumpOf(handle).vobs.findIndex((v) => v.path === root);

  zenkit.insertVob(handle, '0', { name: 'MIDDLE', position: [0, 0, 0] });

  const after = dumpOf(handle).vobs;
  assert.strictEqual(after.findIndex((v) => v.path === root), was + 1);
  // And its path is untouched: a sibling list it is not in cannot renumber it.
  assert.strictEqual(after.find((v) => v.name === 'LAST_ROOT').path, root);
});

test('deleteVob undoes a parented insert exactly, through the writer', () => {
  // The pair is what makes the op invertible, and the parented half of it is
  // the one that could leave a hole in a *child* list rather than in the roots —
  // which `CollectVobs` and `CountVobs` both skip, so it reads identical in
  // every dump and only the writer ever sees it.
  const handle = load();
  const before = dumpOf(load());

  const at = zenkit.insertVob(handle, '0', {
    name: 'TEMPORARY_CHILD', visual: 'A.3DS', position: [7, 8, 9],
  });
  assert.strictEqual(at, '0/3');
  zenkit.deleteVob(handle, at);

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zk-child-')), 'deleted.zen');
  zenkit.saveWorld(handle, out);
  const reloaded = dumpOf(zenkit.loadWorld(out, 'g2'));
  assert.strictEqual(reloaded.vobs.length, before.vobs.length);
  for (let i = 0; i < before.vobs.length; i++) {
    assert.strictEqual(reloaded.vobs[i].path, before.vobs[i].path);
    assert.strictEqual(reloaded.vobs[i].name, before.vobs[i].name);
  }
});

test('insertVob refuses a parentPath that names no VOB, before it makes one', () => {
  const handle = load();
  const before = zenkit.worldStats(handle).vobCount;

  for (const bad of ['9', '0/9', '0/0/0/0', 'abc', '', '0//1', '-1']) {
    assert.throws(
      () => zenkit.insertVob(handle, bad, { position: [0, 0, 0] }), Error, bad,
    );
  }
  assert.strictEqual(zenkit.worldStats(handle).vobCount, before);
});

test('insertVob picks the visual class from the extension, by the measured majority', () => {
  const handle = load();
  for (const [visual, type] of [
    ['A.3DS', 'MULTI_RESOLUTION_MESH'],
    ['B.ASC', 'MODEL'],
    ['C.MDS', 'MODEL'],
    ['D.MMS', 'MORPH_MESH'],
    ['E.PFX', 'PARTICLE_EFFECT'],
  ]) {
    const at = zenkit.insertVob(handle, null, { visual, position: [0, 0, 0] });
    assert.strictEqual(vobAt(dumpOf(handle), at).visualType, type, visual);
  }
});

test('insertVob refuses a visual it cannot author', () => {
  const handle = load();
  // A decal carries its own dimension, offset, alpha function and weight; a
  // zCDecal authored without them is a visual ZenGin never wrote. Refusing is
  // the honest answer until this API takes them.
  assert.throws(() => zenkit.insertVob(handle, null, { visual: 'X.TGA', position: [0, 0, 0] }), /decal/i);
  for (const bad of ['X.MRM', 'X', 'X.WAV', '.3DS.']) {
    assert.throws(() => zenkit.insertVob(handle, null, { visual: bad, position: [0, 0, 0] }), Error, bad);
  }
});

test('insertVob without a visual makes a VOB with none, like an inserted item', () => {
  const handle = load();
  const at = zenkit.insertVob(handle, null, { name: 'MARKER', position: [1, 2, 3] });

  const placed = vobAt(dumpOf(handle), at);
  assert.strictEqual(placed.visual, null);
  // Nothing to draw, so nothing claims otherwise.
  assert.strictEqual(placed.flags.showVisual, false);
});

test('insertVob writes the rotation, box and flags it is given', () => {
  const handle = load();
  const at = zenkit.insertVob(handle, null, {
    visual: 'A.3DS',
    position: [0, 0, 0],
    rotation: ROTATION_90_Y,
    bbox: [-1, -2, -3, 4, 5, 6],
    vobStatic: true,
    cdDynamic: false,
  });

  const placed = vobAt(dumpOf(handle), at);
  assert.deepStrictEqual(placed.rotation, ROTATION_90_Y);
  assert.deepStrictEqual(placed.bbox, [-1, -2, -3, 4, 5, 6]);
  assert.strictEqual(placed.flags.vobStatic, true);
  assert.strictEqual(placed.flags.cdDynamic, false);
});

test('insertVob refuses a bad position, matrix, box or unknown key', () => {
  const handle = load();
  assert.throws(() => zenkit.insertVob(handle, null, {}), /position/);
  assert.throws(() => zenkit.insertVob(handle, null, { position: [1, 2] }), /position/);
  assert.throws(() => zenkit.insertVob(handle, null, { position: [0, 0, 0], rotation: [1, 2, 3] }), /rotation/);
  assert.throws(() => zenkit.insertVob(handle, null, { position: [0, 0, 0], bbox: [1, 2, 3] }), /bbox/);
  assert.throws(() => zenkit.insertVob(handle, null, { position: [0, 0, 0], parent: '0' }), /parent/);
  assert.throws(() => zenkit.insertVob(handle, null, null), Error);
});

test('deleteVob removes the vob and its whole subtree', () => {
  const handle = load();
  const before = zenkit.worldStats(handle).vobCount;
  // Every VOB under `0`, at any depth — the fixture's root carries three
  // children and one grandchild, so counting only the direct children would
  // under-count the subtree.
  const descendants = dumpOf(handle).vobs.filter((v) => v.path.startsWith('0/')).length;

  zenkit.deleteVob(handle, '0');

  assert.strictEqual(zenkit.worldStats(handle).vobCount, before - (1 + descendants));
  assert.strictEqual(dumpOf(handle).vobs.find((v) => v.path === '0/0'), undefined);
});

test('deleteVob undoes an insert exactly, leaving the world as it was', () => {
  // The pair is what makes the op invertible: an added VOB is described
  // completely by what created it, so undo deletes it and redo makes it again.
  const handle = load();
  const before = dumpOf(load());

  const at = zenkit.insertVob(handle, null, {
    name: 'TEMPORARY', visual: 'A.3DS', position: [7, 8, 9],
  });
  zenkit.deleteVob(handle, at);

  const after = dumpOf(handle);
  assert.strictEqual(after.vobs.length, before.vobs.length);
  for (let i = 0; i < before.vobs.length; i++) {
    assert.deepStrictEqual(after.vobs[i], before.vobs[i]);
  }
  assert.deepStrictEqual(after.mesh, before.mesh);
  assert.deepStrictEqual(after.bsp, before.bsp);
  assert.deepStrictEqual(after.waynet, before.waynet);

  // And through the writer, which is the half the dump cannot see. Both
  // `CollectVobs` and `CountVobs` skip a null child, so a delete that left the
  // slot behind as a hole rather than erasing it reads *identical* in every
  // assertion above — and hands the writer a child list with a gap in it.
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zk-del-')), 'deleted.zen');
  zenkit.saveWorld(handle, out);
  const reloaded = dumpOf(zenkit.loadWorld(out, 'g2'));
  assert.strictEqual(reloaded.vobs.length, before.vobs.length);
  for (let i = 0; i < before.vobs.length; i++) {
    assert.deepStrictEqual(reloaded.vobs[i].path, before.vobs[i].path);
    assert.deepStrictEqual(reloaded.vobs[i].name, before.vobs[i].name);
  }
});

test('deleteVob throws on a bad index path', () => {
  const handle = load();
  for (const bad of ['9', '0/9', '0/1/0', 'abc', '', '0//1', '-1']) {
    assert.throws(() => zenkit.deleteVob(handle, bad), Error, bad);
  }
});

test('an inserted vob survives a save and reload', () => {
  const handle = load();
  const at = zenkit.insertVob(handle, null, {
    name: 'PLACED_SAVED', visual: 'NW_CRATE.3DS',
    position: [11, 22, 33], rotation: ROTATION_90_Y, bbox: [-1, -2, -3, 4, 5, 6],
  });

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zk-add-')), 'added.zen');
  zenkit.saveWorld(handle, out);

  const reloaded = vobAt(dumpOf(zenkit.loadWorld(out, 'g2')), at);
  assert.ok(reloaded, 'the inserted vob is not in the saved world');
  assert.strictEqual(reloaded.class, 'zCVob');
  assert.strictEqual(reloaded.name, 'PLACED_SAVED');
  assert.strictEqual(reloaded.visual, 'NW_CRATE.3DS');
  assert.strictEqual(reloaded.visualType, 'MULTI_RESOLUTION_MESH');
  assert.deepStrictEqual(reloaded.position, [11, 22, 33]);
  assert.deepStrictEqual(reloaded.rotation, ROTATION_90_Y);
});

// The class dispatch (level-editor.md §16.15, I1). `insertVob` authors the
// class it is told to, and `oCItem` is the first: the class is the object's C++
// type rather than a field, so a bare `zCVob` cannot be turned into one
// afterwards — `setVobClassProp` switches on the type the object really has.
// Each class needs its own field-complete construction, because ZenKit's structs
// have uninitialized fields; `class` is therefore a closed set and not a tag.

test('insertVob authors an oCItem when the class names one, and returns its path', () => {
  const handle = load();
  const statsBefore = zenkit.worldStats(handle);

  const itemPath = zenkit.insertVob(handle, '0', {
    class: 'oCItem',
    name: 'ITEM_TEST_ÄÖÜ_01',
    instance: 'ITFO_APPLE',
    position: [12.5, 3, -7],
  });
  assert.strictEqual(itemPath, '0/3');

  const statsAfter = zenkit.worldStats(handle);
  assert.strictEqual(statsAfter.vobCount, statsBefore.vobCount + 1);

  const item = vobAt(dumpOf(handle), '0/3');
  assert.ok(item, 'inserted vob missing from the dump');
  assert.strictEqual(item.class, 'oCItem');
  assert.strictEqual(item.name, 'ITEM_TEST_ÄÖÜ_01');
  assert.strictEqual(item.props.instance, 'ITFO_APPLE');
  assert.deepStrictEqual(item.position, [12.5, 3, -7]);
  assert.strictEqual(item.flags.showVisual, true);
  // The engine derives item visuals from the script instance.
  assert.strictEqual(item.visual, null);
  // Small bbox around the position, min < position < max on every axis.
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(item.bbox[axis] < item.position[axis]);
    assert.ok(item.bbox[axis + 3] > item.position[axis]);
  }
});

test('an oCItem with a null parent appends a new root vob', () => {
  const handle = load();
  const itemPath = zenkit.insertVob(handle, null, {
    class: 'oCItem',
    name: 'ITEM_ROOT_01',
    instance: 'ITMI_GOLD',
    position: [0, 0, 0],
  });
  assert.strictEqual(itemPath, '1');
  const item = vobAt(dumpOf(handle), '1');
  assert.strictEqual(item.class, 'oCItem');
  assert.strictEqual(item.props.instance, 'ITMI_GOLD');
});

test('an oCItem throws on a bad parent path', () => {
  const handle = load();
  for (const bad of ['9', '0/7', 'x', '']) {
    assert.throws(
      () =>
        zenkit.insertVob(handle, bad, {
          class: 'oCItem',
          name: 'ITEM_X',
          instance: 'ITMI_GOLD',
          position: [0, 0, 0],
        }),
      Error,
      bad
    );
  }
});

test('insertVob refuses a class it has no construction for', () => {
  const handle = load();
  for (const bad of ['oCMobDoor', 'zCTriggerScript', 'oCitem', '', 7]) {
    assert.throws(
      () => zenkit.insertVob(handle, null, { class: bad, position: [0, 0, 0] }),
      Error,
      String(bad)
    );
  }
  // Nothing was authored by any of the refusals.
  assert.strictEqual(zenkit.worldStats(handle).vobCount, zenkit.worldStats(load()).vobCount);
});

test('an instance belongs to the class that has one, in either direction', () => {
  const handle = load();
  // A zCVob has no instance field, so naming one is a mistake about the class
  // rather than a value to drop silently — and the default class is zCVob.
  assert.throws(
    () => zenkit.insertVob(handle, null, { instance: 'ITFO_APPLE', position: [0, 0, 0] }),
    /instance/
  );
  // An oCItem without one would spawn an item the engine cannot resolve.
  assert.throws(
    () => zenkit.insertVob(handle, null, { class: 'oCItem', position: [0, 0, 0] }),
    /instance/
  );
});

// The lights and the sounds (level-editor.md §16.15, I2). Each construction is
// field-complete against `fixture.cc`'s idiom, and each default is the retail
// majority measured over NewWorld/OldWorld/AddonWorld rather than ZenKit's
// struct default — three of which retail never writes at all.

test('insertVob authors a dynamic zCVobLight, on the measured retail defaults', () => {
  const handle = load();
  const at = zenkit.insertVob(handle, null, {
    class: 'zCVobLight', name: 'PLACED_LIGHT', position: [1, 2, 3],
  });

  const light = vobAt(dumpOf(handle), at);
  assert.strictEqual(light.class, 'zCVobLight');
  assert.strictEqual(light.name, 'PLACED_LIGHT');
  // POINT, not ZenKit's SPOT: all 4,649 retail lights are POINT.
  assert.strictEqual(light.props.lightType, 0);
  // Dynamic and on — a static light is baked by the world's lighting compile,
  // so one added afterwards lights nothing, and `isStatic` is not editable.
  assert.strictEqual(light.props.isStatic, false);
  assert.strictEqual(light.props.on, true);
  assert.strictEqual(light.props.range, 400);
  assert.deepStrictEqual(light.props.color, [255, 255, 255, 255]);
  assert.strictEqual(light.props.quality, 2);
  assert.strictEqual(light.props.coneAngle, 0);
  // Every one of the 1,111 retail dynamic lights holds `false`, against
  // ZenKit's `true`.
  assert.strictEqual(light.props.canMove, false);
  // Self-contained: no preset template, no lensflare, no animation.
  assert.strictEqual(light.props.preset, '');
  assert.strictEqual(light.props.lensflareFx, '');
  assert.deepStrictEqual(light.props.rangeAnimationScale, []);
  assert.strictEqual(light.props.rangeAnimationFps, 0);
  assert.deepStrictEqual(light.props.colorAnimationList, []);
  assert.strictEqual(light.props.colorAnimationFps, 0);
});

test('insertVob authors a zCVobSound that loops, like the retail majority', () => {
  const handle = load();
  const at = zenkit.insertVob(handle, null, {
    class: 'zCVobSound', name: 'PLACED_SOUND', position: [4, 5, 6],
  });

  const sound = vobAt(dumpOf(handle), at);
  assert.strictEqual(sound.class, 'zCVobSound');
  // LOOP, not ZenKit's ONCE: 1,077 of retail's 1,237 sounds loop, and `mode` is
  // an enum the catalogue keeps out — so this choice is the user's for good.
  assert.strictEqual(sound.props.mode, 0);
  assert.strictEqual(sound.props.volume, 100);
  assert.strictEqual(sound.props.radius, 1500);
  assert.strictEqual(sound.props.initiallyPlaying, true);
  assert.strictEqual(sound.props.ambient3d, false);
  // The retail majority, against ZenKit's `true`.
  assert.strictEqual(sound.props.obstruction, false);
  assert.strictEqual(sound.props.coneAngle, 0);
  assert.strictEqual(sound.props.volumeType, 0);
  // The one field only the caller can fill, and `setVobClassProp` is where.
  assert.strictEqual(sound.props.soundName, '');
  assert.strictEqual(sound.props.randomDelay, 0);
  assert.strictEqual(sound.props.randomDelayVar, 0);
});

test('a zCVobSoundDaytime carries the base sound fields and its own three', () => {
  const handle = load();
  const at = zenkit.insertVob(handle, null, {
    class: 'zCVobSoundDaytime', name: 'PLACED_DAYTIME', position: [7, 8, 9],
  });

  const sound = vobAt(dumpOf(handle), at);
  assert.strictEqual(sound.class, 'zCVobSoundDaytime');
  // The derived class writes the base half too — the fixture's own daytime VOB
  // is there to prove the same thing for `setVobClassProp`.
  assert.strictEqual(sound.props.mode, 0);
  assert.strictEqual(sound.props.volume, 100);
  assert.strictEqual(sound.props.radius, 1500);
  // The retail medians of the 84 daytime sounds: awake at 6, quiet at 20.
  assert.strictEqual(sound.props.startTime, 6);
  assert.strictEqual(sound.props.endTime, 20);
  assert.strictEqual(sound.props.soundName2, '');
});

test('a light and a sound take no instance, and need none', () => {
  const handle = load();
  for (const cls of ['zCVobLight', 'zCVobSound', 'zCVobSoundDaytime']) {
    assert.throws(
      () => zenkit.insertVob(handle, null, { class: cls, instance: 'ITFO_APPLE', position: [0, 0, 0] }),
      /instance/,
      cls
    );
  }
});

test('an authored light and sound survive a save and reload', () => {
  // The writer is the half the dump cannot see: a construction that left a
  // field indeterminate round-trips as whatever was on the stack.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-i2-'));
  try {
    const handle = load();
    const lightAt = zenkit.insertVob(handle, null, { class: 'zCVobLight', position: [1, 2, 3] });
    const soundAt = zenkit.insertVob(handle, null, {
      class: 'zCVobSoundDaytime', position: [4, 5, 6],
    });
    const before = dumpOf(handle);

    const out = path.join(dir, 'authored.zen');
    zenkit.saveWorld(handle, out);
    const reloaded = dumpOf(zenkit.loadWorld(out, 'g2'));

    // Everything but the visual, which no class here has: in memory it is a null
    // pointer and a saved world spells the absence as an empty visual object, so
    // the two are the same absence written two ways.
    for (const at of [lightAt, soundAt]) {
      const was = vobAt(before, at);
      const is = vobAt(reloaded, at);
      assert.strictEqual(is.class, was.class);
      assert.deepStrictEqual(is.props, was.props);
      assert.deepStrictEqual(is.flags, was.flags);
      assert.deepStrictEqual(is.position, was.position);
      assert.deepStrictEqual(is.bbox, was.bbox);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The trigger family (level-editor.md §16.15, I3). Five of the seven derive
// from `VTrigger` and share its twelve fields; two derive from nothing but
// `zCVob`. Every default below is retail's own majority over
// NewWorld/OldWorld/AddonWorld (2026-08-28), and the four flags the family
// *disagrees* about are set per class rather than shared — a mover is touched
// by nothing and a trigger is touched by almost everything.

// The props every VOB carries whatever its class; a construction is not
// answerable for these, `zCVob`'s own half is.
const BASE_PROP_KEYS = [
  'presetName', 'bias', 'visualCamAlign', 'dynamicShadows', 'animStrength',
  'farClipScale', 'sleepMode', 'nextOnTimer', 'rigidBody', 'eventManager', 'ai', 'decal',
];

// The eight the whole family agrees on, across all 294 retail VOBs of these
// classes. `target` and `vobTarget` are empty because there is no name to
// invent — and, the catalogue holding no field for either, a placed trigger
// fires at nothing until that changes.
const TRIGGER_BASE = {
  target: '',
  startEnabled: true,
  reactToOnTrigger: true,
  reactToOnDamage: false,
  respondToPc: true,
  vobTarget: '',
  maxActivationCount: -1,
  retriggerDelaySec: 0,
  damageThreshold: 0,
  fireDelaySec: 0,
};

// class -> the props the construction is answerable for, base fields excluded.
const I3_EXPECTED = {
  // 47 retail zCTriggers: touched (35), not sending an untrigger (36),
  // responding to objects (26) and to NPCs (31).
  zCTrigger: {
    ...TRIGGER_BASE,
    sendUntrigger: false, reactToOnTouch: true, respondToObject: true, respondToNpc: true,
  },
  // 44 retail lists: reached by an event and not by a touch (39). `mode` is ALL
  // on every one of them, and it is an enum, so a placed list keeps it.
  zCTriggerList: {
    ...TRIGGER_BASE,
    sendUntrigger: false, reactToOnTouch: false, respondToObject: true, respondToNpc: true,
    mode: 0, targets: [],
  },
  // 46 retail script triggers: they send an untrigger (43) and they are for the
  // player - not for objects (29) and not for NPCs (25).
  oCTriggerScript: {
    ...TRIGGER_BASE,
    sendUntrigger: true, reactToOnTouch: true, respondToObject: false, respondToNpc: false,
    function: '',
  },
  // All 7 retail level changers are touched by the player and by nothing else.
  oCTriggerChangeLevel: {
    ...TRIGGER_BASE,
    sendUntrigger: true, reactToOnTouch: true, respondToObject: false, respondToNpc: false,
    levelName: '', startVob: '',
  },
  // 150 retail movers: fired at, not touched (148), and `locked` is false on
  // every single one against ZenKit's `true`. Two seconds open is the majority
  // (129). `speed`, `lerpMode` and `speedMode` are written only when a mover
  // has keyframes, which this cannot author — so `lerpMode` is ZenKit's CURVE
  // (1) rather than retail's LINEAR majority: the field never reaches the
  // archive, and a reload would hand back CURVE whatever was authored.
  zCMover: {
    ...TRIGGER_BASE,
    sendUntrigger: true, reactToOnTouch: false, respondToObject: true, respondToNpc: true,
    behavior: 0, touchBlockerDamage: 0, stayOpenTimeSec: 2, locked: false,
    autoLink: false, autoRotate: false, speed: 0, lerpMode: 1, speedMode: 0, keyframes: [],
    sfxOpenStart: '', sfxOpenEnd: '', sfxTransitioning: '', sfxCloseStart: '',
    sfxCloseEnd: '', sfxLock: '', sfxUnlock: '', sfxUseLocked: '',
  },
  // 7 retail code masters: unordered (6) and not cancelled by an untrigger (7).
  zCCodeMaster: {
    target: '', ordered: false, firstFalseIsFailure: false, failureTarget: '',
    untriggeredCancels: false, slaves: [],
  },
  // 26 retail filters. Both actions are TRIGGER on the plurality (8 of 26
  // each), and both are enums the catalogue holds no field for - so, like a
  // sound's `mode`, what is chosen here is what a placed filter keeps.
  zCMessageFilter: { target: '', onTrigger: 1, onUntrigger: 1 },
};

for (const [className, expected] of Object.entries(I3_EXPECTED)) {
  test(`insertVob authors a ${className} on retail's own majority`, () => {
    const handle = load();
    const at = zenkit.insertVob(handle, null, {
      class: className, name: `PLACED_${className}`, position: [1, 2, 3],
    });

    const vob = vobAt(dumpOf(handle), at);
    assert.strictEqual(vob.class, className);
    assert.strictEqual(vob.name, `PLACED_${className}`);
    for (const [key, value] of Object.entries(expected)) {
      assert.deepStrictEqual(vob.props[key], value, `${className}.${key}`);
    }
    // The construction is answerable for *every* field of the class and not
    // only the ones named above: a key the dump reports and this table forgets
    // is a field left to whatever the struct's memory happened to hold.
    const unclaimed = Object.keys(vob.props)
      .filter((key) => !(key in expected) && !BASE_PROP_KEYS.includes(key));
    assert.deepStrictEqual(unclaimed, [], className);
  });
}

test('no member of the trigger family takes an instance', () => {
  const handle = load();
  for (const className of Object.keys(I3_EXPECTED)) {
    assert.throws(
      () => zenkit.insertVob(handle, null, {
        class: className, instance: 'ITFO_APPLE', position: [0, 0, 0],
      }),
      /instance/,
      className
    );
  }
});

test('every authored trigger survives a save and reload', () => {
  // The writer is the half the dump cannot see: a field the construction left
  // indeterminate round-trips as whatever was on the stack, and a trigger has
  // twelve of them before its own class starts.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-i3-'));
  try {
    const handle = load();
    const placed = Object.keys(I3_EXPECTED).map((className) => [
      className,
      zenkit.insertVob(handle, null, { class: className, position: [1, 2, 3] }),
    ]);
    const before = dumpOf(handle);

    const out = path.join(dir, 'triggers.zen');
    zenkit.saveWorld(handle, out);
    const reloaded = dumpOf(zenkit.loadWorld(out, 'g2'));

    for (const [className, at] of placed) {
      const was = vobAt(before, at);
      const is = vobAt(reloaded, at);
      assert.strictEqual(is.class, className);
      assert.deepStrictEqual(is.props, was.props, className);
      assert.deepStrictEqual(is.flags, was.flags, className);
      assert.deepStrictEqual(is.position, was.position, className);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('insertVob still authors a zCVob when no class is named', () => {
  const handle = load();
  const at = zenkit.insertVob(handle, null, { name: 'DEFAULT_CLASS', position: [0, 0, 0] });
  assert.strictEqual(vobAt(dumpOf(handle), at).class, 'zCVob');
});

test('mutations survive a save/reload round trip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-node-mut-'));
  try {
    const handle = load();
    zenkit.setVobPosition(handle, '0/1', [77, 88, 99]);
    zenkit.insertVob(handle, '0', {
      class: 'oCItem',
      name: 'ITEM_ROUNDTRIP_01',
      instance: 'ITFO_APPLE',
      position: [5, 6, 7],
    });

    const out = path.join(dir, 'mutated.zen');
    zenkit.saveWorld(handle, out);

    const reloaded = dumpOf(zenkit.loadWorld(out, 'g2'));
    assert.deepStrictEqual(vobAt(reloaded, '0/1').position, [77, 88, 99]);
    const item = vobAt(reloaded, '0/3');
    assert.strictEqual(item.class, 'oCItem');
    assert.strictEqual(item.name, 'ITEM_ROUNDTRIP_01');
    assert.strictEqual(item.props.instance, 'ITFO_APPLE');
    assert.deepStrictEqual(item.position, [5, 6, 7]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// reparentVob — the third structural op (level-editor.md §7).
//
// It renumbers, and unlike `insertVob` it has no position that does not: moving
// a VOB anywhere changes the depth-first traversal for everything between the
// two slots. What makes it safe is not a property of the call but of the
// history that uses it — `WorldService` clears the redo stack on every new edit
// and replays batches strictly LIFO, so an op is only ever applied to a world in
// the enumeration it was recorded against. The renderer's projection is the part
// that cannot follow, and it is re-read whole, exactly as an insert re-reads it.
//
// It takes the destination slot rather than appending, because that is what
// makes it invertible: put back at the end of the old parent's children is a
// different world from the one it came from.

test('reparentVob moves a vob into another parent at the slot it was given', () => {
  const handle = load();
  const before = zenkit.worldStats(handle).vobCount;

  // The chest becomes a child of the campfire spot.
  const landed = zenkit.reparentVob(handle, '0/2', '0/0', 0);

  assert.strictEqual(landed, '0/0/0');
  assert.strictEqual(zenkit.worldStats(handle).vobCount, before);

  const dump = dumpOf(handle);
  assert.strictEqual(vobAt(dump, '0/0/0').name, 'CHEST_01');
  // And it is gone from where it was: the fixture's root keeps two children.
  assert.strictEqual(vobAt(dump, '0').childCount, 2);
  assert.strictEqual(dump.vobs.filter((v) => v.name === 'CHEST_01').length, 1);
});

test('reparentVob carries the whole subtree with it', () => {
  const handle = load();
  // Give the chest a child first, so there is a subtree to lose.
  const extra = zenkit.insertVob(handle, null, { name: 'CARGO', position: [1, 2, 3] });
  zenkit.reparentVob(handle, extra, '0/2', 0);
  assert.strictEqual(vobAt(dumpOf(handle), '0/2/0').name, 'CARGO');

  zenkit.reparentVob(handle, '0/2', '0/0', 0);

  const dump = dumpOf(handle);
  assert.strictEqual(vobAt(dump, '0/0/0').name, 'CHEST_01');
  assert.strictEqual(vobAt(dump, '0/0/0/0').name, 'CARGO');
});

test('reparentVob to a root slot takes a null parent', () => {
  const handle = load();
  const landed = zenkit.reparentVob(handle, '0/1', null, 0);

  assert.strictEqual(landed, '0');
  const dump = dumpOf(handle);
  assert.strictEqual(vobAt(dump, '0').name, 'ITEM_SWORD_01');
  // The old root moved down one slot, which is exactly the renumbering this op
  // cannot avoid and the reason it is structural.
  assert.strictEqual(vobAt(dump, '1').name, 'FIXTURE_ROOT');
});

test('reparentVob puts a vob back exactly, leaving the world as it was', () => {
  // The property the op model needs: undo is a reparent in the other direction,
  // so the pair has to compose to nothing — including the slot, which is why
  // this call takes one.
  const handle = load();
  const before = dumpOf(load());

  zenkit.reparentVob(handle, '0/2', '0/0', 0);
  zenkit.reparentVob(handle, '0/0/0', '0', 2);

  const after = dumpOf(handle);
  assert.strictEqual(after.vobs.length, before.vobs.length);
  for (let i = 0; i < before.vobs.length; i++) {
    assert.deepStrictEqual(after.vobs[i], before.vobs[i], `vob ${i} differs`);
  }

  // Through the writer as well, for the same reason the delete pair checks it:
  // a child list left with a hole in it reads identical in every dump.
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zk-rep-')), 'reparented.zen');
  zenkit.saveWorld(handle, out);
  const reloaded = dumpOf(zenkit.loadWorld(out, 'g2'));
  assert.strictEqual(reloaded.vobs.length, before.vobs.length);
  for (let i = 0; i < before.vobs.length; i++) {
    assert.strictEqual(reloaded.vobs[i].path, before.vobs[i].path);
    assert.strictEqual(reloaded.vobs[i].name, before.vobs[i].name);
  }
});

test('reparentVob refuses to put a vob inside itself', () => {
  // The one input that would silently destroy VOBs: a subtree moved into its own
  // descendant is unreachable from the roots, so it is not enumerated, not
  // counted and not written — it simply disappears at the next save.
  const handle = load();
  assert.throws(() => zenkit.reparentVob(handle, '0', '0/1', 0), /own descendant|itself/i);
  assert.throws(() => zenkit.reparentVob(handle, '0', '0', 0), /own descendant|itself/i);

  // And nothing was moved by the attempt.
  const dump = dumpOf(handle);
  assert.strictEqual(vobAt(dump, '0').name, 'FIXTURE_ROOT');
  assert.strictEqual(vobAt(dump, '0/1').name, 'ITEM_SWORD_01');
});

test('reparentVob accounts for the slot the removal itself vacates', () => {
  // Source and destination in the same list: moving 0/0 to slot 2 of the same
  // parent has to mean the slot *after the removal*, or the call is off by one
  // in one direction and out of range in the other.
  const handle = load();
  const landed = zenkit.reparentVob(handle, '0/0', '0', 2);

  assert.strictEqual(landed, '0/2');
  const dump = dumpOf(handle);
  assert.strictEqual(vobAt(dump, '0/0').name, 'ITEM_SWORD_01');
  assert.strictEqual(vobAt(dump, '0/1').name, 'CHEST_01');
  assert.strictEqual(vobAt(dump, '0/2').name, 'FP_CAMPFIRE_ÄÖÜ_01');
});

test('reparentVob throws on a bad path, and on a slot out of range', () => {
  const handle = load();
  for (const bad of ['9', '0/9', 'abc', '', '0//1', '-1']) {
    assert.throws(() => zenkit.reparentVob(handle, bad, '0', 0), Error, bad);
    assert.throws(() => zenkit.reparentVob(handle, '0/1', bad, 0), Error, bad);
  }
  // One past the end of the destination list is an append and is allowed; two is
  // a gap, and a gap in a child list is what the writer cannot represent.
  assert.throws(() => zenkit.reparentVob(handle, '0/1', '0', 9), /slot|range/i);
  assert.throws(() => zenkit.reparentVob(handle, '0/1', '0', -1), /slot|range/i);
});

test('reparentVob follows a destination that the removal itself renumbers', () => {
  // The case the other tests miss, and the one the adjustment exists for: the
  // destination is a *later sibling* of the vob being moved, so removing the vob
  // shifts the destination down one slot before the insert happens. Written
  // after noticing no test reached that branch — it passes on the wrong code by
  // moving the vob into whatever ends up at the caller's original path.
  const handle = load();

  // The campfire spot (0/0) moves into the chest (0/2). Once 0/0 is gone the
  // chest is at 0/1, and that is where the vob has to land.
  const landed = zenkit.reparentVob(handle, '0/0', '0/2', 0);

  assert.strictEqual(landed, '0/1/0');
  const dump = dumpOf(handle);
  assert.strictEqual(vobAt(dump, '0/1').name, 'CHEST_01');
  assert.strictEqual(vobAt(dump, '0/1/0').name, 'FP_CAMPFIRE_ÄÖÜ_01');
  assert.strictEqual(vobAt(dump, '0').childCount, 2);
});

// getVobProps / setVobClassProp — the per-class pair (level-editor.md §7).
//
// The read is an export, not a new reader: `normalizeWorld` has dispatched on
// `VirtualObject::type` and emitted every class-specific field since phase 0,
// and it was unreachable only because it sat in an anonymous namespace behind
// the 933 ms dump. A second field mapping would be a second hand-maintained
// mirror of the vendor headers, and the two would agree only for as long as
// both were remembered — which is what the deep-equal below is for.
//
// The write resolves the VOB *before* it looks at the keys, unlike setVobProp,
// because the legal key set is a function of `vob->type`. A key that is legal
// on some other class is the mistake this op invites, so every refusal names
// the class it was asked about.

test('getVobProps reads the item instance the fixture authored', () => {
  const handle = load();
  const props = zenkit.getVobProps(handle, '0/1');

  assert.strictEqual(props.class, 'oCItem');
  assert.strictEqual(props.instance, 'ITMW_1H_SWORD_01');
});

test('getVobProps answers exactly what normalizeWorld reports for the same vob', () => {
  // The one assertion that stops the two readers drifting. They are the same
  // function; if this ever fails, someone gave the op path its own mapping.
  const handle = load();
  const dump = dumpOf(handle);

  for (const at of ['0', '0/0', '0/0/0', '0/1', '0/2']) {
    const { class: className, ...props } = zenkit.getVobProps(handle, at);
    assert.strictEqual(className, vobAt(dump, at).class, at);
    assert.deepStrictEqual(props, vobAt(dump, at).props, at);
  }
});

test('getVobProps throws on a bad index path', () => {
  const handle = load();
  for (const bad of ['9', '0/9', '0/1/0', 'abc', '', '0//1', '-1']) {
    assert.throws(() => zenkit.getVobProps(handle, bad), Error, bad);
  }
});

test('setVobClassProp writes the item instance, through cp1252', () => {
  const handle = load();
  zenkit.setVobClassProp(handle, '0/1', { instance: 'ITMW_ÄXT_01' });

  assert.strictEqual(zenkit.getVobProps(handle, '0/1').instance, 'ITMW_ÄXT_01');
  assert.strictEqual(vobAt(dumpOf(handle), '0/1').props.instance, 'ITMW_ÄXT_01');
});

test('setVobClassProp writes the light range and colour, and nothing beside them', () => {
  // The light carries seventeen fields the op does not name, three of them the
  // animation vectors that only exist because the fixture light is dynamic. A
  // writer that rebuilt the LightPreset instead of assigning two members would
  // pass on the two it was given and silently reset the rest.
  const handle = load();
  const before = vobAt(dumpOf(load()), '0/0/0').props;

  zenkit.setVobClassProp(handle, '0/0/0', { range: 1250.5, color: [10, 20, 30, 255] });

  const after = vobAt(dumpOf(handle), '0/0/0').props;
  assert.strictEqual(after.range, 1250.5);
  assert.deepStrictEqual(after.color, [10, 20, 30, 255]);
  for (const key of Object.keys(before)) {
    if (key === 'range' || key === 'color') continue;
    assert.deepStrictEqual(after[key], before[key], key);
  }
});

test('setVobClassProp refuses a key that belongs to another class, naming the class', () => {
  // The failure this op is shaped around: `range` is a real key, spelled
  // correctly, on a VOB that has no such field. Nothing above C++ knows the
  // class from the index path alone.
  const handle = load();

  assert.throws(() => zenkit.setVobClassProp(handle, '0/1', { range: 500 }), /oCItem/);
  assert.throws(
    () => zenkit.setVobClassProp(handle, '0/0/0', { instance: 'ITMW_1H_SWORD_01' }),
    /zCVobLight/,
  );
  assert.strictEqual(vobAt(dumpOf(handle), '0/1').props.instance, 'ITMW_1H_SWORD_01');
});

test('setVobClassProp refuses a class it has no field table for', () => {
  // A class arrives here one case at a time; the ones that have not are refused
  // by name rather than accepted and silently ignored.
  const handle = load();
  assert.throws(() => zenkit.setVobClassProp(handle, '0', { instance: 'X' }), /zCVob/);
  assert.throws(() => zenkit.setVobClassProp(handle, '0/2', { range: 1 }), /oCMobContainer/);
});

test('setVobClassProp refuses an unknown key, an empty props object and a non-object', () => {
  const handle = load();
  assert.throws(() => zenkit.setVobClassProp(handle, '0/1', { Instance: 'X' }), /Instance/);
  assert.throws(() => zenkit.setVobClassProp(handle, '0/0/0', { rangee: 1 }), /rangee/);
  assert.throws(() => zenkit.setVobClassProp(handle, '0/1', {}), /at least one/);
  for (const bad of [null, undefined, 'instance', 42, []]) {
    assert.throws(() => zenkit.setVobClassProp(handle, '0/1', bad), Error);
  }
  for (const bad of ['9', '0/9', 'abc', '', '0//1', '-1']) {
    assert.throws(() => zenkit.setVobClassProp(handle, bad, { instance: 'X' }), Error, bad);
  }
});

test('setVobClassProp refuses a wrongly typed value, and writes nothing when it does', () => {
  // Same rule as setVobProp: everything is validated before anything is
  // written, because a half-applied props object is a state no op describes and
  // undo would not restore it. The colour is checked after a refused range for
  // exactly that reason — it is the valid half of the pair.
  const handle = load();
  const before = vobAt(dumpOf(load()), '0/0/0').props;

  assert.throws(() => zenkit.setVobClassProp(handle, '0/1', { instance: 42 }), /instance/);
  for (const bad of [NaN, Infinity, -1, '500', null, [500]]) {
    assert.throws(() => zenkit.setVobClassProp(handle, '0/0/0', { range: bad }), /range/);
  }
  for (const bad of [[1, 2, 3], [1, 2, 3, 4, 5], [0, 0, 0, 256], [0, 0, -1, 0],
    [0, 0, 0, 1.5], ['0', 0, 0, 0], 'white', 255, null]) {
    assert.throws(() => zenkit.setVobClassProp(handle, '0/0/0', { color: bad }), /color/);
  }
  assert.throws(
    () => zenkit.setVobClassProp(handle, '0/0/0', { color: [1, 2, 3, 4], range: -1 }),
    /range/,
  );

  assert.deepStrictEqual(vobAt(dumpOf(handle), '0/0/0').props, before);
});

test('setVobClassProp changes only the targeted vob', () => {
  const handle = load();
  zenkit.setVobClassProp(handle, '0/0/0', { range: 42 });

  const mutated = dumpOf(handle);
  const fresh = dumpOf(load());
  for (let i = 0; i < fresh.vobs.length; i++) {
    if (fresh.vobs[i].path === '0/0/0') continue;
    assert.deepStrictEqual(mutated.vobs[i], fresh.vobs[i]);
  }
  assert.deepStrictEqual(mutated.mesh, fresh.mesh);
  assert.deepStrictEqual(mutated.bsp, fresh.bsp);
  assert.deepStrictEqual(mutated.waynet, fresh.waynet);
});

test('setVobClassProp survives a save and reload', () => {
  // The only test that proves ZenKit's per-class save() actually emits these
  // fields: everything above it reads the same in-memory structs the write
  // touched, and would pass for a field the writer drops on the floor.
  const handle = load();
  zenkit.setVobClassProp(handle, '0/1', { instance: 'ITMW_ÄXT_01' });
  zenkit.setVobClassProp(handle, '0/0/0', { range: 1250.5, color: [10, 20, 30, 255] });

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zk-class-rt-')), 'class.zen');
  zenkit.saveWorld(handle, out);
  const reloaded = dumpOf(zenkit.loadWorld(out, 'g2'));

  assert.strictEqual(vobAt(reloaded, '0/1').props.instance, 'ITMW_ÄXT_01');
  assert.strictEqual(vobAt(reloaded, '0/0/0').props.range, 1250.5);
  assert.deepStrictEqual(vobAt(reloaded, '0/0/0').props.color, [10, 20, 30, 255]);
});

// The sound family and the zones — class properties, increment 2
// (level-editor.md §14.1 item 1.4).
//
// These VOBs are in the mesh-extraction variant only, so the checked-in golden
// fixture's VOBs stay exactly where they were. Their paths are under the second
// root tree: `1/3` sound, `1/4` daytime sound, `1/5` far plane, `1/6` fog,
// `1/7` music.
//
// The per-key round trip below is what ties the C++ switch to `zen-world`'s
// CLASS_FIELDS catalogue. There is no shared constant between the two and there
// cannot be one, so the contract is this: every key the catalogue lists is
// written here, saved, re-loaded and read back. A key in the catalogue the
// binding does not write, or writes into the wrong member, fails here and
// nowhere else — every layer above this one mocks the binding out.

// Every boolean below is the *opposite* of what `BuildVisualVobTree` gave the
// fixture VOB, and `priority` is not its 2. A round trip that wrote nothing at
// all would otherwise read back the value it was asked for, and a `bool` case
// assigning the wrong member would be caught only by the sibling test.
const CLASS_PROP_ROUND_TRIP = [
  ['1/3', 'zCVobSound', {
    soundName: 'OW_WOLF_ÄÖÜ', volume: 77.5, radius: 3125.25, coneAngle: 135.5,
    initiallyPlaying: false, ambient3d: true, obstruction: false,
  }],
  ['1/4', 'zCVobSoundDaytime', {
    // The base sound fields *and* the derived three: the case is one
    // fallthrough onto the same VSound members, and a derived class writing
    // only its own three would pass every test that did not name a base field.
    // The booleans are base members too, so they carry the same proof.
    soundName: 'OW_DAY', volume: 12.5, radius: 4096, coneAngle: 45,
    initiallyPlaying: true, ambient3d: false, obstruction: true,
    startTime: 5.25, endTime: 21.75, soundName2: 'OW_NIGHT_ÄÖÜ',
  }],
  ['1/5', 'zCZoneVobFarPlane', { vobFarPlaneZ: 14000.5, innerRangePercentage: 0.125 }],
  ['1/6', 'zCZoneZFog', {
    rangeCenter: 9000.5, innerRangePercentage: 0.375,
    fadeOutSky: false, overrideColor: true, color: [10, 20, 30, 240],
  }],
  ['1/7', 'oCZoneMusic', {
    enabled: false, priority: 7, ellipsoid: true, reverb: -42.5, volume: 0.75, loop: false,
  }],
  ['1/8', 'zCVobAnimate', { startOn: false }],
  ['1/9', 'zCPFXController', {
    pfxName: 'PFX_CAMPFIRE_ÄÖÜ', killWhenDone: false, initiallyRunning: false,
  }],
  ['1/10', 'zCTriggerWorldStart', { fireOnce: false }],
  ['1/11', 'oCTriggerScript', { function: 'SCRIPTFUNC_OTHER_ÄÖÜ' }],
  ['1/12', 'zCTrigger', {
    startEnabled: false, sendUntrigger: true, reactToOnTrigger: false, reactToOnTouch: true,
    reactToOnDamage: false, respondToObject: true, respondToPc: false, respondToNpc: true,
    maxActivationCount: -1, retriggerDelaySec: 0, damageThreshold: 99.5, fireDelaySec: 0.25,
  }],
  ['1/13', 'oCTriggerChangeLevel', {
    startEnabled: false, sendUntrigger: true, reactToOnTrigger: false, reactToOnTouch: true,
    reactToOnDamage: false, respondToObject: true, respondToPc: false, respondToNpc: true,
    maxActivationCount: -1, retriggerDelaySec: 0, damageThreshold: 99.5, fireDelaySec: 0.25,
    levelName: 'OTHERWORLD.ZEN', startVob: 'OTHER_START_VOB',
  }],
  ['1/14', 'zCMover', {
    startEnabled: false, sendUntrigger: true, reactToOnTrigger: false, reactToOnTouch: true,
    reactToOnDamage: false, respondToObject: true, respondToPc: false, respondToNpc: true,
    maxActivationCount: -1, retriggerDelaySec: 0, damageThreshold: 99.5, fireDelaySec: 0.25,
    touchBlockerDamage: 12.5, stayOpenTimeSec: 6, locked: false, autoLink: true,
    autoRotate: false, sfxOpenStart: 'SFX_OTHER_OPEN_START_ÄÖÜ',
    sfxOpenEnd: 'SFX_OTHER_OPEN_END', sfxTransitioning: 'SFX_OTHER_TRANSITIONING',
    sfxCloseStart: 'SFX_OTHER_CLOSE_START', sfxCloseEnd: 'SFX_OTHER_CLOSE_END',
    sfxLock: 'SFX_OTHER_LOCK', sfxUnlock: 'SFX_OTHER_UNLOCK',
    sfxUseLocked: 'SFX_OTHER_USE_LOCKED',
  }],
  ['1/15', 'oCMOB', {
    focusName: 'FOCUS_OTHER_ÄÖÜ', hp: 99, damage: 12, movable: false, takable: true,
    focusOverride: true, visualDestroyed: 'OTHER_DESTROYED.MMS', owner: 'PC_OTHER',
    ownerGuild: 'GIL_NOV', destroyed: true,
  }],
  ['1/16', 'oCMobInter', {
    focusName: 'FOCUS_OTHER_LEVER_ÄÖÜ', hp: 50, damage: 1, movable: true, takable: false,
    focusOverride: true, visualDestroyed: 'LEVER_OTHER_DESTROYED.MMS', owner: 'PC_OTHER',
    ownerGuild: 'GIL_NOV', destroyed: true, stateCount: 4, conditionFunction: 'OTHER_CONDITION',
    onStateChangeFunction: 'OTHER_ON_STATE_CHANGE', rewind: false,
  }],
  ['1/17', 'oCMobFire', {
    focusName: 'FOCUS_OTHER_CAMPFIRE_ÄÖÜ', hp: 1, damage: 0, movable: false, takable: false,
    focusOverride: true, visualDestroyed: 'CAMPFIRE_OTHER_DESTROYED.MMS', owner: 'PC_OTHER',
    ownerGuild: 'GIL_NOV', destroyed: true, stateCount: 2, conditionFunction: 'OTHER_CONDITION',
    onStateChangeFunction: 'OTHER_ON_STATE_CHANGE', rewind: true,
    slot: 'BIP01 OTHER FIRE ÄÖÜ', vobTree: 'FIRETREE_OTHER.ZEN',
  }],
  ['1/18', 'oCMobContainer', {
    focusName: 'FOCUS_OTHER_CHEST_ÄÖÜ', hp: 40, damage: 0, movable: false, takable: false,
    focusOverride: true, visualDestroyed: 'CHEST_OTHER_DESTROYED.MMS', owner: 'PC_OTHER',
    ownerGuild: 'GIL_NOV', destroyed: true, stateCount: 2, conditionFunction: 'OTHER_CONDITION',
    onStateChangeFunction: 'OTHER_ON_STATE_CHANGE', rewind: true,
    locked: false, pickString: 'RLLR ÄÖÜ',
  }],
  ['1/19', 'oCMobDoor', {
    focusName: 'FOCUS_OTHER_DOOR_ÄÖÜ', hp: 60, damage: 0, movable: false, takable: false,
    focusOverride: true, visualDestroyed: 'DOOR_OTHER_DESTROYED.MMS', owner: 'PC_OTHER',
    ownerGuild: 'GIL_NOV', destroyed: true, stateCount: 2, conditionFunction: 'OTHER_CONDITION',
    onStateChangeFunction: 'OTHER_ON_STATE_CHANGE', rewind: true,
    locked: false, pickString: 'LLRR ÄÖÜ',
  }],
];

test('setVobClassProp round-trips every catalogued key of the sound family and the zones', () => {
  const file = authored();
  const handle = zenkit.loadWorld(file, 'g2');

  for (const [at, className, props] of CLASS_PROP_ROUND_TRIP) {
    assert.strictEqual(zenkit.getVobProps(handle, at).class, className, at);
    zenkit.setVobClassProp(handle, at, props);
  }

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zk-class2-rt-')), 'class2.zen');
  zenkit.saveWorld(handle, out);
  const reloaded = zenkit.loadWorld(out, 'g2');

  for (const [at, className, props] of CLASS_PROP_ROUND_TRIP) {
    const read = zenkit.getVobProps(reloaded, at);
    assert.strictEqual(read.class, className, at);
    for (const [key, value] of Object.entries(props)) {
      assert.deepStrictEqual(read[key], value, `${className}.${key}`);
    }
  }
});

test('setVobClassProp leaves every other field of these classes alone', () => {
  // The enums, the booleans and the random delays are all fields this op
  // deliberately cannot set. A case that assigned a whole struct instead of
  // member by member would reset them, and nothing above C++ would notice.
  const file = authored();
  const handle = zenkit.loadWorld(file, 'g2');
  const fresh = zenkit.loadWorld(file, 'g2');

  for (const [at, , props] of CLASS_PROP_ROUND_TRIP) {
    const before = zenkit.getVobProps(fresh, at);
    zenkit.setVobClassProp(handle, at, props);
    const after = zenkit.getVobProps(handle, at);

    for (const key of Object.keys(before)) {
      if (key in props) continue;
      assert.deepStrictEqual(after[key], before[key], `${at}.${key}`);
    }
  }
});

test('setVobClassProp writes one key of these classes without touching its siblings', () => {
  const handle = zenkit.loadWorld(authored(), 'g2');
  const before = zenkit.getVobProps(handle, '1/6');

  zenkit.setVobClassProp(handle, '1/6', { rangeCenter: 1234.5 });

  const after = zenkit.getVobProps(handle, '1/6');
  assert.strictEqual(after.rangeCenter, 1234.5);
  assert.strictEqual(after.innerRangePercentage, before.innerRangePercentage);
  assert.deepStrictEqual(after.color, before.color);
});

test('setVobClassProp refuses a daytime-only key on a plain sound, and takes a base key on a daytime one', () => {
  // The one refusal the inheritance makes possible: `radius` is legal on both,
  // `startTime` on only the derived one. A case that flattened the two would
  // write `startTime` onto a VSound that has no such member.
  const handle = zenkit.loadWorld(authored(), 'g2');

  assert.throws(() => zenkit.setVobClassProp(handle, '1/3', { startTime: 6 }), /zCVobSound/);
  assert.throws(() => zenkit.setVobClassProp(handle, '1/3', { soundName2: 'X' }), /zCVobSound/);
  zenkit.setVobClassProp(handle, '1/4', { radius: 999 });
  assert.strictEqual(zenkit.getVobProps(handle, '1/4').radius, 999);
});

test('setVobClassProp refuses a zone field on the wrong zone, naming the class', () => {
  // Three unrelated classes that read like one family — the mistake this op
  // carries a class name to catch.
  const handle = zenkit.loadWorld(authored(), 'g2');

  assert.throws(
    () => zenkit.setVobClassProp(handle, '1/5', { rangeCenter: 1 }),
    /zCZoneVobFarPlane/,
  );
  assert.throws(() => zenkit.setVobClassProp(handle, '1/6', { vobFarPlaneZ: 1 }), /zCZoneZFog/);
  assert.throws(
    () => zenkit.setVobClassProp(handle, '1/7', { color: [0, 0, 0, 255] }),
    /oCZoneMusic/,
  );
  // And the fields these classes have that the catalogue still deliberately
  // excludes: the enums, and the two random delays the engine reads only under
  // a `mode` this op cannot set.
  for (const [at, bad] of [['1/3', { mode: 1 }], ['1/3', { volumeType: 1 }],
    ['1/3', { randomDelay: 5 }], ['1/3', { randomDelayVar: 1 }]]) {
    assert.throws(() => zenkit.setVobClassProp(handle, at, bad), Error, at);
  }
});

test('setVobClassProp refuses a boolean that is not one, and an integer that is not whole', () => {
  // The two refusals the new kinds exist for. A `bool` taking `0` or `'true'`
  // would be a coercion the archive stores as a byte nobody chose; an `int`
  // taking `1.5` would truncate on the cast to `int32_t` and report success,
  // which is precisely why `priority` is not a float.
  const handle = zenkit.loadWorld(authored(), 'g2');
  const soundBefore = zenkit.getVobProps(handle, '1/3');
  const musicBefore = zenkit.getVobProps(handle, '1/7');

  for (const bad of [0, 1, 'true', null, [], {}]) {
    assert.throws(() => zenkit.setVobClassProp(handle, '1/3', { obstruction: bad }), /obstruction/);
    assert.throws(() => zenkit.setVobClassProp(handle, '1/6', { overrideColor: bad }),
      /overrideColor/);
  }
  for (const bad of [1.5, -1, NaN, Infinity, true, '3', 2147483648]) {
    assert.throws(() => zenkit.setVobClassProp(handle, '1/7', { priority: bad }), /priority/);
  }

  // Nothing was written by any of them, and the valid half of a mixed props
  // object is refused with the invalid one.
  assert.throws(
    () => zenkit.setVobClassProp(handle, '1/7', { volume: 0.25, priority: 1.5 }),
    /priority/,
  );
  assert.deepStrictEqual(zenkit.getVobProps(handle, '1/3'), soundBefore);
  assert.deepStrictEqual(zenkit.getVobProps(handle, '1/7'), musicBefore);
});

test('setVobClassProp writes one boolean of a class without touching its siblings', () => {
  // `false` is the value a written-vs-unwritten mistake hides behind: a case
  // that assigned every boolean it knew about would set the other two to their
  // defaults and nothing above C++ would see it.
  const handle = zenkit.loadWorld(authored(), 'g2');
  const before = zenkit.getVobProps(handle, '1/3');
  assert.strictEqual(before.initiallyPlaying, true);
  assert.strictEqual(before.obstruction, true);

  zenkit.setVobClassProp(handle, '1/3', { obstruction: false });

  const after = zenkit.getVobProps(handle, '1/3');
  assert.strictEqual(after.obstruction, false);
  assert.strictEqual(after.initiallyPlaying, before.initiallyPlaying);
  assert.strictEqual(after.ambient3d, before.ambient3d);
  assert.strictEqual(after.soundName, before.soundName);
});

test('setVobClassProp refuses an out-of-bounds sound or zone value, and writes nothing', () => {
  // The bounds are duplicated in `zen-world`'s catalogue for the grid's sake;
  // this is the copy that is load-bearing, because the IPC validator is bypassed
  // by anything that reaches the binding directly.
  const handle = zenkit.loadWorld(authored(), 'g2');
  const before = zenkit.getVobProps(handle, '1/3');

  assert.throws(() => zenkit.setVobClassProp(handle, '1/3', { volume: -0.5 }), /volume/);
  assert.throws(() => zenkit.setVobClassProp(handle, '1/3', { coneAngle: 361 }), /coneAngle/);
  assert.throws(() => zenkit.setVobClassProp(handle, '1/3', { radius: -1 }), /radius/);
  assert.throws(() => zenkit.setVobClassProp(handle, '1/4', { startTime: 24.5 }), /startTime/);
  assert.throws(() => zenkit.setVobClassProp(handle, '1/5', { vobFarPlaneZ: -1 }), /vobFarPlaneZ/);
  assert.throws(() => zenkit.setVobClassProp(handle, '1/6', { rangeCenter: -1 }), /rangeCenter/);
  // `innerRangePercentage` is stored 0..1 — measured over the three retail
  // worlds (every value in [0.1, 1.0], the `…Default` zones exactly 1.0), where
  // ZenKit's docs say "Unknown". So 1.5 is refused on both zone classes.
  assert.throws(
    () => zenkit.setVobClassProp(handle, '1/5', { innerRangePercentage: 1.5 }),
    /innerRangePercentage/,
  );
  assert.throws(
    () => zenkit.setVobClassProp(handle, '1/6', { innerRangePercentage: 1.5 }),
    /innerRangePercentage/,
  );

  // The valid half of a refused pair must not have been written: everything is
  // validated before anything is assigned.
  assert.throws(
    () => zenkit.setVobClassProp(handle, '1/3', { soundName: 'OW_NEW', volume: -5 }),
    /volume/,
  );
  assert.deepStrictEqual(zenkit.getVobProps(handle, '1/3'), before);
});

test('setVobClassProp takes a sound volume above 100, which retail NewWorld holds', () => {
  // ZenKit documents `volume` as "percent (0-100)", and retail NewWorld holds
  // 130 on two sounds and 150 on four (measured 2026-08-27) — so there is no
  // maximum, and a bound of 100 would refuse values the game itself ships.
  const handle = zenkit.loadWorld(authored(), 'g2');
  zenkit.setVobClassProp(handle, '1/3', { volume: 150 });
  assert.strictEqual(zenkit.getVobProps(handle, '1/3').volume, 150);
});

test('setVobClassProp takes a negative music reverb, which is why it has no lower bound', () => {
  // ZenGin's reverb level is negative decibels. A `min: 0` copied from the
  // light's range would refuse every music zone in a retail world.
  const handle = zenkit.loadWorld(authored(), 'g2');
  zenkit.setVobClassProp(handle, '1/7', { reverb: -100 });
  assert.strictEqual(zenkit.getVobProps(handle, '1/7').reverb, -100);
  for (const bad of [NaN, Infinity, '0', null]) {
    assert.throws(() => zenkit.setVobClassProp(handle, '1/7', { reverb: bad }), /reverb/);
  }
});

test('setVobClassProp refuses a sound name that is not a string', () => {
  const handle = zenkit.loadWorld(authored(), 'g2');
  for (const bad of [42, null, ['OW'], true]) {
    assert.throws(() => zenkit.setVobClassProp(handle, '1/3', { soundName: bad }), /soundName/);
  }
  assert.throws(() => zenkit.setVobClassProp(handle, '1/4', { soundName2: 42 }), /soundName2/);
});
