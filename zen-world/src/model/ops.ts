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

/**
 * The scalar properties of a VOB — every key optional, and only the keys present
 * are written.
 *
 * `visual` is a **rename**: the visual object the VOB carries keeps its class,
 * because the class is not implied by the file name (measured over the three
 * retail worlds, `.3DS` is `zCProgMeshProto` 20,716 times and `zCMesh` 31
 * times). Giving a VOB a visual it does not have replaces that object and has to
 * decide the class, which is a different operation — the binding refuses it.
 */
export interface VobProps {
  name?: string;
  visual?: string;
  showVisual?: boolean;
  vobStatic?: boolean;
  ambient?: boolean;
  cdStatic?: boolean;
  cdDynamic?: boolean;
  physicsEnabled?: boolean;
}

/** The keys of `VobProps`, in the order an op reads them back out of the index.
 *  A key added to the type and forgotten here is written and never restored. */
const PROP_KEYS = [
  'name', 'visual', 'showVisual', 'vobStatic', 'ambient',
  'cdStatic', 'cdDynamic', 'physicsEnabled',
] as const satisfies ReadonlyArray<keyof VobProps>;

export interface SetVobProp {
  op: 'SetVobProp';
  /** The flat index into `vobIndex` — what the UI selected. */
  vob: number;
  /** The native address, `setVobProp`'s `indexPath`. */
  path: string;
  /**
   * The properties as they were and as they are to become — **the same keys on
   * both sides**, read out of the index when the op was made.
   *
   * Carrying every property the VOB has would make an inverse that restores
   * fields this op never touched; carrying fewer would leave one unrestored.
   * Neither is visible until someone undoes, which is what makes this op
   * different in kind from a move: every field it writes is invisible in the
   * viewport.
   */
  from: VobProps;
  to: VobProps;
  /**
   * The world AABB before and after — null unless a visual swap changed it.
   *
   * Only `visual` can change the box, and when it does the two poses have
   * genuinely different bounds rather than one bounds under two transforms,
   * which is what separates this from a rotation. Both are null when either
   * visual does not resolve: the stale box at least bounded the visual in some
   * pose, where a box fitted to the visual being replaced bounds the wrong
   * thing entirely.
   */
  fromBbox: ZenBounds | null;
  toBbox: ZenBounds | null;
}

export type WorldOp = MoveVob | RotateVob | SetVobProp;

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

/** The visual's own bounds on each side of a swap, in the visual's own space —
 *  null for one that does not resolve. */
export interface VisualSwap {
  from: ZenBounds | null;
  to: ZenBounds | null;
}

/**
 * Set scalar properties on one VOB.
 *
 * `bounds` is the visual's own bounds before and after, and is accepted **only**
 * for a change that includes `visual` — nothing else here can change the box the
 * engine culls by, and a box with nothing to justify it is a caller error rather
 * than a no-op. The binding refuses the same combination for the same reason.
 */
export function setVobProp(
  reader: VobReader, vob: number, to: VobProps, bounds: VisualSwap | null = null,
): SetVobProp {
  const keys = PROP_KEYS.filter((key) => to[key] !== undefined);
  if (keys.length === 0) throw new RangeError('a property op must set at least one property');
  if (bounds !== null && to.visual === undefined) {
    throw new RangeError('bounds are only meaningful for a change of visual');
  }

  const path = vobIndexPath(reader, vob);
  const position = reader.position(vob);
  const rotation = reader.rotation(vob);
  if (path === null || position === null || rotation === null) {
    throw new RangeError(`no vob ${vob} in the index`);
  }

  // `from` is read out of the index rather than snapshotted beside the history,
  // and carries exactly the keys `to` does.
  const flags = reader.flags(vob);
  const from: VobProps = {};
  for (const key of keys) {
    if (key === 'name') from.name = reader.name(vob) ?? '';
    else if (key === 'visual') from.visual = reader.visual(vob) ?? '';
    else from[key] = flags[key];
  }

  const swapped = bounds !== null && bounds.from !== null && bounds.to !== null;
  return {
    op: 'SetVobProp',
    vob,
    path,
    from,
    to: Object.fromEntries(keys.map((key) => [key, to[key]])) as VobProps,
    fromBbox: swapped ? placeBounds(bounds.from!, rotation as ZenRotation, position) : null,
    toBbox: swapped ? placeBounds(bounds.to!, rotation as ZenRotation, position) : null,
  };
}

/** The bounds a batch needs: each VOB's current visual, and the one new visual
 *  every VOB in the selection is being given. */
