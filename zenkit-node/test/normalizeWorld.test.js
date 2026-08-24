'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const zenkit = require('..');

const FIXTURE = path.join(__dirname, 'fixtures', 'minimal.g2.zen');
const GOLDEN = path.join(__dirname, 'fixtures', 'minimal.g2.golden.json');

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;

function dumpFixture() {
  return zenkit.normalizeWorld(zenkit.loadWorld(FIXTURE, 'g2'));
}

test('normalizeWorld dump deep-equals the checked-in golden', () => {
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  assert.deepStrictEqual(dumpFixture(), golden);
});

test('normalizeWorld is deterministic across runs', () => {
  assert.deepStrictEqual(dumpFixture(), dumpFixture());
});

test('normalizeWorld meta describes the loaded archive', () => {
  const dump = dumpFixture();
  assert.strictEqual(dump.meta.gameVersion, 'g2');
  assert.strictEqual(dump.meta.archiveFormat, 'binsafe');
  assert.strictEqual(typeof dump.meta.archiveVersion, 'number');
  // Deliberately excluded: the writer stamps date/user, they are not world data.
  assert.ok(!('date' in dump.meta));
  assert.ok(!('user' in dump.meta));
});

test('normalizeWorld vobs are depth-first with index paths', () => {
  const dump = dumpFixture();
  assert.strictEqual(dump.vobs.length, 4);
  assert.deepStrictEqual(
    dump.vobs.map((v) => v.path),
    ['0', '0/0', '0/1', '0/2']
  );
  assert.strictEqual(dump.vobs[0].class, 'zCVob');
  assert.strictEqual(dump.vobs[0].childCount, 3);
  assert.strictEqual(dump.vobs[1].name, 'FP_CAMPFIRE_ÄÖÜ_01');
  assert.strictEqual(dump.vobs[1].class, 'zCVobSpot');
  assert.strictEqual(dump.vobs[2].class, 'oCItem');
  assert.strictEqual(dump.vobs[2].props.instance, 'ITMW_1H_SWORD_01');
  assert.strictEqual(dump.vobs[3].class, 'oCMobContainer');
  assert.strictEqual(dump.vobs[3].props.locked, true);
  assert.strictEqual(dump.vobs[3].props.key, 'ITKE_CHEST_01');
  assert.strictEqual(dump.vobs[3].props.contents, 'ITMI_GOLD:25');
  for (const vob of dump.vobs) {
    assert.strictEqual(vob.position.length, 3);
    assert.strictEqual(vob.rotation.length, 9);
    assert.strictEqual(vob.bbox.length, 6);
    assert.strictEqual(typeof vob.flags.showVisual, 'boolean');
    assert.strictEqual(typeof vob.flags.spriteAlignment, 'number');
  }
});

test('normalizeWorld mesh has counts, ordered materials and sha256 hashes', () => {
  const { mesh } = dumpFixture();
  assert.strictEqual(mesh.vertexCount, 4);
  assert.strictEqual(mesh.polyCount, 2);
  // ORDER-SENSITIVE: authored order, polygons reference materials by index.
  assert.deepStrictEqual(mesh.materials, ['FIXTURE_STONE', 'FIXTURE_GRASS']);
  assert.match(mesh.vertexHash, SHA256_RE);
  assert.match(mesh.polyHash, SHA256_RE);
  assert.match(mesh.featureHash, SHA256_RE);
  assert.match(mesh.materialHash, SHA256_RE);
  assert.deepStrictEqual(mesh.bbox, [0, -1, 0, 100, 1, 100]);
});

test('normalizeWorld bsp reports the single-leaf fixture tree', () => {
  const { bsp } = dumpFixture();
  assert.strictEqual(bsp.nodeCount, 1);
  assert.strictEqual(bsp.leafCount, 1);
  assert.strictEqual(bsp.treeDepth, 1);
  assert.deepStrictEqual(bsp.sectorNames, []);
  assert.strictEqual(bsp.lightMapCount, 0);
  assert.match(bsp.portalPolyHash, SHA256_RE);
  assert.match(bsp.leafPolyHash, SHA256_RE);
  assert.match(bsp.nodeHash, SHA256_RE);
});

test('normalizeWorld waynet is sorted with pair-sorted edges', () => {
  const { waynet } = dumpFixture();
  assert.deepStrictEqual(
    waynet.waypoints.map((wp) => wp.name),
    ['FP_FIXTURE_FREE', 'WP_FIXTURE_A', 'WP_FIXTURE_B', 'WP_FIXTURE_C']
  );
  const free = waynet.waypoints[0];
  assert.strictEqual(free.freePoint, true);
  assert.strictEqual(free.underWater, false);
  assert.strictEqual(free.waterDepth, 0);
  assert.deepStrictEqual(free.position, [50, 0, 50]);
  assert.deepStrictEqual(free.direction, [0, 0, 1]);
  assert.deepStrictEqual(waynet.edges, [
    ['WP_FIXTURE_A', 'WP_FIXTURE_B'],
    ['WP_FIXTURE_A', 'WP_FIXTURE_C'],
    ['WP_FIXTURE_B', 'WP_FIXTURE_C'],
  ]);
});
