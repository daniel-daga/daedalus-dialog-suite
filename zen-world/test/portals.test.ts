// The portal checks that ride `getPortals` (level-editor.md §16.20 slice 3,
// §16.22 q1–q3). Every threshold below is the one the measurement tranche
// recorded over the retail G2 worlds; none is invented here.

import {
  PORTAL_ONE_SIDED_MIN_SHARE,
  PORTAL_PLANARITY_TOLERANCE,
  checkPortalOrientation,
  checkPortalPairing,
  checkPortalPlanarity,
  checkPortals,
  portalRows,
  type PortalPolygons,
} from '../src/validate';

/** One authored row of the readout: a polygon carrying portal metadata. */
interface Row {
  polygon: number;
  material: number;
  /** `is_portal`, 0 for a sector face. */
  kind?: number;
  sector?: boolean;
  sectorIndex?: number;
  /** On-disk order [distance, nx, ny, nz]. */
  plane: [number, number, number, number];
  corners: Array<[number, number, number]>;
}

/** The columnar payload `getPortals` emits, built from readable rows. */
function payloadOf(
  rows: Row[],
  materials: string[],
  sectorNames: string[] = [],
): PortalPolygons {
  const cornerOffsets = [0];
  const corners: number[] = [];
  for (const row of rows) {
    for (const corner of row.corners) corners.push(...corner);
    cornerOffsets.push(corners.length / 3);
  }
  return {
    polyCount: Math.max(0, ...rows.map((r) => r.polygon + 1)),
    count: rows.length,
    polygonIndices: Uint32Array.from(rows.map((r) => r.polygon)).buffer,
    materialIndices: Uint32Array.from(rows.map((r) => r.material)).buffer,
    sectorIndices: Int32Array.from(rows.map((r) => r.sectorIndex ?? -1)).buffer,
    portalKinds: Uint8Array.from(rows.map((r) => r.kind ?? (r.sector ? 0 : 1))).buffer,
    sectorFlags: Uint8Array.from(rows.map((r) => (r.sector ? 1 : 0))).buffer,
    bspPortalPolygons: new Uint32Array(0).buffer,
    planes: Float32Array.from(rows.flatMap((r) => r.plane)).buffer,
    cornerOffsets: Uint32Array.from(cornerOffsets).buffer,
    corners: Float32Array.from(corners).buffer,
    materials,
    sectorNames,
  };
}

/** A quad in the plane x = `x`, facing +x, spanning y and z from 0 to `size`. */
const wallAt = (x: number, size = 100): Array<[number, number, number]> => [
  [x, 0, 0], [x, size, 0], [x, size, size], [x, 0, size],
];

/** A sector face — `S:<sector>_<material>` — as one triangle at `x`. */
const sectorFace = (polygon: number, material: number, x: number): Row => ({
  polygon, material, sector: true, plane: [0, 0, 1, 0],
  corners: [[x, 0, 0], [x + 10, 0, 0], [x, 0, 10]],
});

describe('portalRows', () => {
  it('reads the columns back into one row per polygon, names joined', () => {
    const payload = payloadOf([
      { polygon: 7, material: 1, plane: [10, 1, 0, 0], corners: wallAt(10) },
      sectorFace(9, 0, 50),
    ], ['S:A_STONE', 'P:A_B'], ['A', 'B']);

    expect(portalRows(payload)).toEqual([
      {
        polygon: 7, material: 'P:A_B', kind: 1, sector: false, sectorIndex: -1,
        plane: [10, 1, 0, 0], corners: wallAt(10),
      },
      {
        polygon: 9, material: 'S:A_STONE', kind: 0, sector: true, sectorIndex: -1,
        plane: [0, 0, 1, 0], corners: [[50, 0, 0], [60, 0, 0], [50, 0, 10]],
      },
    ]);
  });
});