export interface VisualSwapBatch {
  from: (vob: number) => ZenBounds | null;
  to: ZenBounds | null;
}

/**
 * Set the same properties on a whole selection — a batch property edit.
 *
 * One op per VOB, each carrying **its own** `from`, for exactly the reason a
 * drag is a delta and not a destination: a selection whose VOBs did not share a
 * value must come back to the values they each had, and a batch that shared one
 * `from` reads correct on a selection of one — which is every test that has only
 * one VOB in it.
 *
 * It refuses the whole batch if any one VOB is not in the index rather than
 * skipping it: a quietly dropped op is the half-applied state `commitOps` exists
 * to prevent, reached before the binding was ever asked.
 */
export function setVobProps(
  reader: VobReader,
  vobs: readonly number[],
  to: VobProps,
  bounds: VisualSwapBatch | null = null,
): SetVobProp[] {
  return vobs.map((vob) => setVobProp(
    reader, vob, to,
    bounds === null ? null : { from: bounds.from(vob), to: bounds.to },
  ));
}

/** The op that undoes `op` — pure, and an ordinary op in its own right. */
export function invertOp(op: WorldOp): WorldOp {
  // The box is half of what these two write. Swapping only the matrix — or only
  // the props — undoes the visible half and leaves the VOB culled by a box
  // fitted to something it is no longer. The two branches are written out
  // rather than shared: `from` and `to` are different types on each, and a
  // union-shaped spread is not assignable back to `WorldOp`.
  if (op.op === 'RotateVob') {
    return { ...op, from: op.to, to: op.from, fromBbox: op.toBbox, toBbox: op.fromBbox };
  }
  if (op.op === 'SetVobProp') {
    return { ...op, from: op.to, to: op.from, fromBbox: op.toBbox, toBbox: op.fromBbox };
  }
  return { ...op, from: op.to, to: op.from };
}

/** The slice of the binding an op needs. Injected, like every other binding
 *  call in this package, so the decision below is testable without the addon. */
export interface OpBinding {
  setVobPosition(path: string, to: ZenPosition): void;
  setVobRotation(path: string, to: ZenRotation, bbox: ZenBounds | null): void;
  /** `bbox` is present only when a visual swap changed it — the binding refuses
   *  a box that no visual swap justifies, so it cannot be passed unconditionally. */
  setVobProp(path: string, props: VobProps & { bbox?: ZenBounds }): void;
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
  if (op.op === 'SetVobProp') {
    const bbox = direction === 'to' ? op.toBbox : op.fromBbox;
    binding.setVobProp(op.path, bbox === null ? op[direction] : { ...op[direction], bbox });
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
/** The dictionary index for `value`, appending it only if it is not already
 *  there. Every rename appending would grow the dictionary without bound behind
 *  a user holding a checkbox, and stop two VOBs with one name sharing an entry —
 *  which is what the interning is for. */
function internProp(dictionary: string[], value: string): number {
  const found = dictionary.indexOf(value);
  return found === -1 ? dictionary.push(value) - 1 : found;
}

/** The bit each flag occupies in the index's packed `flags` column. */
const FLAG_BITS: ReadonlyArray<[keyof VobProps, number]> = [
  ['showVisual', 0b000001], ['vobStatic', 0b000010], ['ambient', 0b000100],
  ['cdStatic', 0b001000], ['cdDynamic', 0b010000], ['physicsEnabled', 0b100000],
];

export function applyOps(reader: VobReader, ops: readonly WorldOp[]): number[] {
  const { positions, rotations, flags, nameIndex, visualIndex } = reader.columns;
  const touched: number[] = [];

  for (const op of ops) {
    if (op.op === 'SetVobProp') {
      // The name and the visual are dictionary indices rather than values, so
      // this is an intern plus a write — a projection that only wrote the
      // columns would leave the property grid naming the visual the world no
      // longer has.
      if (op.to.name !== undefined) {
        nameIndex[op.vob] = internProp(reader.dictionaries.names, op.to.name);
      }
      if (op.to.visual !== undefined) {
        visualIndex[op.vob] = internProp(reader.dictionaries.visuals, op.to.visual);
      }
      for (const [flag, bit] of FLAG_BITS) {
        if (op.to[flag] === undefined) continue;      // not this op's to clear
        if (op.to[flag]) flags[op.vob] |= bit;
        else flags[op.vob] &= ~bit;
      }
    } else if (op.op === 'RotateVob') {
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
