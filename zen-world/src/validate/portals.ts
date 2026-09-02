// The portal checks that need `getPortals` (level-editor.md §16.20 slice 3 and
// §16.22): pairing (q1), planarity (q2) and orientation (q3), plus the one
// entry point `checkPortals` that runs them and `checkPortalMaterials` over the
// readout and pins each finding to a polygon.
//
// Every threshold and convention here was **measured**, not chosen — the
// measurement tranche's record is §16.22, and the numbers are cited where they
// are used. A check that flags retail flags shipped geometry.

import type { Vec3 } from '../coords';
import { checkPortalMaterials, type PortalMaterialProblem } from './portalMaterials';

/**
 * The `getPortals` readout: one row per polygon carrying portal metadata,
 * columnar, plus the two name lists its index columns point into and the
 * geometry the checks past the names need. ZenGin space, unconverted.
 */
export interface PortalPolygons {
  /** Polygons in the world mesh — what `polygonIndices` indexes. */
  polyCount: number;
  /** Rows below. */
  count: number;
  /** Uint32 ×1 — into the world mesh geometry. */
  polygonIndices: ArrayBuffer;
  /** Uint32 ×1 — into `materials`. */
  materialIndices: ArrayBuffer;
  /** Int32 ×1 — the on-disk i16, widened; -1 is "no sector". */
  sectorIndices: ArrayBuffer;
  /** Uint8 ×1 — `is_portal`, a two-bit ZenGin value, not a boolean. */
  portalKinds: ArrayBuffer;
  /** Uint8 ×1 — `is_sector`. */
  sectorFlags: ArrayBuffer;
  /** Uint32 ×1 — the BSP's `portal_polygon_indices`, stored order. */
  bspPortalPolygons: ArrayBuffer;
  /** Float32 ×4 per row — the stored plane, on-disk order [distance, nx, ny, nz]. */
  planes: ArrayBuffer;
  /** Uint32 ×(count + 1) — row `i`'s corners are `corners[offsets[i] .. offsets[i + 1])`. */
  cornerOffsets: ArrayBuffer;
  /** Float32 ×3 per corner. */
  corners: ArrayBuffer;
  /** `mesh.materials`' names, in the order polygons index them. */
  materials: readonly string[];
  /** `bsp.sectors`' names, stored order — `sectorIndices` indexes it. */
  sectorNames: readonly string[];
}

/** One row of the readout, with its names joined and its geometry read. */
export interface PortalRow {
  polygon: number;
  material: string;
  /** `is_portal`; 0 for a sector face. */
  kind: number;
  sector: boolean;
  sectorIndex: number;
  /** On-disk order [distance, nx, ny, nz]. */
  plane: readonly [number, number, number, number];
  corners: readonly Vec3[];
}

export function portalRows(payload: PortalPolygons): PortalRow[] {
  const polygonIndices = new Uint32Array(payload.polygonIndices);
  const materialIndices = new Uint32Array(payload.materialIndices);
  const sectorIndices = new Int32Array(payload.sectorIndices);
  const portalKinds = new Uint8Array(payload.portalKinds);
  const sectorFlags = new Uint8Array(payload.sectorFlags);
  const planes = new Float32Array(payload.planes);
  const offsets = new Uint32Array(payload.cornerOffsets);
  const corners = new Float32Array(payload.corners);

  const rows: PortalRow[] = [];
  for (let i = 0; i < payload.count; i += 1) {
    const rowCorners: Vec3[] = [];
    for (let c = offsets[i]; c < offsets[i + 1]; c += 1) {
      rowCorners.push([corners[c * 3], corners[c * 3 + 1], corners[c * 3 + 2]]);
    }
    rows.push({
      polygon: polygonIndices[i],
      material: payload.materials[materialIndices[i]] ?? '',
      kind: portalKinds[i],
      sector: sectorFlags[i] !== 0,
      sectorIndex: sectorIndices[i],
      plane: [planes[i * 4], planes[i * 4 + 1], planes[i * 4 + 2], planes[i * 4 + 3]],
      corners: rowCorners,
    });
  }
  return rows;
}

/** The two sides of `P:A_B`, uppercased, or null when the name is not that shape. */
const sidesOf = (material: string): [string, string] | null => {
  const upper = material.toUpperCase();
  if (!upper.startsWith('P:')) return null;
  const sides = upper.slice(2).split('_');
  if (sides.length !== 2 || (!sides[0] && !sides[1])) return null;
  return [sides[0], sides[1]];
};

