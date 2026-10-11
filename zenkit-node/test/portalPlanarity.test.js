'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zenkit = require('..');
const {
  fanCornerIndices,
  planeDeviation,
  portalPolygonCorners,
} = require('../scripts/check-portal-planarity.js');

// The geometry behind the measurement `check-portal-planarity.js` reports over
// the retail worlds (level-editor.md §16.22 q2). The script itself needs an
// installation; this pins the two pure steps and the join they rest on.

test('a triangle keeps its three corners in stored order', () => {
  // One triangle, corners 7, 8, 9.
  const indices = new Uint32Array([7, 8, 9]);
  assert.deepStrictEqual(fanCornerIndices(indices, 0, 3), [7, 8, 9]);
});

test('an n-gon is read back off its fan', () => {
  // A quad fans into (0,1,2) and (0,2,3): corner 3 is only ever the third
  // vertex of the second triangle, which is why the third corner of every
  // triangle after the first is what the walk collects.
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 0, 3, 4]);
  assert.deepStrictEqual(fanCornerIndices(indices, 0, 4), [0, 1, 2, 3]);
  assert.deepStrictEqual(fanCornerIndices(indices, 0, 5), [0, 1, 2, 3, 4]);
});

test('a polygon later in the chunk is found at its triangle offset', () => {
  // The quad above, then a triangle: the triangle starts at offset 2.
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 5, 6, 7]);
  assert.deepStrictEqual(fanCornerIndices(indices, 2, 3), [5, 6, 7]);
});

test('a fan that runs off the end of the chunk is null, not a short polygon', () => {
  const indices = new Uint32Array([0, 1, 2]);
  assert.strictEqual(fanCornerIndices(indices, 0, 4), null);
  assert.strictEqual(fanCornerIndices(indices, 1, 3), null);
});

test('coplanar corners deviate by nothing, and the stored plane is confirmed', () => {
  // Plane y = 5, in the on-disk field order [distance, nx, ny, nz].
  const corners = [[0, 5, 0], [10, 5, 0], [10, 5, 10]];
  const d = planeDeviation(corners, [5, 0, 1, 0]);
  assert.strictEqual(d.spread, 0);
  assert.strictEqual(d.worstAlong, 0);
  // The other sign convention (n·p + d = 0) is off by twice the distance,
  // which is what tells the two apart on a corpus.
  assert.strictEqual(d.worstAgainst, 10);
  assert.strictEqual(d.normalLength, 1);
});

test('a corner off the plane is the deviation, in world units', () => {
  const corners = [[0, 5, 0], [10, 5.25, 0], [10, 4.5, 10]];
  const d = planeDeviation(corners, [5, 0, 1, 0]);
  assert.strictEqual(d.spread, 0.75);
  assert.strictEqual(d.worstAlong, 0.5);
});

test('a degenerate normal is reported rather than dividing by it', () => {
  const d = planeDeviation([[0, 0, 0], [1, 1, 1]], [0, 0, 0, 0]);
  assert.strictEqual(d.normalLength, 0);
  assert.strictEqual(d.spread, null);
  assert.strictEqual(d.worstAlong, null);
});

test('the fixture world joins its portal polygon back to its corners', () => {
  // The join the script rests on: `getPortals` names a polygon by mesh index,
  // `_drillMesh` gives that polygon its material and corner count, and
  // `extractWorldMesh` holds the only vertex positions the binding exposes —
  // fan-triangulated, per material, in mesh order. This proves the arithmetic
  // that walks from one to the other on the fixture, where the answer is
  // known: polygon 1 is the portal triangle over vertices 1, 2 and 4.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-planarity-'));
  const file = path.join(dir, 'portals.g2.zen');
  zenkit._authorFixtureWorld(file, 'binsafe', 'g2', 'mesh-extraction');
  try {
    const handle = zenkit.loadWorld(file, 'g2');
    const found = portalPolygonCorners(zenkit, handle);

    assert.strictEqual(found.flagMismatches, 0);
    assert.strictEqual(found.unjoined, 0);
    assert.strictEqual(found.polygons.length, 1);

    const [polygon] = found.polygons;
    assert.strictEqual(polygon.polygonIndex, 1);
    assert.strictEqual(polygon.cornerCount, 3);
    assert.deepStrictEqual(polygon.corners, [[10, 0, 0], [10, 0, 10], [20, 0, 0]]);
    assert.deepStrictEqual(polygon.plane, [0, 0, 1, 0]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
