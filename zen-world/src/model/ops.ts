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

export interface MoveVob {
  op: 'MoveVob';
  /** The flat index into `vobIndex` — what the UI selected. */
  vob: number;
  /** The native address, `setVobPosition`'s `indexPath`. */
  path: string;
  from: ZenPosition;
  to: ZenPosition;
}

export type WorldOp = MoveVob;

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

/** The op that undoes `op` — pure, and an ordinary op in its own right. */
export function invertOp(op: WorldOp): WorldOp {
  return { ...op, from: op.to, to: op.from };
}

/** The slice of the binding an op needs. Injected, like every other binding
 *  call in this package, so the decision below is testable without the addon. */
export interface OpBinding {
  setVobPosition(path: string, to: ZenPosition): void;
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
      binding.setVobPosition(op.path, op.to);
      applied.push(op);
    }
  } catch (error) {
    for (const op of applied.reverse()) binding.setVobPosition(op.path, op.from);
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
  const { positions } = reader.columns;
  const touched: number[] = [];

  for (const op of ops) {
    positions[op.vob * 3] = op.to[0];
    positions[op.vob * 3 + 1] = op.to[1];
    positions[op.vob * 3 + 2] = op.to[2];
    touched.push(op.vob);
  }

  return touched;
}