/** The sector an `S:<sector>_<material>` face belongs to, uppercased, or null. */
const sectorOf = (material: string): string | null => {
  const upper = material.toUpperCase();
  if (!upper.startsWith('S:')) return null;
  const separator = upper.indexOf('_', 2);
  return separator <= 2 ? null : upper.slice(2, separator);
};

// ---------------------------------------------------------------------------
// q1 — pairing

export interface PortalPairingProblem {
  /** `P:A_B` with no `P:B_A` beside it. */
  kind: 'portal-unpaired';
  material: string;
  /** The mirror name that is missing. */
  wanted: string;
}

/**
 * Does every `P:A_B` have its `P:B_A`? Retail is 100 % paired (§16.22 q1:
 * 572 names, 286 pairs, not one unpaired across the three G2 worlds), so a
 * missing mirror is a warning. Case-insensitive as `checkPortalMaterials` is;
 * a malformed name has no mirror to look for and is that check's finding.
 */
export function checkPortalPairing({ materials }: { materials: readonly string[] }): PortalPairingProblem[] {
  const keys = new Set<string>();
  const wellFormed: Array<{ material: string; sides: [string, string] }> = [];
  for (const material of materials) {
    const sides = sidesOf(material);
    if (sides === null) continue;
    keys.add(sides.join('_'));
    wellFormed.push({ material, sides });
  }

  const problems: PortalPairingProblem[] = [];
  for (const { material, sides: [a, b] } of wellFormed) {
    if (keys.has(`${b}_${a}`)) continue;
    problems.push({ kind: 'portal-unpaired', material, wanted: `P:${b}_${a}` });
  }
  return problems;
}

// ---------------------------------------------------------------------------
// q2 — planarity

/**
 * How far off its own plane a portal polygon may sit, in ZenGin units.
 *
 * §16.22 q2 measured the spread `max(n·p) − min(n·p)` over every retail portal
 * polygon: OldWorld's worst is 12.10, NewWorld's 6.92, AddonWorld's 5.03, so
 * anything tighter flags OldWorld as shipped. At this width the check catches
 * only a polygon folded outright, which is the honest thing it can do.
 */
export const PORTAL_PLANARITY_TOLERANCE = 12.1;

export interface PortalPlanarityProblem {
  kind: 'portal-non-planar';
  polygon: number;
  material: string;
  /** The spread along the stored normal, in ZenGin units. */
  spread: number;
}

/** The corners' extent along the stored plane's unit normal, or null for a zero normal. */
const spreadOf = (row: PortalRow): number | null => {
  const [, nx, ny, nz] = row.plane;
  const length = Math.hypot(nx, ny, nz);
  if (length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, y, z] of row.corners) {
    const along = (x * nx + y * ny + z * nz) / length;
    if (along < lo) lo = along;
    if (along > hi) hi = along;
  }
  return row.corners.length === 0 ? 0 : hi - lo;
};

export function checkPortalPlanarity(rows: readonly PortalRow[]): PortalPlanarityProblem[] {
  const problems: PortalPlanarityProblem[] = [];
  for (const row of rows) {
    if (row.kind === 0) continue;
    const spread = spreadOf(row);
    if (spread === null || spread <= PORTAL_PLANARITY_TOLERANCE) continue;
    problems.push({ kind: 'portal-non-planar', polygon: row.polygon, material: row.material, spread });
  }
  return problems;
}

// ---------------------------------------------------------------------------
// q3 — orientation

export interface PortalOrientationProblem {
  /** The stored normal points away from the first-named sector. */
  kind: 'portal-reversed';
  polygon: number;
  material: string;
  /** The sector the normal should point into (or, for `P:_B`, away from). */
  sector: string;
}

/**
 * The share of a sector's corners in front of a stored plane — 1 when the
 * whole sector is on the side the normal points into. Null for a sector with
 * no faces, which cannot be placed at all.
 */
const frontShare = (
  plane: PortalRow['plane'], sector: readonly Vec3[] | undefined,
): number | null => {
  if (sector === undefined || sector.length === 0) return null;
  const [d, nx, ny, nz] = plane;
  const length = Math.hypot(nx, ny, nz);
  if (length === 0) return null;
  let front = 0;
  for (const [x, y, z] of sector) {
    if ((x * nx + y * ny + z * nz) / length - d > 0) front += 1;
  }
  return front / sector.length;
};

