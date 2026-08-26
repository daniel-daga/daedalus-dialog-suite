// The op model (level-editor.md §7, Phase 1b).
//
// Everything Phase 1a built is a read-only projection: it cannot be wrong about
// the world because it never changes it. An op can. §7 fixes the shape — "all
// edits are ops defined in `zen-world` with inverses" — and two facts about the
// data decide the rest:
//
// **A VOB has two addresses.** The renderer knows a flat index into the
// columnar `vobIndex`, in enumeration order. The binding addresses the native
// world by an index *path* down the children lists — `setVobPosition(handle,
// "0/2", …)` — because that is how ZenKit's `VirtualObject` tree is reachable,
// and `vobIndex` deliberately emits only `parent` and `childIndex` and leaves
// "rebuilding the whole path is the consumer's job" to here. An op therefore
// carries both: the index the UI selected, and the path the binding needs,
// resolved when the op was made.
//
// **An op carries where it came from as well as where it goes.** Undo is then
// `applyOps(invertOp(op))` through the same path as any other edit — no
// snapshot beside the history, and nothing read back out of the native world,
// which is what would make undo depend on the world still being the one the op
// was recorded against.
//
// Only `MoveVob` exists, because `setVobPosition` is the only mutation the
// binding has that the engine has accepted (acceptance record §8 row 10: the
// moved VOB and the inserted item both passed in the real game). The rest of
// §7's list — reparent, set-prop, add, delete, waynet edges — arrives when the
// binding call for it does, not before.

import type { VobReader } from './vobTree';

/** ZenGin space, centimetres — unconverted, exactly as the binding takes it. */
export type ZenPosition = [number, number, number];

/** A VOB's 3x3, **row-major** — the order `vobIndex` emits and `setVobRotation`
 *  takes. A transpose is invisible on identity and on every symmetric matrix,
 *  which is why it is named here rather than left to each call site. */
export type ZenRotation = [
  number, number, number,
  number, number, number,
  number, number, number,
];

/** An axis-aligned box, `[minX, minY, minZ, maxX, maxY, maxZ]`, ZenGin space. */
export type ZenBounds = [number, number, number, number, number, number];

export interface MoveVob {
  op: 'MoveVob';
  /** The flat index into `vobIndex` — what the UI selected. */
  vob: number;
  /** The native address, `setVobPosition`'s `indexPath`. */
  path: string;
  from: ZenPosition;
  to: ZenPosition;
}

export interface RotateVob {
  op: 'RotateVob';
  /** The flat index into `vobIndex` — what the UI selected. */
  vob: number;
  /** The native address, `setVobRotation`'s `indexPath`. */
  path: string;
  from: ZenRotation;
  to: ZenRotation;
  /**
   * The world AABB for each pose — null when the VOB's visual does not resolve.
   *
   * The box is half of what a rotation writes, because the engine culls by it
   * and an axis-aligned box does not rotate into an axis-aligned box. Measured
   * across the three retail worlds (`zenkit-node/scripts/check-vob-bbox.js`), a
   * stored box is the tight world AABB of the VOB's own visual placed by its
   * own transform — 20,472 of 20,502, mean slack ~0.1 cm. So the box is a pure
   * function of (visual, rotation, position) and both poses' boxes can be
   * computed when the op is made, which is what keeps the op invertible.
   * Re-fitting the *stored* box instead would grow it on every rotation and
   * never shrink back, and undo would not restore it.
   */
  fromBbox: ZenBounds | null;
  toBbox: ZenBounds | null;
}

export type WorldOp = MoveVob | RotateVob;

/**
 * The native address of `vob`: its slot among its parent's children, root
 * first, joined by `/`.
 *
 * The chain is of `childIndex` values, **not** of VOB indices. Retail worlds
 * are enumerated depth-first so the two mostly agree — the same coincidence
 * that makes a scene tree sorting by the wrong key look correct — and the
 * disagreement moves the wrong VOB rather than failing.
 */
