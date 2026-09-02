'use strict';

// How far off its own plane does a retail portal polygon sit?
// (level-editor.md §16.22, question 2.)
//
// A coplanarity check needs a tolerance, and a tolerance invented rather than
// measured flags shipped geometry. The worst deviation across the three retail
// worlds' portal polygons *is* the tolerance — and if retail portals turn out
// to be arbitrarily non-planar, the honest outcome is to write that down and
// write no check at all (§16.22, "a measurement is allowed to kill its own
// check").
//
// Two numbers per polygon, because they answer different questions:
//
//   spread     max(n·p) - min(n·p) over the corners, with `n` the stored plane
//              normal. How far from flat the polygon itself is. Independent of
//              how the stored plane distance is signed, so it is the number a
//              coplanarity check would take its tolerance from.
//   worstAlong max |n·p - d|. Whether the *stored* plane is the polygon's own.
//              Its mirror `worstAgainst` (|n·p + d|) is reported beside it so
//              the sign convention of `plane_distance` is read off the corpus
//              rather than assumed.
//
// The join is the interesting part and it is checked, not trusted. `getPortals`
// names a portal polygon by its mesh index and `_drillMesh` gives that polygon
// its plane, material and corner count, but neither carries vertex positions —
// the binding exposes those only through `extractWorldMesh`, which is per
// material, fan-triangulated and in mesh order. So the walk counts triangles
// per material to find where a polygon's fan starts, and verifies every
// triangle it lands on carries that polygon's own packed flag word. A mismatch
// means the arithmetic is wrong, and the run says so instead of reporting
// numbers.
//
//   node scripts/check-portal-planarity.js --world "<...>\OldWorld\OldWorld.zen"
//
// Developer-local: it needs a real installation. Nothing in CI runs it.

const path = require('node:path');

// Polygons per `_drillMesh` call. The retail world meshes are ~200k polygons
// and every one of them has to be walked to know where the next fan starts.
const WINDOW = 20000;

/**
 * The chunk-vertex indices of one fan-triangulated polygon, in corner order.
 * ExtractMesh emits (root, root+a, root+b) for a = 1..n-2, so corner 0 and
 * corner 1 are the first triangle's first two, and every corner after that is
 * the third vertex of its own triangle.
 *
 * Null when the fan runs past the end of the chunk — that is a broken join,
 * not a short polygon, and the caller counts it rather than measuring it.
 */
function fanCornerIndices(indices, triangleOffset, cornerCount) {
  const triangles = cornerCount - 2;
  const start = triangleOffset * 3;
  if (triangles < 1 || start + triangles * 3 > indices.length) return null;

  const corners = [indices[start], indices[start + 1]];
  for (let t = 0; t < triangles; t += 1) corners.push(indices[start + t * 3 + 2]);
  return corners;
}

/**
 * How far the corners stray from flat, and from the plane stored with them.
 * `plane` is `_drillMesh`'s on-disk field order: [distance, nx, ny, nz].
 */
function planeDeviation(corners, plane) {
  const [distance, nx, ny, nz] = plane;
  const normalLength = Math.hypot(nx, ny, nz);
  if (normalLength === 0) {
    return { normalLength, spread: null, worstAlong: null, worstAgainst: null };
  }

  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, y, z] of corners) {
    const projection = (x * nx + y * ny + z * nz) / normalLength;
    if (projection < lo) lo = projection;
    if (projection > hi) hi = projection;
  }

  const d = distance / normalLength;
  return {
    normalLength,
    spread: hi - lo,
    worstAlong: Math.max(Math.abs(hi - d), Math.abs(lo - d)),
    worstAgainst: Math.max(Math.abs(hi + d), Math.abs(lo + d)),
  };
}

/**
 * The corner positions and stored plane of every polygon in `wanted` — a Map
 * from mesh polygon index to whatever tag the caller wants back on the row.
 * This is the fan join described above; `check-portal-orientation.js` rides
 * the same walk for its sector polygons.
 *
 * `zenkit` is passed in rather than required here so the join can be exercised
 * against a fixture world from the test suite.
 */
