// Transforms of a selection that carry its subtrees (#292).
//
// ZenGin VOB positions are world-space: a child's position is not relative to
// its parent, so a `MoveVob` on a parent moves the parent alone and leaves its
// children standing where they were. Florian's gesture — place twenty bushes,
// put nineteen under the twentieth, move them all by the one — needs every
// transform of a selection to take each selected VOB's descendants along,
// rigidly, the way `posedSubtree` already carries a scattered copy.
//
// Each function here is the subtree counterpart of one in `ops.ts` and returns
// the same op kinds, so nothing below the renderer changes: a subtree move is
// more `MoveVob`s in the same one batch, one undo entry. A turn swings each
// descendant round its root's origin, which is a `RotateVob` *and* a `MoveVob`
// for it — rotate first, which fits the box at the old position, then move,
// which `setVobPosition` carries the box along with, so the two land on the box
// fitted where it now stands.
//
// A selection with no children produces exactly what the plain functions do.

import { type VobReader } from './vobTree';
import {
  moveVob, multiplyRotation, rotateVob, standUpDelta, topLevelVobs,
  type MoveVob, type RotateVob, type ZenBounds, type ZenPosition, type ZenRotation,
} from './ops';

/** A VOB a subtree transform moves, and the selected VOB whose origin it turns
 *  about — itself, for a selected VOB. */
export interface SubtreeMember {
  vob: number;
  root: number;
}

/**
 * Every selected VOB and all of its descendants, each once, with the selected
 * ancestor it belongs to. A VOB selected together with its own ancestor is that
 * ancestor's descendant, not a root of its own — otherwise it would move twice.
 *
 * Roots in selection order, each followed by its descendants in index order —
 * which is depth-first, the order `vobIndex` enumerates in.
 */
export function subtreeMembers(reader: VobReader, vobs: readonly number[]): SubtreeMember[] {
  const roots = topLevelVobs(reader, vobs);
  const rootSet = new Set(roots);
  const { parent } = reader.columns;
  const descendants = new Map<number, number[]>(roots.map((root) => [root, []]));
  for (let vob = 0; vob < reader.count; vob++) {
    if (rootSet.has(vob)) continue;
    for (let up = parent[vob]; up >= 0; up = parent[up]) {
      if (rootSet.has(up)) { descendants.get(up)!.push(vob); break; }
    }
  }
  return roots.flatMap((root) => [
    { vob: root, root },
    ...descendants.get(root)!.map((vob) => ({ vob, root })),
  ]);
}

/** `translateVobs`, with each selected VOB's subtree moved by the same delta. */
export function translateSubtrees(
  reader: VobReader, vobs: readonly number[], delta: ZenPosition,
): MoveVob[] {
  return subtreeMembers(reader, vobs).map(({ vob }) => {
    const from = reader.position(vob);
    if (from === null) throw new RangeError(`no vob ${vob} in the index`);
    return moveVob(reader, vob, [from[0] + delta[0], from[1] + delta[1], from[2] + delta[2]]);
  });
}

/** `point` turned by `turn` about `origin`, all in ZenGin space. */
export function turnAbout(point: ZenPosition, origin: ZenPosition, turn: ZenRotation): ZenPosition {
  const local = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
  return [0, 1, 2].map((row) => (
    turn[row * 3] * local[0] + turn[row * 3 + 1] * local[1] + turn[row * 3 + 2] * local[2] + origin[row]
  )) as ZenPosition;
}

/** The ops that turn each root's subtree by the turn `deltaOf` gives for it:
 *  the root in place, a descendant in place and round the root's origin. */
function turnSubtrees(
  reader: VobReader,
  members: readonly SubtreeMember[],
  deltaOf: (root: number) => ZenRotation,
  boundsOf: (vob: number) => ZenBounds | null,
  rootPose: (root: number, delta: ZenRotation, from: ZenRotation) => ZenRotation = (_root, delta, from) => (
    multiplyRotation(delta, from)
  ),
): Array<RotateVob | MoveVob> {
  const deltas = new Map<number, ZenRotation>();
  return members.flatMap(({ vob, root }) => {
    const from = reader.rotation(vob) as ZenRotation | null;
    const position = reader.position(vob);
    const origin = reader.position(root);
    if (from === null || position === null || origin === null) {
      throw new RangeError(`no vob ${vob} in the index`);
    }
    if (!deltas.has(root)) deltas.set(root, deltaOf(root));
    const delta = deltas.get(root)!;
    if (vob === root) return [rotateVob(reader, vob, rootPose(root, delta, from), boundsOf(vob))];
    return [
      rotateVob(reader, vob, multiplyRotation(delta, from), boundsOf(vob)),
      moveVob(reader, vob, turnAbout(position, origin, delta)),
    ];
  });
}

