'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zenkit = require('..');

// `getPortals` reads out the four portal fields that used to exist only inside
// the fidelity hashes (level-editor.md §16.18, slice 2): a polygon's
// `is_portal` and `is_sector` flags, its `sector_index`, and the BSP's
// `portal_polygon_indices`. Every portal check past the material names — the
// orientation check first among them — needs them as data, and `polyHash` /
// `portalPolyHash` answer only "did they change".
//
// Rows exist for portal and sector polygons only. A retail world mesh is
// ~200k polygons and a few hundred of them carry portal metadata, so a
// per-polygon column would be a megabyte of zeroes to say the same thing.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-portals-'));
const FIXTURE = path.join(dir, 'portals.g2.zen');
zenkit._authorFixtureWorld(FIXTURE, 'binsafe', 'g2', 'mesh-extraction');

const MINIMAL = path.join(__dirname, 'fixtures', 'minimal.g2.zen');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const portals = (file = FIXTURE) => zenkit.getPortals(zenkit.loadWorld(file, 'g2'));
const u32 = (buf) => Array.from(new Uint32Array(buf));
const i32 = (buf) => Array.from(new Int32Array(buf));
const u8 = (buf) => Array.from(new Uint8Array(buf));

test('getPortals emits one row per portal or sector polygon', () => {
  const p = portals();

  // The mesh-extraction fixture has three polygons: a plain quad, a portal
  // triangle (is_portal 1, material EX_STONE) and a sector triangle
  // (is_sector, material EX_GRASS). See src/fixture.cc.
  assert.strictEqual(p.polyCount, 3);
  assert.strictEqual(p.count, 2);
  assert.deepStrictEqual(u32(p.polygonIndices), [1, 2]);
  assert.deepStrictEqual(u32(p.materialIndices), [0, 1]);
  assert.deepStrictEqual(u8(p.portalKinds), [1, 0]);
  assert.deepStrictEqual(u8(p.sectorFlags), [0, 1]);
});

test('getPortals reports sector_index signed, -1 for none', () => {
  // `sector_index` is an i16 on disk and -1 means "no sector"; an unsigned
  // column would report 65535 and every comparison against the sector list
  // would then be a comparison against a valid-looking index.
  const p = portals();
  assert.deepStrictEqual(i32(p.sectorIndices), [1, 0]);

  const plain = portals(MINIMAL);
  assert.strictEqual(plain.polyCount, 2);
  assert.strictEqual(plain.count, 0);
  assert.deepStrictEqual(i32(plain.sectorIndices), []);
});

test('getPortals reads out the BSP portal polygon list', () => {
  // `portal_polygon_indices` indexes the mesh geometry, so it joins to
  // `polygonIndices` above — that join is the whole point of reading it out.
  const p = portals();
  assert.deepStrictEqual(u32(p.bspPortalPolygons), [1]);

  assert.deepStrictEqual(u32(portals(MINIMAL).bspPortalPolygons), []);
});

test('getPortals rejects a non-handle argument', () => {
  assert.throws(() => zenkit.getPortals('not a handle'), /world handle/);
});