/**
 * How much of a one-sided portal's sector may sit on the wrong side of it.
 *
 * A one-sided portal (`P:A_`, `P:_B`) has no second sector to compare against,
 * so it is judged on the share of its one sector's corners on the side the
 * convention wants. Measured over the four retail worlds (§16.22 q3, the
 * corner-share re-run of 2026-09-02): retail runs continuously down to
 * **28.4 %** (`P:GRPTURM01_`, a doorway on the edge of a large sector, with
 * `P:DT1_` at 30.9 % and `P:WAFFENKAMMER_` at 47.8 % beside it), and then
 * nothing until `P:CAPTAIN_` at **0.8 %** — the one retail portal that reads
 * as genuinely reversed. A quarter sits in that gap: everything shipped above
 * it is accepted, and the one reversed portal is the one finding.
 */
export const PORTAL_ONE_SIDED_MIN_SHARE = 0.25;

/**
 * Does the stored normal point into the first-named sector? §16.22 q3 measured
 * the convention over four retail worlds — front-named, `n` into A — and also
 * why the judge has to be the **corners** rather than the centroid: nested
 * sectors (`P:HH1_HH7`, the thief-guild rooms) put both centroids on one side,
 * and there the convention still holds as *more of A than of B in front*. So a
 * two-sided portal is reversed when a larger share of B's corners than of A's
 * is in front of it — no threshold, and no retail portal comes within 0.14 of
 * it — and a one-sided one (the empty side is the outdoors, which has no
 * faces) is reversed when less than {@link PORTAL_ONE_SIDED_MIN_SHARE} of its
 * sector is on the convention's side.
 *
 * Sector membership is read off the `S:<sector>_<material>` face names, as the
 * measurement did: `sector_index` is -1 on every retail polygon and the BSP's
 * portal list is empty in every retail world, so neither is a membership.
 */
export function checkPortalOrientation(rows: readonly PortalRow[]): PortalOrientationProblem[] {
  const sectors = new Map<string, Vec3[]>();
  for (const row of rows) {
    if (row.kind !== 0) continue;
    const sector = sectorOf(row.material);
    if (sector === null) continue;
    const corners = sectors.get(sector) ?? [];
    corners.push(...row.corners);
    sectors.set(sector, corners);
  }

  const problems: PortalOrientationProblem[] = [];
  for (const row of rows) {
    if (row.kind === 0) continue;
    const sides = sidesOf(row.material);
    if (sides === null) continue;
    const [a, b] = sides;
    const shareA = a === '' ? null : frontShare(row.plane, sectors.get(a));
    const shareB = b === '' ? null : frontShare(row.plane, sectors.get(b));

    let reversed: string | null = null;
    if (a !== '' && b !== '') {
      if (shareA !== null && shareB !== null && shareB > shareA) reversed = a;
    } else if (a !== '') {
      // `P:A_`: the normal points into A, so A's share in front is the agreement.
      if (shareA !== null && shareA < PORTAL_ONE_SIDED_MIN_SHARE) reversed = a;
    } else if (shareB !== null && 1 - shareB < PORTAL_ONE_SIDED_MIN_SHARE) {
      // `P:_B`: the front is the unnamed outdoors, so B's share *behind* is.
      reversed = b;
    }
    if (reversed === null) continue;
    problems.push({ kind: 'portal-reversed', polygon: row.polygon, material: row.material, sector: reversed });
  }
  return problems;
}

// ---------------------------------------------------------------------------
// All of them, pinned to a polygon

/**
 * A portal finding with the polygon it stands on — the first portal face
 * carrying the material for a name finding, and null when no face does (the
 * mesh keeps a material no polygon references, and the name is still wrong).
 */
export type PortalFinding =
  | (PortalMaterialProblem & { polygon: number | null })
  | (PortalPairingProblem & { polygon: number | null })
  | PortalPlanarityProblem
  | PortalOrientationProblem;

export function checkPortals(payload: PortalPolygons): PortalFinding[] {
  const rows = portalRows(payload);

  const firstFace = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== 0 && !firstFace.has(row.material)) firstFace.set(row.material, row.polygon);
  }
  const pinned = <T extends { material: string }>(problem: T): T & { polygon: number | null } =>
    ({ ...problem, polygon: firstFace.get(problem.material) ?? null });

  return [
    ...checkPortalMaterials({ materials: payload.materials, sectorNames: payload.sectorNames }).map(pinned),
    ...checkPortalPairing({ materials: payload.materials }).map(pinned),
    ...checkPortalPlanarity(rows),
    ...checkPortalOrientation(rows),
  ];
}