describe('checkPortalPairing', () => {
  it('accepts a world in which every name has its mirror — retail is 100 % paired', () => {
    // §16.22 q1: 572 names, 286 pairs, not one unpaired. The one-sided names
    // pair the same way: `P:OWCAVE01_` mirrors `P:_OWCAVE01`.
    expect(checkPortalPairing({ materials: [
      'P:RICEB01_RICEB02', 'P:RICEB02_RICEB01', 'P:OWCAVE01_', 'P:_OWCAVE01', 'OWODWALL',
    ] })).toEqual([]);
  });

  it('reports a name whose mirror is missing, and says which name it wanted', () => {
    expect(checkPortalPairing({ materials: ['P:RICEB01_RICEB02', 'P:_OWCAVE01'] })).toEqual([
      { kind: 'portal-unpaired', material: 'P:RICEB01_RICEB02', wanted: 'P:RICEB02_RICEB01' },
      { kind: 'portal-unpaired', material: 'P:_OWCAVE01', wanted: 'P:OWCAVE01_' },
    ]);
  });

  it('matches the mirror without regard to case, as the material check does', () => {
    expect(checkPortalPairing({ materials: ['P:riceb01_RICEB02', 'p:RICEB02_riceb01'] })).toEqual([]);
  });

  it('leaves a malformed name to the material check rather than calling it unpaired', () => {
    // `P:_` and `P:A_B_C` have no mirror to look for; `checkPortalMaterials`
    // already reports them and a second finding on the same name is noise.
    expect(checkPortalPairing({ materials: ['P:_', 'P:A_B_C', 'P:NOSEP'] })).toEqual([]);
  });

  it('counts a symmetric name as its own mirror', () => {
    // No retail world has one, so nothing measured says it is wrong.
    expect(checkPortalPairing({ materials: ['P:A_A'] })).toEqual([]);
  });
});

describe('checkPortalPlanarity', () => {
  it('holds the tolerance §16.22 q2 recorded — the worst shipped polygon is 12.1 units off flat', () => {
    expect(PORTAL_PLANARITY_TOLERANCE).toBe(12.1);
  });

  it('accepts a flat polygon and one within the tolerance', () => {
    const flat: Row = { polygon: 1, material: 0, plane: [10, 1, 0, 0], corners: wallAt(10) };
    // A quad with one corner 12 off the plane — OldWorld ships a 12.10.
    const shipped: Row = {
      polygon: 2, material: 0, plane: [10, 1, 0, 0],
      corners: [[10, 0, 0], [10, 100, 0], [22, 100, 100], [10, 0, 100]],
    };
    expect(checkPortalPlanarity(portalRows(payloadOf([flat, shipped], ['P:A_B'])))).toEqual([]);
  });

  it('reports a polygon folded past the tolerance, with how far', () => {
    const folded: Row = {
      polygon: 3, material: 0, plane: [10, 1, 0, 0],
      corners: [[10, 0, 0], [10, 100, 0], [40, 100, 100], [10, 0, 100]],
    };
    expect(checkPortalPlanarity(portalRows(payloadOf([folded], ['P:A_B'])))).toEqual([
      { kind: 'portal-non-planar', polygon: 3, material: 'P:A_B', spread: 30 },
    ]);
  });

  it('measures the spread along the stored normal whatever its length or sign', () => {
    // Spread is max(n·p) − min(n·p) over the corners with the *unit* normal,
    // so it does not depend on how `plane_distance` is signed or on a normal
    // that is not unit length (every retail one is; the check must not rely
    // on it).
    const row: Row = {
      polygon: 4, material: 0, plane: [-10, -2, 0, 0],
      corners: [[10, 0, 0], [10, 100, 0], [40, 100, 100], [10, 0, 100]],
    };
    expect(checkPortalPlanarity(portalRows(payloadOf([row], ['P:A_B'])))[0].spread).toBe(30);
  });

  it('measures portal faces only — a sector face is not a portal', () => {
    const folded = { ...sectorFace(5, 0, 0), corners: [[0, 0, 0], [10, 0, 0], [0, 50, 10]] as Array<[number, number, number]> };
    expect(checkPortalPlanarity(portalRows(payloadOf([folded], ['S:A_STONE'])))).toEqual([]);
  });

  it('says nothing about a polygon whose stored normal is zero', () => {
    const row: Row = { polygon: 6, material: 0, plane: [0, 0, 0, 0], corners: wallAt(10) };
    expect(checkPortalPlanarity(portalRows(payloadOf([row], ['P:A_B'])))).toEqual([]);
  });
});