export function vobIndexPath(reader: VobReader, vob: number): string | null {
  if (vob < 0 || vob >= reader.count) return null;

  const { parent, childIndex } = reader.columns;
  const path: number[] = [];
  for (let at = vob; at >= 0; at = parent[at]) path.push(childIndex[at]);

  return path.reverse().join('/');
}

/** A move of one VOB to a position in ZenGin space. */
export function moveVob(reader: VobReader, vob: number, to: ZenPosition): MoveVob {
  const path = vobIndexPath(reader, vob);
  const from = reader.position(vob);
  if (path === null || from === null) throw new RangeError(`no vob ${vob} in the index`);

  return { op: 'MoveVob', vob, path, from, to };
}

/**
 * Move a whole selection by one delta, in ZenGin space — a multi-select drag.
 *
 * One gizmo drives many VOBs, so what a drag of a selection produces is a
 * *delta* and not a destination: the VOBs keep the spacing they had, and each
 * op still carries its own VOB's origin, which is what lets one undo entry put
 * a selection that was never uniform back exactly where it was.
 *
 * It refuses the whole batch if any one of the VOBs is not in the index rather
 * than skipping it. A batch is atomic and is one undo entry; a list that
 * quietly dropped a VOB would apply cleanly and leave the selection somewhere
 * no single history entry describes — the state `commitOps` unwinds for,
 * arrived at before the binding was ever asked.
 */
export function translateVobs(
  reader: VobReader,
  vobs: readonly number[],
  delta: ZenPosition,
): MoveVob[] {
  return vobs.map((vob) => {
    const from = reader.position(vob);
    if (from === null) throw new RangeError(`no vob ${vob} in the index`);
    return moveVob(reader, vob, [from[0] + delta[0], from[1] + delta[1], from[2] + delta[2]]);
  });
}

/**
 * The world AABB of a visual's own bounds placed by a rotation and a position.
 *
 * All eight corners, because a rotated box's extent is not the rotated extent —
 * taking the two corners alone gives a box that is wrong for every rotation but
 * a multiple of a quarter turn.
 */
export function placeBounds(
  bounds: ZenBounds, rotation: ZenRotation, position: ZenPosition,
): ZenBounds {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let corner = 0; corner < 8; corner++) {
    const local = [
      corner & 1 ? bounds[3] : bounds[0],
      corner & 2 ? bounds[4] : bounds[1],
      corner & 4 ? bounds[5] : bounds[2],
    ];
    for (let row = 0; row < 3; row++) {
      const value = rotation[row * 3] * local[0]
        + rotation[row * 3 + 1] * local[1]
        + rotation[row * 3 + 2] * local[2]
        + position[row];
      if (value < min[row]) min[row] = value;
      if (value > max[row]) max[row] = value;
    }
  }

  return [min[0], min[1], min[2], max[0], max[1], max[2]];
}

/**
 * A rotation of one VOB in place, with the bounding box refitted for both poses.
 *
 * `bounds` is the VOB's visual in the visual's own space, or null when it does
 * not resolve — a decal, a `.pfx`, an unresolved model. Null means the stale box
 * is left alone: it at least bounded the visual in some pose, where a guessed
 * one bounds nothing.
 */
export function rotateVob(
  reader: VobReader, vob: number, to: ZenRotation, bounds: ZenBounds | null,
): RotateVob {
  const path = vobIndexPath(reader, vob);
  const from = reader.rotation(vob);
  const position = reader.position(vob);
  if (path === null || from === null || position === null) {
    throw new RangeError(`no vob ${vob} in the index`);
  }

  return {
    op: 'RotateVob',
    vob,
    path,
    from: from as ZenRotation,
    to,
    fromBbox: bounds === null ? null : placeBounds(bounds, from as ZenRotation, position),
    toBbox: bounds === null ? null : placeBounds(bounds, to, position),
  };
}

/** `a * b`, both row-major — the matrix that applies `b` first and then `a`. */
export function multiplyRotation(a: ZenRotation, b: ZenRotation): ZenRotation {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] = a[row * 3] * b[col]
        + a[row * 3 + 1] * b[3 + col]
        + a[row * 3 + 2] * b[6 + col];
    }
  }
  return out as ZenRotation;
}