/** `rotateVobs`, with each selected VOB's subtree swung round that VOB's own
 *  origin by the same delta. */
export function rotateSubtrees(
  reader: VobReader,
  vobs: readonly number[],
  delta: ZenRotation,
  boundsOf: (vob: number) => ZenBounds | null,
): Array<RotateVob | MoveVob> {
  return turnSubtrees(reader, subtreeMembers(reader, vobs), () => delta, boundsOf);
}

/** The inverse of a 3x3 row-major matrix, or null for a singular one. Not the
 *  transpose: 30.2% of retail VOBs are not orthonormal. */
function invertRotation(m: ZenRotation): ZenRotation | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-12)) return null;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

/**
 * The property grid's typed rotation of one VOB — an absolute pose, which the
 * VOB gets exactly — with its descendants turned by the change that pose is
 * from the one it had.
 */
export function rotateSubtreeTo(
  reader: VobReader,
  vob: number,
  to: ZenRotation,
  boundsOf: (vob: number) => ZenBounds | null,
): Array<RotateVob | MoveVob> {
  const members = subtreeMembers(reader, [vob]);
  if (members.length === 1) return [rotateVob(reader, vob, to, boundsOf(vob))];
  const from = reader.rotation(vob) as ZenRotation | null;
  if (from === null) throw new RangeError(`no vob ${vob} in the index`);
  const inverse = invertRotation(from);
  if (inverse === null) throw new RangeError(`vob ${vob}'s rotation is singular: its children have no turn to follow`);
  return turnSubtrees(reader, members, () => multiplyRotation(to, inverse), boundsOf, () => to);
}

/**
 * `dropVobsToGround`, with each dropped VOB's subtree carried by the same drop.
 *
 * A VOB whose ancestor is dropped too moves with that ancestor and ignores its
 * own ground point: each dropped separately, a tree would be pulled apart.
 */
export function dropSubtreesToGround(
  reader: VobReader,
  drops: readonly { vob: number; ground: ZenPosition }[],
): MoveVob[] {
  const groundOf = new Map(drops.map(({ vob, ground }) => [vob, ground]));
  const deltas = new Map<number, ZenPosition>();
  return subtreeMembers(reader, drops.map(({ vob }) => vob)).map(({ vob, root }) => {
    const from = reader.position(vob);
    if (from === null) throw new RangeError(`no vob ${vob} in the index`);
    if (!deltas.has(root)) {
      const origin = reader.position(root)!;
      const ground = groundOf.get(root)!;
      deltas.set(root, [ground[0] - origin[0], ground[1] - origin[1], ground[2] - origin[2]]);
    }
    const delta = deltas.get(root)!;
    return moveVob(reader, vob, [from[0] + delta[0], from[1] + delta[1], from[2] + delta[2]]);
  });
}

/** `alignVobsToNormal`, with each aligned VOB's subtree swung round it by the
 *  same stand-up turn. A descendant's own hit, if it has one, is ignored for
 *  `dropSubtreesToGround`'s reason. */
export function alignSubtreesToNormal(
  reader: VobReader,
  hits: readonly { vob: number; normal: ZenPosition }[],
  boundsOf: (vob: number) => ZenBounds | null,
): Array<RotateVob | MoveVob> {
  const normalOf = new Map(hits.map(({ vob, normal }) => [vob, normal]));
  return turnSubtrees(
    reader,
    subtreeMembers(reader, hits.map(({ vob }) => vob)),
    (root) => {
      const from = reader.rotation(root) as ZenRotation | null;
      if (from === null) throw new RangeError(`no vob ${root} in the index`);
      return standUpDelta(from, normalOf.get(root)!);
    },
    boundsOf,
  );
}