describe('checkPortalOrientation', () => {
  // The convention §16.22 q3 measured: the stored normal points into the
  // first-named sector. Sector A lies at x > 10, sector B at x < 10, and the
  // portal is the wall x = 10 facing +x — so `P:A_B` is right and `P:B_A` is
  // reversed.
  const wall = (polygon: number, material: number, facing: 1 | -1 = 1): Row => ({
    polygon, material, plane: [10 * facing, facing, 0, 0], corners: wallAt(10),
  });
  const sectors = [sectorFace(10, 2, 50), sectorFace(11, 2, 80), sectorFace(12, 3, -50)];
  const MATERIALS = ['P:A_B', 'P:B_A', 'S:A_STONE', 'S:B_STONE'];

  it('accepts a two-sided portal whose normal points into the first-named sector', () => {
    expect(checkPortalOrientation(portalRows(payloadOf([wall(1, 0), ...sectors], MATERIALS))))
      .toEqual([]);
    // Its mirror faces the other way, into B, and is right too.
    expect(checkPortalOrientation(portalRows(payloadOf([wall(2, 1, -1), ...sectors], MATERIALS))))
      .toEqual([]);
  });

  it('reports a two-sided portal facing the second-named sector', () => {
    expect(checkPortalOrientation(portalRows(payloadOf([wall(2, 1), ...sectors], MATERIALS))))
      .toEqual([{ kind: 'portal-reversed', polygon: 2, material: 'P:B_A', sector: 'B' }]);
  });

  it('judges by corner share, not centroid — nested sectors put both centroids on one side', () => {
    // §16.22 q3: `P:HH1_HH7`-style nested sectors have both centroids in
    // front of the plane, and a centroid test flags retail. A has three
    // corners in front of x = 10 and one behind; B has two of four in front,
    // so both centroids are in front. More of A than of B is in front, and
    // that is the convention holding.
    const nested = [
      { ...sectorFace(10, 2, 50), corners: [[50, 0, 0], [60, 0, 0], [70, 0, 10], [5, 0, 0]] as Array<[number, number, number]> },
      { ...sectorFace(12, 3, 20), corners: [[20, 0, 0], [30, 0, 0], [5, 0, 10], [0, 0, 0]] as Array<[number, number, number]> },
    ];
    expect(checkPortalOrientation(portalRows(payloadOf([wall(1, 0), ...nested], MATERIALS))))
      .toEqual([]);
    expect(checkPortalOrientation(portalRows(payloadOf([wall(2, 1), ...nested], MATERIALS))))
      .toEqual([{ kind: 'portal-reversed', polygon: 2, material: 'P:B_A', sector: 'B' }]);
  });

  it('judges a one-sided portal on its one sector', () => {
    // `P:A_`: the normal points into A. `P:_A`: the front is the unnamed
    // outdoors, so A must be behind.
    const oneSided = ['P:A_', 'P:_A', 'S:A_STONE'];
    const faces = [sectorFace(10, 2, 50), sectorFace(11, 2, 80)];
    expect(checkPortalOrientation(portalRows(payloadOf([wall(1, 0), ...faces], oneSided))))
      .toEqual([]);
    expect(checkPortalOrientation(portalRows(payloadOf([wall(2, 1, -1), ...faces], oneSided))))
      .toEqual([]);
    expect(checkPortalOrientation(portalRows(payloadOf([wall(2, 1), ...faces], oneSided))))
      .toEqual([{ kind: 'portal-reversed', polygon: 2, material: 'P:_A', sector: 'A' }]);
    expect(checkPortalOrientation(portalRows(payloadOf([wall(1, 0, -1), ...faces], oneSided))))
      .toEqual([{ kind: 'portal-reversed', polygon: 1, material: 'P:A_', sector: 'A' }]);
  });

  it('accepts a one-sided portal on the edge of a large sector — retail ships 28 %', () => {
    // §16.22 q3's corner-share re-run: `P:GRPTURM01_` has 28.4 % of its sector
    // on the convention's side and is shipped; `P:CAPTAIN_` has 0.8 % and is
    // the one retail portal that reads as reversed. The cut sits between.
    expect(PORTAL_ONE_SIDED_MIN_SHARE).toBe(0.25);
    const oneSided = ['P:A_', 'P:_A', 'S:A_STONE'];
    // Three of ten corners in front of the wall at x = 10.
    const edge = { ...sectorFace(10, 2, 0), corners: [
      [20, 0, 0], [30, 0, 0], [40, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0], [5, 0, 0], [6, 0, 0],
    ] as Array<[number, number, number]> };
    expect(checkPortalOrientation(portalRows(payloadOf([wall(1, 0), edge], oneSided)))).toEqual([]);
    expect(checkPortalOrientation(portalRows(payloadOf([wall(2, 1, -1), edge], oneSided)))).toEqual([]);
    // Two of ten, and it is reversed.
    const reversed = { ...edge, corners: edge.corners.slice(1) };
    expect(checkPortalOrientation(portalRows(payloadOf([wall(1, 0), reversed], oneSided))))
      .toEqual([{ kind: 'portal-reversed', polygon: 1, material: 'P:A_', sector: 'A' }]);
  });

  it('says nothing when a named sector has no faces, or the shares tie', () => {
    // A sector with no `S:` polygons cannot be placed; that a name is unknown
    // is `checkPortalMaterials`' finding, not this one's.
    expect(checkPortalOrientation(portalRows(payloadOf([wall(1, 0)], MATERIALS)))).toEqual([]);
    // Both sectors wholly in front: no more of one than of the other.
    const tied = [sectorFace(10, 2, 50), sectorFace(12, 3, 60)];
    expect(checkPortalOrientation(portalRows(payloadOf([wall(1, 0), ...tied], MATERIALS)))).toEqual([]);
  });
});