function polygonCorners(zenkit, handle, wanted) {
  const chunks = new Map(); // material index -> { positions, indices, flags }
  for (const chunk of zenkit.extractWorldMesh(handle).chunks) {
    chunks.set(chunk.materialIndex, {
      positions: new Float32Array(chunk.positions),
      indices: new Uint32Array(chunk.indices),
      flags: new Uint32Array(chunk.flags),
    });
  }

  const triangleCursor = new Map(); // material index -> triangles emitted so far
  const polygons = [];
  let flagMismatches = 0;
  let unjoined = 0;

  for (let offset = 0; ; offset += WINDOW) {
    const drill = zenkit._drillMesh(handle, { offset, limit: WINDOW });
    if (drill.geometry.length === 0) break;

    for (let i = 0; i < drill.geometry.length; i += 1) {
      const polygon = drill.geometry[i];
      const cornerCount = polygon.vertexIndices.length;
      const chunk = chunks.get(polygon.material);
      // Exactly ExtractMesh's own two skips: a polygon with fewer than three
      // corners, or one naming a material the mesh does not declare, emits no
      // triangles and so must not advance the cursor either.
      if (cornerCount < 3 || chunk === undefined) continue;

      const triangleOffset = triangleCursor.get(polygon.material) ?? 0;
      triangleCursor.set(polygon.material, triangleOffset + cornerCount - 2);

      const polygonIndex = offset + i;
      if (!wanted.has(polygonIndex)) continue;

      const cornerIndices = fanCornerIndices(chunk.indices, triangleOffset, cornerCount);
      if (cornerIndices === null) { unjoined += 1; continue; }

      // The join, verified: every triangle of this fan must carry the packed
      // flag word `_drillMesh` reports for the polygon itself.
      let matched = true;
      for (let t = 0; t < cornerCount - 2; t += 1) {
        if (chunk.flags[triangleOffset + t] !== polygon.flagsBits) matched = false;
      }
      if (!matched) { flagMismatches += 1; continue; }

      polygons.push({
        polygonIndex,
        material: polygon.material,
        cornerCount,
        sectorIndex: polygon.sectorIndex,
        tag: wanted.get(polygonIndex),
        plane: polygon.plane,
        corners: cornerIndices.map((v) => [
          chunk.positions[v * 3], chunk.positions[v * 3 + 1], chunk.positions[v * 3 + 2],
        ]),
      });
    }

    if (offset + drill.geometry.length >= drill.polyCount) break;
  }

  return { polygons, flagMismatches, unjoined };
}

/** Every portal polygon of a world with its corner positions and stored plane. */
function portalPolygonCorners(zenkit, handle) {
  const portals = zenkit.getPortals(handle);
  const polygonIndices = new Uint32Array(portals.polygonIndices);
  const portalKinds = new Uint8Array(portals.portalKinds);
  const wanted = new Map(); // mesh polygon index -> portal kind
  let sectorPolygons = 0;
  for (let i = 0; i < polygonIndices.length; i += 1) {
    if (portalKinds[i] === 0) sectorPolygons += 1;
    else wanted.set(polygonIndices[i], portalKinds[i]);
  }

  const found = polygonCorners(zenkit, handle, wanted);
  for (const polygon of found.polygons) polygon.portalKind = polygon.tag;
  return { ...found, sectorPolygons, polyCount: portals.polyCount };
}

/** Deviations bucketed by decade, so the tail is visible and not just the max. */
function histogram(values) {
  const buckets = new Map();
  for (const value of values) {
    const key = value === 0 ? '0' : `1e${Math.floor(Math.log10(value))}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return buckets;
}

function parseArgs(argv) {
  let world = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--world') world = argv[i + 1];
  }
  if (!world) throw new Error('usage: check-portal-planarity.js --world <a.zen>');
  return { world };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const zenkit = require('..');

  const handle = zenkit.loadWorld(args.world, 'g2');
  const found = portalPolygonCorners(zenkit, handle);

  const row = (label, value) => console.log(`  ${String(label).padEnd(34)}${value}`);
  console.log(`\n${path.basename(args.world)} — portal polygons against their planes\n`);
  row('mesh polygons', found.polyCount);
  row('portal polygons', found.polygons.length);
  row('  sector-only rows (not measured)', found.sectorPolygons);
  row('  unjoined', found.unjoined);
  row('  flag mismatches', found.flagMismatches);

  if (found.flagMismatches > 0 || found.unjoined > 0) {
    console.log('\nThe fan join did not hold. The numbers below are not evidence.');
  }

  const corners = new Map();
  const spreads = [];
  const along = [];
  let unitNormals = 0;
  let againstIsCloser = 0;

  for (const polygon of found.polygons) {
    corners.set(polygon.cornerCount, (corners.get(polygon.cornerCount) ?? 0) + 1);
    const deviation = planeDeviation(polygon.corners, polygon.plane);
    if (deviation.spread === null) continue;
    if (Math.abs(deviation.normalLength - 1) < 1e-4) unitNormals += 1;
    if (deviation.worstAgainst < deviation.worstAlong) againstIsCloser += 1;
    spreads.push(deviation.spread);
    along.push(deviation.worstAlong);
  }

  row('unit-length plane normals', `${unitNormals} of ${spreads.length}`);
  row('|n·p + d| closer than |n·p - d|', againstIsCloser);

  console.log('\n  corners per polygon');
  for (const count of [...corners.keys()].sort((a, b) => a - b)) {
    console.log(`    ${String(count).padEnd(32)}${corners.get(count)}`);
  }

  for (const [label, values] of [['spread off flat', spreads], ['|n.p - d|', along]]) {
    const sorted = [...values].sort((a, b) => a - b);
    console.log(`\n  ${label}`);
    if (sorted.length === 0) { console.log('    (nothing measured)'); continue; }
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    console.log(`    max ${sorted[sorted.length - 1]}  p99 ${at(0.99)}  ` +
      `median ${at(0.5)}  min ${sorted[0]}`);
    const buckets = histogram(sorted);
    for (const key of [...buckets.keys()].sort()) {
      console.log(`    ${key.padEnd(32)}${buckets.get(key)}`);
    }
  }
}

module.exports = { fanCornerIndices, planeDeviation, polygonCorners, portalPolygonCorners };

if (require.main === module) main();
