'use strict';

// Which of a portal polygon's two sectors does its stored normal point into?
// (level-editor.md §16.22, question 3.)
//
// ZenGin names a portal face `P:A_B` and its reverse `P:B_A` (q1: retail is
// 100% paired). The stored plane is the polygon's own and `n·p = d` (q2). What
// neither answered is the sign: whether `n` points into the first-named sector
// or the second — and whether it does so *consistently*, which is what an
// orientation check would have to assume. A convention invented rather than
// measured flags shipped geometry; if retail turns out to be mixed, the honest
// outcome is to write that down and write no check (§16.22, "a measurement is
// allowed to kill its own check").
//
// Sector geometry comes from the mesh itself, and needed no C++: a sector's
// polygons carry the material `S:<sector>_<material>` — `is_sector` set,
// `is_portal` 0 — and no sector name contains an underscore (§16.18), so the
// prefix up to the first one is the sector. (`sector_index` is -1 on every
// retail polygon and `bsp.portal_polygon_indices` is empty in every retail
// world, so neither is a membership.) A sector's centroid is the mean of its
// polygons' corners, and the number per portal is the signed distance of
// each named sector's centroid from the stored plane:
//
//   s = n·c - d      > 0 in front of the polygon (the side `n` points into)
//
// `front-named`: A in front, B behind — the normal points into the sector
// named first. `back-named`: the reverse. Anything else is ambiguous and is
// counted by name rather than folded into either. A one-sided name (`P:A_`,
// `P:_B`; the empty side is outdoors, which has no `S:` polygons) is judged
// on its one sector and reported apart, so the two-sided count stands alone.
//
// The corners come off the fan join `check-portal-planarity.js` verified, so
// the same flag-mismatch and unjoined counts guard this run.
//
//   node scripts/check-portal-orientation.js --world "<...>\OldWorld\OldWorld.zen"
//
// Developer-local: it needs a real installation. Nothing in CI runs it.

const path = require('node:path');

const { polygonCorners } = require('./check-portal-planarity.js');
const { sidesOf } = require('./check-portal-pairing.js');

/** The sector an `S:<sector>_<material>` polygon belongs to, uppercased, or null. */
function sectorOf(material) {
  const upper = material.toUpperCase();
  if (!upper.startsWith('S:')) return null;
  const separator = upper.indexOf('_', 2);
  if (separator <= 2) return null;
  return upper.slice(2, separator);
}

/**
 * Per sector name: the mean of every corner of every polygon, and the corners
 * themselves. The centroid decides; the corners are kept so an ambiguous
 * verdict can be read against how much of the sector is on each side.
 */
function sectorCentroids(sectorPolygons) {
  const sums = new Map(); // sector -> { x, y, z, corners, polygons }
  for (const { sector, corners } of sectorPolygons) {
    let entry = sums.get(sector);
    if (!entry) {
      entry = { x: 0, y: 0, z: 0, corners: [], polygons: 0 };
      sums.set(sector, entry);
    }
    entry.polygons += 1;
    for (const corner of corners) {
      entry.x += corner[0];
      entry.y += corner[1];
      entry.z += corner[2];
      entry.corners.push(corner);
    }
  }
  const centroids = new Map();
  for (const [sector, e] of sums) {
    const n = e.corners.length;
    centroids.set(sector, {
      centroid: [e.x / n, e.y / n, e.z / n],
      polygons: e.polygons,
      corners: e.corners,
    });
  }
  return centroids;
}

/** Signed distance of a point from a stored plane [distance, nx, ny, nz]. */
function sideOf(plane, [x, y, z]) {
  const [d, nx, ny, nz] = plane;
  return (x * nx + y * ny + z * nz) / Math.hypot(nx, ny, nz) - d;
}

/**
 * One portal polygon against its named sectors. `sides` is `sidesOf`'s pair;
 * `centroids` is `sectorCentroids`'s map. Returns the verdict and the signed
 * distances so a run can show its margins, not just its counts.
 */
