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
