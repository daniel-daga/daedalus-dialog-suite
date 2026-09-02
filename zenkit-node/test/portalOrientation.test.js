'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zenkit = require('..');
const { polygonCorners } = require('../scripts/check-portal-planarity.js');
const {
  sectorOf,
  sectorCentroids,
  sideOf,
  orientPortal,
  measureOrientation,
} = require('../scripts/check-portal-orientation.js');

// The arithmetic behind the measurement `check-portal-orientation.js` reports
// over the retail worlds (level-editor.md §16.22 q3). The script itself needs
// an installation; this pins the sector naming, the side test, the verdicts
// and the walk they rest on.

test('a sector polygon names its sector before the first underscore', () => {
  assert.strictEqual(sectorOf('S:OWMINE01_OMWAGREEN05'), 'OWMINE01');
  assert.strictEqual(sectorOf('s:riceb02_NCIDWAROOF01'), 'RICEB02');
  // No sector, or no material after it: not a membership.
  assert.strictEqual(sectorOf('S:_X'), null);
  assert.strictEqual(sectorOf('S:OWMINE01'), null);
  assert.strictEqual(sectorOf('P:A_B'), null);
  assert.strictEqual(sectorOf('OW_STONE'), null);
});

test('a sector centroid is the mean of every corner of every polygon', () => {
  const centroids = sectorCentroids([
    { sector: 'A', corners: [[0, 0, 0], [2, 0, 0], [2, 2, 0]] },
    { sector: 'A', corners: [[4, 4, 4]] },
    { sector: 'B', corners: [[10, 0, 0]] },
  ]);
  assert.deepStrictEqual(centroids.get('A'), {
    centroid: [2, 1.5, 1],
    polygons: 2,
    corners: [[0, 0, 0], [2, 0, 0], [2, 2, 0], [4, 4, 4]],
  });
  assert.deepStrictEqual(centroids.get('B'), {
    centroid: [10, 0, 0], polygons: 1, corners: [[10, 0, 0]],
  });
});

test('the side of a stored plane is signed along its normal', () => {
  // Plane x = 10, on-disk order [distance, nx, ny, nz]; the normal is scaled
  // so the division by its length is exercised.
  const plane = [10, 2, 0, 0];
  assert.strictEqual(sideOf(plane, [15, 3, 3]), 5);
  assert.strictEqual(sideOf(plane, [4, 0, 0]), -6);
  assert.strictEqual(sideOf(plane, [10, 9, 9]), 0);
});

test('a two-sided portal is front-named when the normal points into A', () => {
  const plane = [10, 1, 0, 0]; // x = 10, normal +x
  const centroids = new Map([
    ['A', { centroid: [20, 0, 0], corners: [[20, 0, 0], [25, 0, 0], [5, 0, 0], [30, 0, 0]] }],
    ['B', { centroid: [0, 0, 0], corners: [[0, 0, 0]] }],
  ]);
  const ab = orientPortal(plane, ['A', 'B'], centroids);
  assert.strictEqual(ab.verdict, 'front-named');
  assert.strictEqual(ab.twoSided, true);
  assert.strictEqual(ab.sA, 10);
  assert.strictEqual(ab.sB, -10);
  // The corner shares beside the centroid: one of A's four corners is behind.
  assert.strictEqual(ab.fA, 0.75);
  assert.strictEqual(ab.fB, 0);
  assert.strictEqual(orientPortal(plane, ['B', 'A'], centroids).verdict, 'back-named');
  // The same sectors seen through the flipped plane flip the verdict.
  assert.strictEqual(orientPortal([-10, -1, 0, 0], ['A', 'B'], centroids).verdict, 'back-named');
});

test('a two-sided portal with both sectors on one side is ambiguous, by name', () => {
  const plane = [10, 1, 0, 0];
  const front = new Map([
    ['A', { centroid: [20, 0, 0] }], ['B', { centroid: [30, 0, 0] }],
  ]);
  assert.strictEqual(orientPortal(plane, ['A', 'B'], front).verdict, 'both-in-front');
  const behind = new Map([
    ['A', { centroid: [0, 0, 0] }], ['B', { centroid: [5, 0, 0] }],
  ]);
  assert.strictEqual(orientPortal(plane, ['A', 'B'], behind).verdict, 'both-behind');
  const onPlane = new Map([
    ['A', { centroid: [10, 0, 0] }], ['B', { centroid: [0, 0, 0] }],
  ]);
  assert.strictEqual(orientPortal(plane, ['A', 'B'], onPlane).verdict, 'on-plane');
  // A name with no S: polygons behind it cannot be placed at all.
  assert.strictEqual(orientPortal(plane, ['A', 'Z'], front).verdict, 'unknown-sector');
});

test('a one-sided portal is judged on its one sector', () => {
  const plane = [10, 1, 0, 0];
  const centroids = new Map([['A', { centroid: [20, 0, 0] }]]);
  // P:A_ — the normal points into A.
  let r = orientPortal(plane, ['A', ''], centroids);
  assert.strictEqual(r.verdict, 'front-named');
  assert.strictEqual(r.twoSided, false);
  assert.strictEqual(r.sB, null);
  // P:_A — A is the back side, so the same geometry is now back-named ...
  r = orientPortal(plane, ['', 'A'], centroids);
  assert.strictEqual(r.verdict, 'back-named');
  assert.strictEqual(r.sA, null);
  // ... and holds the convention once A is behind the plane.
  assert.strictEqual(orientPortal([-10, -1, 0, 0], ['', 'A'], centroids).verdict, 'front-named');
});

test('the fixture world walks its sector polygon back to its corners', () => {
  // `polygonCorners` is the planarity script's fan join, now taking the set of
  // polygons to read. Polygon 1 is the portal triangle over vertices 1, 2 and
  // 4 (pinned by test/portalPlanarity.test.js); polygon 2 is the sector
  // triangle over 4, 5 and 2 on the second material.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-orientation-'));
  const file = path.join(dir, 'portals.g2.zen');
  zenkit._authorFixtureWorld(file, 'binsafe', 'g2', 'mesh-extraction');
  try {
    const handle = zenkit.loadWorld(file, 'g2');
    const found = polygonCorners(zenkit, handle, new Map([[1, 'portal'], [2, 'sector']]));
    assert.strictEqual(found.flagMismatches, 0);
    assert.strictEqual(found.unjoined, 0);
    assert.deepStrictEqual(found.polygons.map((p) => [p.polygonIndex, p.tag, p.corners]), [
      [1, 'portal', [[10, 0, 0], [10, 0, 10], [20, 0, 0]]],
      [2, 'sector', [[20, 0, 0], [20, 0, 10], [10, 0, 10]]],
    ]);

    // The fixture names neither a P: nor an S: material, so the measurement
    // over it finds nothing to judge — and says so rather than judging the
    // portal-flagged EX_STONE triangle.
    const measured = measureOrientation(zenkit, handle);
    assert.strictEqual(measured.otherPortalKinds, 1);
    assert.strictEqual(measured.sectorPolygons, 0);
    assert.strictEqual(measured.results.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
