'use strict';

// §1 minimal mutations — setVobPosition + insertItemVob. They exist only to
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

  const at = zenkit.insertVob(handle, {
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

test('insertVob takes the index one past the end, renumbering nothing', () => {
  // The reason it appends a root and takes no parent. A VOB inserted anywhere
  // else is enumerated before some of the VOBs that already exist, and every one
  // of those changes its flat index — which every op in the history carries.
  const handle = load();
  const before = dumpOf(load()).vobs;

  zenkit.insertVob(handle, { visual: 'NW_CRATE.3DS', position: [0, 0, 0] });

  const after = dumpOf(handle).vobs;
  assert.strictEqual(after.length, before.length + 1);
  for (let i = 0; i < before.length; i++) {
    assert.deepStrictEqual(after[i], before[i], `vob ${i} moved or changed`);
  }
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
    const at = zenkit.insertVob(handle, { visual, position: [0, 0, 0] });
    assert.strictEqual(vobAt(dumpOf(handle), at).visualType, type, visual);
  }
});

test('insertVob refuses a visual it cannot author', () => {
  const handle = load();
  // A decal carries its own dimension, offset, alpha function and weight; a
  // zCDecal authored without them is a visual ZenGin never wrote. Refusing is
  // the honest answer until this API takes them.
  assert.throws(() => zenkit.insertVob(handle, { visual: 'X.TGA', position: [0, 0, 0] }), /decal/i);
  for (const bad of ['X.MRM', 'X', 'X.WAV', '.3DS.']) {
    assert.throws(() => zenkit.insertVob(handle, { visual: bad, position: [0, 0, 0] }), Error, bad);
  }
});

test('insertVob without a visual makes a VOB with none, like an inserted item', () => {
  const handle = load();
  const at = zenkit.insertVob(handle, { name: 'MARKER', position: [1, 2, 3] });

  const placed = vobAt(dumpOf(handle), at);
  assert.strictEqual(placed.visual, null);
  // Nothing to draw, so nothing claims otherwise.
  assert.strictEqual(placed.flags.showVisual, false);
});

test('insertVob writes the rotation, box and flags it is given', () => {
  const handle = load();
  const at = zenkit.insertVob(handle, {
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
  assert.throws(() => zenkit.insertVob(handle, {}), /position/);
  assert.throws(() => zenkit.insertVob(handle, { position: [1, 2] }), /position/);
  assert.throws(() => zenkit.insertVob(handle, { position: [0, 0, 0], rotation: [1, 2, 3] }), /rotation/);
  assert.throws(() => zenkit.insertVob(handle, { position: [0, 0, 0], bbox: [1, 2, 3] }), /bbox/);
  assert.throws(() => zenkit.insertVob(handle, { position: [0, 0, 0], parent: '0' }), /parent/);
  assert.throws(() => zenkit.insertVob(handle, null), Error);
});

test('deleteVob removes the vob and its whole subtree', () => {
  const handle = load();
  const before = zenkit.worldStats(handle).vobCount;
  const children = vobAt(dumpOf(handle), '0').childCount;

  zenkit.deleteVob(handle, '0');

  // The root and every descendant: the fixture's root carries three children.
  assert.strictEqual(zenkit.worldStats(handle).vobCount, before - (1 + children));
  assert.strictEqual(dumpOf(handle).vobs.find((v) => v.path === '0/0'), undefined);
});

test('deleteVob undoes an insert exactly, leaving the world as it was', () => {
  // The pair is what makes the op invertible: an added VOB is described
  // completely by what created it, so undo deletes it and redo makes it again.
  const handle = load();
  const before = dumpOf(load());

  const at = zenkit.insertVob(handle, {
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
  const at = zenkit.insertVob(handle, {
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

test('insertItemVob appends an oCItem under the parent and returns its path', () => {
  const handle = load();
  const statsBefore = zenkit.worldStats(handle);

  const itemPath = zenkit.insertItemVob(handle, '0', {
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

test('insertItemVob with a null parent appends a new root vob', () => {
  const handle = load();
  const itemPath = zenkit.insertItemVob(handle, null, {
    name: 'ITEM_ROOT_01',
    instance: 'ITMI_GOLD',
    position: [0, 0, 0],
  });
  assert.strictEqual(itemPath, '1');
  const item = vobAt(dumpOf(handle), '1');
  assert.strictEqual(item.class, 'oCItem');
  assert.strictEqual(item.props.instance, 'ITMI_GOLD');
});

test('insertItemVob throws on a bad parent path', () => {
  const handle = load();
  for (const bad of ['9', '0/7', 'x', '']) {
    assert.throws(
      () =>
        zenkit.insertItemVob(handle, bad, {
          name: 'ITEM_X',
          instance: 'ITMI_GOLD',
          position: [0, 0, 0],
        }),
      Error,
      bad
    );
  }
});

test('mutations survive a save/reload round trip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-node-mut-'));
  try {
    const handle = load();
    zenkit.setVobPosition(handle, '0/1', [77, 88, 99]);
    zenkit.insertItemVob(handle, '0', {
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
  const extra = zenkit.insertVob(handle, { name: 'CARGO', position: [1, 2, 3] });
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