function orientPortal(plane, sides, centroids) {
  const [a, b] = sides;
  const twoSided = a !== '' && b !== '';
  const distance = (name) => {
    if (name === '') return null;
    const sector = centroids.get(name);
    return sector ? sideOf(plane, sector.centroid) : undefined;
  };
  // The share of a sector's corners in front of the plane — 1 when the whole
  // sector is on the side the normal points into. Not the verdict; the
  // reading an ambiguous centroid is checked against.
  const share = (name) => {
    if (name === '') return null;
    const sector = centroids.get(name);
    if (!sector || !sector.corners) return undefined;
    let front = 0;
    for (const corner of sector.corners) if (sideOf(plane, corner) > 0) front += 1;
    return front / sector.corners.length;
  };
  const sA = distance(a);
  const sB = distance(b);
  const fA = share(a);
  const fB = share(b);
  if (sA === undefined || sB === undefined) {
    return { twoSided, sA, sB, fA, fB, verdict: 'unknown-sector' };
  }

  let verdict;
  if (twoSided) {
    if (sA > 0 && sB < 0) verdict = 'front-named';
    else if (sA < 0 && sB > 0) verdict = 'back-named';
    else if (sA > 0 && sB > 0) verdict = 'both-in-front';
    else if (sA < 0 && sB < 0) verdict = 'both-behind';
    else verdict = 'on-plane';
  } else {
    // `P:A_`: the normal points into A iff A is in front. `P:_B`: the front
    // side is the unnamed outdoors, so the convention holds iff B is behind.
    const s = a !== '' ? sA : -sB;
    verdict = s > 0 ? 'front-named' : s < 0 ? 'back-named' : 'on-plane';
  }
  return { twoSided, sA, sB, fA, fB, verdict };
}

/**
 * The whole measurement over one world. `zenkit` is passed in so the walk can
 * be exercised against a fixture world from the test suite.
 */
function measureOrientation(zenkit, handle) {
  const materials = new Map(); // material index -> name
  for (const chunk of zenkit.extractWorldMesh(handle).chunks) {
    materials.set(chunk.materialIndex, chunk.name);
  }

  const portals = zenkit.getPortals(handle);
  const polygonIndices = new Uint32Array(portals.polygonIndices);
  const materialIndices = new Uint32Array(portals.materialIndices);
  const portalKinds = new Uint8Array(portals.portalKinds);

  // mesh polygon index -> { sides } for a P: face, { sector } for an S: face
  const wanted = new Map();
  let malformed = 0;
  let otherPortalKinds = 0;
  for (let i = 0; i < polygonIndices.length; i += 1) {
    const name = materials.get(materialIndices[i]) ?? '';
    if (portalKinds[i] !== 0) {
      if (!name.toUpperCase().startsWith('P:')) { otherPortalKinds += 1; continue; }
      const sides = sidesOf(name);
      if (sides === null) { malformed += 1; continue; }
      wanted.set(polygonIndices[i], { sides, kind: portalKinds[i], material: name });
    } else {
      const sector = sectorOf(name);
      if (sector !== null) wanted.set(polygonIndices[i], { sector });
    }
  }

  const found = polygonCorners(zenkit, handle, wanted);
  const sectorPolygons = [];
  const portalPolygons = [];
  for (const polygon of found.polygons) {
    if (polygon.tag.sector !== undefined) {
      sectorPolygons.push({ sector: polygon.tag.sector, corners: polygon.corners });
    } else {
      portalPolygons.push(polygon);
    }
  }

  const centroids = sectorCentroids(sectorPolygons);
  const results = portalPolygons.map((polygon) => ({
    polygonIndex: polygon.polygonIndex,
    material: polygon.tag.material,
    kind: polygon.tag.kind,
    ...orientPortal(polygon.plane, polygon.tag.sides, centroids),
  }));

  return {
    polyCount: portals.polyCount,
    flagMismatches: found.flagMismatches,
    unjoined: found.unjoined,
    otherPortalKinds,
    malformed,
    sectorPolygons: sectorPolygons.length,
    centroids,
    results,
  };
}

function parseArgs(argv) {
  let world = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--world') world = argv[i + 1];
  }
  if (!world) throw new Error('usage: check-portal-orientation.js --world <a.zen>');
  return { world };
}

