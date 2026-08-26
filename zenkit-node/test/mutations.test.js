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
