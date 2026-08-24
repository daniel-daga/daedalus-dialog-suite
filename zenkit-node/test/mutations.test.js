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