const decided = (r) => r.verdict === 'front-named' || r.verdict === 'back-named';

function main() {
  const args = parseArgs(process.argv.slice(2));
  const zenkit = require('..');

  const handle = zenkit.loadWorld(args.world, 'g2');
  const found = measureOrientation(zenkit, handle);

  const row = (label, value) => console.log(`  ${String(label).padEnd(34)}${value}`);
  console.log(`\n${path.basename(args.world)} — portal normals against their sectors\n`);
  row('mesh polygons', found.polyCount);
  row('sectors with S: polygons', found.centroids.size);
  row('  S: polygons', found.sectorPolygons);
  row('P: portal polygons', found.results.length);
  row('  portal-flagged, not P: (skipped)', found.otherPortalKinds);
  row('  malformed P: names (skipped)', found.malformed);
  row('  unjoined', found.unjoined);
  row('  flag mismatches', found.flagMismatches);

  if (found.flagMismatches > 0 || found.unjoined > 0) {
    console.log('\nThe fan join did not hold. The numbers below are not evidence.');
  }

  for (const twoSided of [true, false]) {
    const subset = found.results.filter((r) => r.twoSided === twoSided);
    console.log(`\n  ${twoSided ? 'two-sided P:A_B' : 'one-sided P:A_ / P:_B'}: ${subset.length}`);
    const verdicts = new Map();
    for (const r of subset) verdicts.set(r.verdict, (verdicts.get(r.verdict) ?? 0) + 1);
    for (const [verdict, count] of [...verdicts].sort((x, y) => y[1] - x[1])) {
      const pct = subset.length ? ((100 * count) / subset.length).toFixed(1) : '0.0';
      console.log(`    ${verdict.padEnd(30)}${String(count).padStart(6)}  ${pct}%`);
    }
    // Every row that is not the convention, by name — the exceptions and the
    // ambiguous alike — with how much of each sector sits in front.
    for (const r of subset) {
      if (r.verdict === 'front-named') continue;
      const show = (s) => (typeof s === 'number' ? s.toFixed(1) : String(s));
      const pct = (f) => (typeof f === 'number' ? `${(100 * f).toFixed(0)}% in front` : String(f));
      console.log(`      polygon ${r.polygonIndex} ${r.material} kind ${r.kind}: ` +
        `${r.verdict} (sA ${show(r.sA)}, sB ${show(r.sB)}; A ${pct(r.fA)}, B ${pct(r.fB)})`);
    }
  }

  const ambiguous = found.results.filter((r) => !decided(r) && r.twoSided);
  const leaning = ambiguous.filter((r) => typeof r.fA === 'number' && r.fA > r.fB);
  if (ambiguous.length > 0) {
    console.log('');
    row('ambiguous two-sided rows', ambiguous.length);
    row('  where more of A than of B is in front', leaning.length);
  }

  const byKind = new Map();
  for (const r of found.results) {
    const key = `is_portal ${r.kind}, ${r.verdict}`;
    byKind.set(key, (byKind.get(key) ?? 0) + 1);
  }
  console.log('\n  by is_portal value');
  for (const key of [...byKind.keys()].sort()) {
    console.log(`    ${key.padEnd(32)}${byKind.get(key)}`);
  }

  const margins = found.results
    .filter(decided)
    .map((r) => Math.min(...[r.sA, r.sB].filter((s) => s !== null).map(Math.abs)))
    .sort((a, b) => a - b);
  if (margins.length > 0) {
    const at = (q) => margins[Math.min(margins.length - 1, Math.floor(q * margins.length))];
    console.log('\n  nearest sector centroid to its portal plane (decided rows)');
    console.log(`    min ${margins[0].toFixed(1)}  p1 ${at(0.01).toFixed(1)}  ` +
      `median ${at(0.5).toFixed(1)}  max ${margins[margins.length - 1].toFixed(1)}`);
  }
}

module.exports = { sectorOf, sectorCentroids, sideOf, orientPortal, measureOrientation };

if (require.main === module) main();
