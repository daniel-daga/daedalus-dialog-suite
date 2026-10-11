'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const zenkit = require('..');

const FIXTURE = path.join(__dirname, 'fixtures', 'minimal.g2.zen');
const GOLDEN = path.join(__dirname, 'fixtures', 'minimal.g2.golden.json');

function drillFixture(window) {
  return zenkit._drillMesh(zenkit.loadWorld(FIXTURE, 'g2'), window);
}

test('_drillMesh exposes per-polygon geometry for the fixture', () => {
  const drill = drillFixture();
  assert.strictEqual(drill.polyCount, 2);
  assert.strictEqual(drill.offset, 0);
  assert.strictEqual(drill.geometry.length, 2);

  // Two triangles of a flat quad (see src/fixture.cc BuildMesh).
  assert.deepStrictEqual(drill.geometry[0], {
    material: 0,
    lightmap: -1,
    flagsBits: 0,
    sectorIndex: -1,
    vertexIndices: [0, 1, 2],
    featureIndices: [0, 1, 2],
    // [planeDistance, normalX, normalY, normalZ] — on-disk field order.
    plane: [0, 0, 1, 0],
  });
  assert.deepStrictEqual(drill.geometry[1], {
    material: 1,
    lightmap: -1,
    flagsBits: 0,
    sectorIndex: -1,
    vertexIndices: [0, 2, 3],
    featureIndices: [0, 2, 3],
    plane: [0, 0, 1, 0],
  });
});

test('_drillMesh geometry recomputes the golden polyHash', () => {
  // Ties the drill output to normalizeWorld's polyHash: serializing the
  // drilled polygons with the ByteSink layout from src/normalize.cc
  // (HashPolygons) must reproduce the checked-in golden hash exactly.
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const drill = drillFixture();
  assert.strictEqual(drill.polyCount, golden.mesh.polyCount);

  const chunks = [];
  const u8 = (v) => chunks.push(Buffer.from([v & 0xff]));
  const u32 = (v) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0);
    chunks.push(b);
  };
  const i32 = (v) => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v);
    chunks.push(b);
  };
  const i16 = (v) => {
    const b = Buffer.alloc(2);
    b.writeInt16LE(v);
    chunks.push(b);
  };
  const f32 = (v) => {
    const b = Buffer.alloc(4);
    b.writeFloatLE(v);
    chunks.push(b);
  };
  for (const poly of drill.geometry) {
    u32(poly.material);
    i32(poly.lightmap);
    // flagsBits is the packed G2 on-disk byte (see Mesh.cc); unpack the seven
    // flag bits in HashPolygons order. isLod/normalAxis are G1-only — always
    // zero for a G2 world.
    u8(poly.flagsBits & 0b11); // isPortal
    u8((poly.flagsBits >> 2) & 1); // isOccluder
    u8((poly.flagsBits >> 3) & 1); // isSector
    u8((poly.flagsBits >> 4) & 1); // shouldRelight
    u8((poly.flagsBits >> 5) & 1); // isOutdoor
    u8((poly.flagsBits >> 6) & 1); // isGhostOccluder
    u8((poly.flagsBits >> 7) & 1); // isDynamicallyLit
    i16(poly.sectorIndex);
    u8(0); // isLod (G1 only)
    u8(0); // normalAxis (G1 only)
    f32(poly.plane[0]); // planeDistance
    f32(poly.plane[1]); // normal x
    f32(poly.plane[2]); // normal y
    f32(poly.plane[3]); // normal z
    u32(poly.vertexIndices.length);
    for (let i = 0; i < poly.vertexIndices.length; i++) {
      u32(poly.vertexIndices[i]);
      u32(poly.featureIndices[i]);
    }
  }
  const digest = crypto.createHash('sha256').update(Buffer.concat(chunks)).digest('hex');
  assert.strictEqual(`sha256:${digest}`, golden.mesh.polyHash);
});

test('_drillMesh supports an {offset, limit} window', () => {
  const windowed = drillFixture({ offset: 1, limit: 5 });
  assert.strictEqual(windowed.polyCount, 2);
  assert.strictEqual(windowed.offset, 1);
  assert.strictEqual(windowed.geometry.length, 1);
  assert.strictEqual(windowed.geometry[0].material, 1);
  assert.deepStrictEqual(windowed.geometry[0].vertexIndices, [0, 2, 3]);

  const empty = drillFixture({ offset: 10, limit: 5 });
  assert.strictEqual(empty.geometry.length, 0);
  assert.strictEqual(empty.polyCount, 2);
});

test('_drillMesh rejects a non-handle argument', () => {
  assert.throws(() => zenkit._drillMesh('not a handle'), /world handle/);
});