/**
 * Turn a whole selection by one delta — a multi-select drag of the rotate gizmo.
 *
 * **Each VOB turns about its own origin**, not about the selection's pivot.
 * Turning about a pivot would move the VOBs as well as turn them, which is a
 * batch of two op kinds and a different feature; this is the one a level editor
 * wants for "face these barrels the other way".
 *
 * The delta is applied on the left — the turn happens in world space, after the
 * VOB's own orientation — so a selection of differently-oriented VOBs all turn
 * the same way on screen rather than each about its own axes.
 */
export function rotateVobs(
  reader: VobReader,
  vobs: readonly number[],
  delta: ZenRotation,
  boundsOf: (vob: number) => ZenBounds | null,
): RotateVob[] {
  return vobs.map((vob) => {
    const from = reader.rotation(vob);
    if (from === null) throw new RangeError(`no vob ${vob} in the index`);
    return rotateVob(reader, vob, multiplyRotation(delta, from as ZenRotation), boundsOf(vob));
  });
}

/** The op that undoes `op` — pure, and an ordinary op in its own right. */
export function invertOp(op: WorldOp): WorldOp {
  if (op.op === 'RotateVob') {
    // The box is half of what a rotation writes. Swapping only the matrix would
    // undo the rotation and leave the VOB culled by a box fitted to a pose it is
    // no longer in.
    return { ...op, from: op.to, to: op.from, fromBbox: op.toBbox, toBbox: op.fromBbox };
  }
  return { ...op, from: op.to, to: op.from };
}

/** The slice of the binding an op needs. Injected, like every other binding
 *  call in this package, so the decision below is testable without the addon. */
export interface OpBinding {
  setVobPosition(path: string, to: ZenPosition): void;
  setVobRotation(path: string, to: ZenRotation, bbox: ZenBounds | null): void;
}

/** One op against the world, and its own inverse — the two directions
 *  `commitOps` needs and the only place an op kind is dispatched. */
function writeOp(binding: OpBinding, op: WorldOp, direction: 'to' | 'from'): void {
  if (op.op === 'RotateVob') {
    binding.setVobRotation(
      op.path, op[direction], direction === 'to' ? op.toBbox : op.fromBbox,
    );
    return;
  }
  binding.setVobPosition(op.path, op[direction]);
}

/**
 * Apply a batch to the authoritative world — **all of it, or none of it**.
 *
 * A batch is one entry in the history and one undo for the user, so a batch
 * that half-applies leaves the world in a state no history entry describes:
 * `WorldService` records nothing for a refused batch, so whatever it did move
 * would never be put back. An op knows where it came from, which is what makes
 * unwinding free — back to front, because two ops on the same VOB compose.
 */
export function commitOps(binding: OpBinding, ops: readonly WorldOp[]): void {
  const applied: WorldOp[] = [];
  try {
    for (const op of ops) {
      writeOp(binding, op, 'to');
      applied.push(op);
    }
  } catch (error) {
    for (const op of applied.reverse()) writeOp(binding, op, 'from');
    throw error;
  }
}

/**
 * Apply ops to the renderer's projection, in order, and answer which VOBs moved.
 *
 * The authoritative world is the native one; this keeps the columnar index it
 * was projected from in step, so the scene tree, the property grid and the
 * viewport show the edit without reloading 31 MB of payloads.
 */
export function applyOps(reader: VobReader, ops: readonly WorldOp[]): number[] {
  const { positions, rotations } = reader.columns;
  const touched: number[] = [];

  for (const op of ops) {
    if (op.op === 'RotateVob') {
      // A rotation is not a move: the position column is not the op's to touch,
      // and the matrix goes in row-major, which is the order it came out in.
      rotations.set(op.to, op.vob * 9);
    } else {
      positions[op.vob * 3] = op.to[0];
      positions[op.vob * 3 + 1] = op.to[1];
      positions[op.vob * 3 + 2] = op.to[2];
    }
    touched.push(op.vob);
  }

  return touched;
}