describe('checkPortals', () => {
  it('runs every check over one payload and gives each finding a polygon', () => {
    const payload = payloadOf([
      // Unknown sector Z, and no mirror `P:Z_A`.
      { polygon: 1, material: 0, plane: [10, 1, 0, 0], corners: wallAt(10) },
      // Folded, and reversed (B is at x < 10).
      { polygon: 2, material: 1, plane: [10, 1, 0, 0],
        corners: [[10, 0, 0], [10, 100, 0], [40, 100, 100], [10, 0, 100]] },
      sectorFace(10, 2, 50), sectorFace(12, 3, -50),
    ], ['P:A_Z', 'P:B_A', 'S:A_STONE', 'S:B_STONE'], ['A', 'B']);

    expect(checkPortals(payload)).toEqual([
      { kind: 'portal-material-unknown-sector', material: 'P:A_Z', sector: 'Z', polygon: 1 },
      { kind: 'portal-unpaired', material: 'P:A_Z', wanted: 'P:Z_A', polygon: 1 },
      { kind: 'portal-unpaired', material: 'P:B_A', wanted: 'P:A_B', polygon: 2 },
      { kind: 'portal-non-planar', material: 'P:B_A', polygon: 2, spread: 30 },
      { kind: 'portal-reversed', material: 'P:B_A', polygon: 2, sector: 'B' },
    ]);
  });

  it('gives a material finding no polygon when no portal face carries the material', () => {
    // A `P:` material every polygon has stopped referencing is still in the
    // list — the mesh keeps unused materials — and still a finding.
    const payload = payloadOf([], ['P:_'], []);
    expect(checkPortals(payload)).toEqual([
      { kind: 'portal-material-malformed', material: 'P:_', polygon: null },
    ]);
  });

  it('finds nothing in a world with no portals', () => {
    expect(checkPortals(payloadOf([], ['OWODWALL'], []))).toEqual([]);
  });
});
