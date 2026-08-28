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
// **One op has no inverse**, and it is the exception the other two facts are
// stated before. `DeleteVob` cannot describe what it removed — a retail VOB
// carries per-class properties, children, an AI and an event manager that no op
// has a field for — so it ships as a *barrier*: `invertOp` refuses it and the
// history clears rather than replaying it (§15; the original Spacer has no undo
// at all, so an unundoable delete is already parity). `isBarrierOp` is the
// predicate that says so, and everything else here is still invertible.
//
// Of §7's list only the waynet *edge* ops are still missing; they arrive when
// the binding call for them does, not before.

import type { VobReader } from './vobTree';
import { classPropKeys, fieldOf, type AuthorableVobClass, type ClassProps } from './vobClasses';

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

/**
 * Set the properties a VOB has by virtue of its *class* — an `oCItem`'s Daedalus
 * instance, a `zCVobLight`'s range and colour.
 *
 * A second op rather than eight more optional keys on `VobProps`, and every
 * reason is code rather than taste. `setVobProp` reads `from` out of the
 * columnar index, and the index carries no per-class data at all — only the
 * interned class *name* — so there is nothing there to read a class field's
 * origin from. `applyOps` has no column to project one into, and a typed array
 * in a transferred payload cannot grow one. `setVobProp` performs no class check
 * between its first line and its last, so `{ range: 500 }` on an `oCItem` would
 * build cleanly and be refused only by the binding, in the middle of a batch.
 * And a shared key list would become a union of every key of every class, most
 * of them illegal for most VOBs, which multiplies exactly the trap `PROP_KEYS`
 * warns about.
 *
 * It also sheds `fromBbox`/`toBbox`: no field in the catalogue can change the
 * box the engine culls by, and two permanently-null fields are two fields every
 * layer downstream has to keep excusing.
 */
export interface SetVobClassProp {
  op: 'SetVobClassProp';
  /** The flat index into `vobIndex` — what the UI selected. */
  vob: number;
  /** The native address, `setVobClassProp`'s `indexPath`. */
  path: string;
  /**
   * The class the VOB had when the op was made — a declaration of intent, not a
   * truth.
   *
   * The editor's IPC assertion is stateless with respect to the world: it sees
   * the op and has no index and no handle, so without a declared class it cannot
   * tell that a key is legal for the VOB the op names, and a cross-class key
   * would be discovered in C++ at the bottom of a partly-applied batch. The
   * binding still switches on the VOB's *actual* type and refuses a key that
   * class does not have, the same way `writeOp` re-checks where a reparent
   * actually landed. Being directionally symmetric, it survives `invertOp`'s
   * swap of the two sides untouched — undoing an edit to an `oCItem` still
   * addresses an `oCItem`.
   */
  className: string;
  /**
   * The fields as they were and as they are to become — **the same keys on both
   * sides**, exactly as `SetVobProp` requires and for the same reason: an
   * inverse carrying more restores fields the op never touched, one carrying
   * fewer leaves one unrestored, and neither is visible until someone undoes.
   *
   * `from` is supplied by the caller rather than read out of the index, because
   * the index cannot answer. `MoveWaypoint` is the precedent — its origin comes
   * out of the payload the caller holds, because there is no reader for a
   * waynet. What stays forbidden is reading `from` back out of the *native
   * world* at apply time; being handed it when the op is made is not that.
   */
  from: ClassProps;
  to: ClassProps;
}

/**
 * A VOB to author. Only `position` is required.
 *
 * Everything about a VOB made this way is described here, which is exactly what
 * makes an add op invertible: undo deletes it and redo makes it again from the
 * same description, with no snapshot beside the history. That is **not** true of
 * an arbitrary retail VOB — an `oCMobInter` carries per-class properties,
 * children, an AI and an event manager that nothing here describes — which is
 * why deleting one is a different op that does not exist yet.
 */
export interface NewVob {
  /**
   * The class the new VOB *is* — its C++ type rather than a field on it —
   * defaulting to `zCVob` when it is absent (level-editor.md §16.15, I1).
   *
   * A closed set the binding owns: each class needs its own field-complete
   * construction, because ZenKit's structs have uninitialized fields, and
   * nothing can turn a `zCVob` into an `oCItem` afterwards — `setVobClassProp`
   * switches on the type the object really has. This package neither authors nor
   * reads it; it carries it, because an `AddVob` describes a VOB completely and
   * a spec that lost its class would insert something else. The set itself is
   * `AUTHORABLE_VOB_CLASSES`, next door, because the validator and the dialog
   * need the same one.
   */
  class?: AuthorableVobClass;
  /** The script instance an `oCItem` spawns — required for one and refused for
   *  any other class. Whether the name is one the scripts declare is a question
   *  no layer below the renderer can answer: the main process holds no semantic
   *  model, so its half is a shape check and nothing more. */
  instance?: string;
  name?: string;
  /** The visual's class is derived from the extension by the binding, which is
   *  the opposite of what a rename does and for the opposite reason: a rename
   *  has a class to preserve, authoring has none. */
  visual?: string;
  position: ZenPosition;
  /** Row-major; identity when omitted. */
  rotation?: ZenRotation;
  bbox?: ZenBounds;
  showVisual?: boolean;
  cdStatic?: boolean;
  cdDynamic?: boolean;
  vobStatic?: boolean;
  ambient?: boolean;
}

export interface AddVob {
  op: 'AddVob';
  /** The flat index it takes: one past the end for a root, because it is
   *  enumerated last — and otherwise the index right after its parent's whole
   *  subtree, which is where a depth-first traversal reaches a new last child. */
  vob: number;
  /** The native address: the slot it lands in, under `parentPath`. */
  path: string;
  /**
   * The parent it is appended to; null is a root.
   *
   * It is the field that decides whether this op renumbers. A root is
   * enumerated last and shifts nothing; under a parent, every VOB after that
   * parent's subtree moves up one. `renumbersPaths` is where that is read —
   * and what it costs is company of a *different* kind, not solitude: an
   * append moves no existing path, so `commitOps` takes a batch of adds
   * whatever their parents (§16.14, D4) and refuses one holding anything else.
   */
  parentPath: string | null;
  /** Null means "not in the world". `from` is null for an add and `to` is null
   *  for its inverse, so `invertOp` swaps the two sides exactly as it does for
   *  every other op and a delete needs no special case. */
  from: NewVob | null;
  to: NewVob | null;
}

/** Where a VOB sits: the slot, the parent that holds it, and the path the two
 *  make. All three, because a path alone cannot describe a move — putting a VOB
 *  back at the *end* of the list it came from is a different world. */
export interface VobSlot {
  /** The index path the VOB is at, or lands at. */
  path: string;
  /** The parent's index path; null means it is a root. */
  parentPath: string | null;
  /** The slot among that parent's children. */
  slot: number;
}

export interface ReparentVob {
  op: 'ReparentVob';
  vob: number;
  from: VobSlot;
  to: VobSlot;
}

/**
 * A move of one waypoint — the first op that is not about a VOB at all.
 *
 * There is no index path, because a waynet is a flat list plus an edge set and
 * not a tree. The address is the waypoint's index into the point list
 * `getWaynet` emits, which is safe for a *move* and for nothing else: the
 * binding fills that list once at load and never reorders it, and a move cannot
 * insert, delete or reorder, so the enumeration the op was made against is the
 * enumeration it is applied against.
 *
 * It carries the name as well, because the failure mode of a bare index is not
 * the failure mode of a path. A stale path usually resolves to nothing and the
 * binding says so; a stale index always resolves to *some* waypoint and moves
 * it. One string compare is the only guard the address admits.
 *
 * Deliberately not addressed *by* the name: nothing in the format promises a
 * waypoint name is unique, which is why the binding matches edge endpoints by
 * pointer identity rather than by name.
 */
export interface MoveWaypoint {
  op: 'MoveWaypoint';
  /** The index into the point list `getWaynet` emits. */
  waypoint: number;
  /** The name that index had when the op was made — checked, never resolved. */
  name: string;
  from: ZenPosition;
  to: ZenPosition;
}

/**
 * The rename of one waypoint (§16.7, W1).
 *
 * Stands on exactly the address a move does — the index into `getWaynet`'s
 * point list — because it earns it the same way: a rename inserts, deletes and
 * reorders nothing, so the enumeration the op was made against is the one it is
 * applied against.
 *
 * It carries no separate `name` guard because `from` *is* the guard: the name
 * the index had when the op was made, and the name the binding checks before
 * writing. That is also what makes the inverse the plain swap — undoing a
 * rename is a rename back, guarded by the name it just wrote.
 *
 * The edges are untouched. The binding matches edge endpoints by pointer
 * identity, so an edge into a renamed waypoint is an edge into the same object;
 * a *script* that names the waypoint as a literal is the one thing this can
 * orphan, and warning about that is §16.8's Problems rule, not this op's job.
 */
export interface RenameWaypoint {
  op: 'RenameWaypoint';
  /** The index into the point list `getWaynet` emits. */
  waypoint: number;
  /** The name that index had when the op was made — the guard, and the
   *  inverse's destination. */
  from: string;
  to: string;
}

/**
 * The removal of a VOB and its whole subtree — **the one op with no inverse.**
 *
 * Deliberately not an `AddVob` with a null `to`. That shape carries a `NewVob`
 * on its other side and means "this op describes the VOB completely", which is
 * true of a VOB the editor itself authored and false of every retail one: an
 * `oCMobInter` carries per-class properties, children, an AI and an event
 * manager that a `NewVob` has no field for. An inverse built out of the columns
 * would insert a bare `zCVob` wearing its name, and the undo would look like it
 * worked.
 *
 * So it ships uninvertible, which §15 settled: the original Spacer has no undo
 * at all, so an unundoable delete is already parity, and `invertOp` is no longer
 * the gate a new op has to pass. What replaces it is narrower and is the whole
 * of what this op owes — `isBarrierOp` is true, the history clears its stacks
 * rather than recording something it cannot replay, and the user is told before
 * it lands. Serialising the subtree into the op stays open as an improvement;
 * it is not a prerequisite.
 */
export interface DeleteVob {
  op: 'DeleteVob';
  vob: number;
  path: string;
}

export type WorldOp =
  MoveVob | RotateVob | SetVobProp | SetVobClassProp | AddVob | ReparentVob
  | MoveWaypoint | RenameWaypoint | DeleteVob;

/** The ops that write the waynet rather than a VOB — what `isWaynetOp` narrows
 *  to, and the only ops `applyOps` has no column for. */
export type WaynetOp = MoveWaypoint | RenameWaypoint;

/**
 * The tail of every dispatch over `WorldOp`.
 *
 * Each of the three used to end in a bare `MoveVob`, so an op kind nobody wrote
 * a branch for was silently treated as a move: `writeOp` would send it to
 * `setVobPosition`, `applyOps` would write `positions[NaN]` — dropped by the
 * spec, so nothing moved and the caller was told a VOB had — and `invertOp`
 * would happen to be right, which is the worst of the three. `WorldOp` is a
 * compile-time claim about data that arrives over IPC, so the refusal has to
 * exist at runtime too.
 */
function unreachableOp(op: never): never {
  throw new RangeError(`unknown op ${(op as WorldOp).op}`);
}

/**
 * Does this op change how many VOBs there are, and therefore the enumeration?
 *
 * A flat index is a VOB's position in a depth-first traversal. Every other op
 * writes into columns that already exist; this one changes how many there are,
 * so the renderer's projection cannot follow it and has to be re-read.
 */
export function isStructuralOp(op: WorldOp): op is AddVob | ReparentVob | DeleteVob {
  return op.op === 'AddVob' || op.op === 'ReparentVob' || op.op === 'DeleteVob';
}

/**
 * Does this op change what *other* VOBs' paths are?
 *
 * Not the same question as `isStructuralOp`, and the difference is what lets an
 * add share a batch. Every op in a batch carries a path resolved before the
 * batch ran, so an op that renumbers invalidates the ones after it — but a VOB
 * appended to the *roots* is enumerated last and shifts nothing. A reparent has
 * two ends and everything between them moves; an add with a parent is
 * enumerated in the middle and everything after that parent's subtree moves.
 *
 * Exported because the renderer needs the same answer for a different reason:
 * a selection is a list of flat indices, and after an op that renumbers there
 * is no telling which VOB one of them now names.
 */
/**
 * Does this op write the waynet rather than a VOB?
 *
 * The partition every consumer of a batch needs. `isStructuralOp` is false for a
 * waynet op — correctly, it changes no enumeration — and the projection path is
 * `applyOps`, which has only VOB columns to write. Without this the op reaches
 * `applyOps` and is refused *after* `commitOps` has already changed the
 * authoritative world, leaving the world one edit ahead of a history that
 * cannot undo it.
 */
export function isWaynetOp(op: WorldOp): op is WaynetOp {
  return op.op === 'MoveWaypoint' || op.op === 'RenameWaypoint';
}

export function renumbersPaths(op: WorldOp): boolean {
  // A delete has no exception to match the appended root's. An add can be
  // enumerated last and shift nothing; a removal takes every VOB after it down
  // by one wherever it sits, roots included.
  return op.op === 'ReparentVob' || op.op === 'DeleteVob'
    || (op.op === 'AddVob' && op.parentPath !== null);
}

/**
 * Is this op a barrier — one the history cannot replay backwards?
 *
 * The predicate that replaced `invertOp` as the gate (§15). `WorldService` reads
 * it to clear both stacks instead of pushing a batch it could never undo, and
 * the World surface reads it to warn before the op lands. Its whole membership
 * is `DeleteVob`, and the point of asking by predicate rather than by name is
 * that the next uninvertible op joins it without either caller learning a
 * second name.
 */
export function isBarrierOp(op: WorldOp): op is DeleteVob {
  return op.op === 'DeleteVob';
}

/** Why a barrier op has no inverse — thrown by both dispatches that would need
 *  one, so the two cannot drift into disagreeing about it. */
function barrierError(op: WorldOp): RangeError {
  return new RangeError(
    `${op.op} is a barrier: it has no inverse, and the history clears rather than replaying it`,
  );
}

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
 * Drop each selected VOB straight to a ground point found for it alone — a
 * per-VOB batch, unlike `translateVobs`: there is no shared delta, because
 * each VOB's ground point comes from its own downward raycast rather than
 * from one drag gizmo. Still one atomic batch and one undo entry, and still
 * refused whole rather than partially applied when a VOB is not in the index.
 */
export function dropVobsToGround(
  reader: VobReader,
  drops: readonly { vob: number; ground: ZenPosition }[],
): MoveVob[] {
  return drops.map(({ vob, ground }) => moveVob(reader, vob, ground));
}

/**
 * The rotation matrix that carries unit vector `from` onto unit vector `to`
 * by the shortest arc (Rodrigues' formula, about their cross product). Falls
 * back to an arbitrary perpendicular axis for the antiparallel case, where the
 * cross product is zero and any axis through that pair is a valid 180° turn.
 */
function rotationBetween(from: ZenPosition, to: ZenPosition): ZenRotation {
  const dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  const IDENTITY: ZenRotation = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (dot > 1 - 1e-9) return IDENTITY;

  let axis: ZenPosition = [
    from[1] * to[2] - from[2] * to[1],
    from[2] * to[0] - from[0] * to[2],
    from[0] * to[1] - from[1] * to[0],
  ];
  let sin = Math.hypot(axis[0], axis[1], axis[2]);

  if (dot < -1 + 1e-9) {
    // Antiparallel: the cross product is ~zero, so pick any axis perpendicular
    // to `from` instead of the one between the (undefined) pair.
    const reference: ZenPosition = Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    axis = [
      from[1] * reference[2] - from[2] * reference[1],
      from[2] * reference[0] - from[0] * reference[2],
      from[0] * reference[1] - from[1] * reference[0],
    ];
    sin = Math.hypot(axis[0], axis[1], axis[2]);
  }

  const [x, y, z] = [axis[0] / sin, axis[1] / sin, axis[2] / sin];
  const oneMinusCos = 1 - dot;

  // I + sin(θ)·K + (1 - cos θ)·K², K the cross-product matrix of the axis.
  return [
    dot + x * x * oneMinusCos, x * y * oneMinusCos - z * sin, x * z * oneMinusCos + y * sin,
    y * x * oneMinusCos + z * sin, dot + y * y * oneMinusCos, y * z * oneMinusCos - x * sin,
    z * x * oneMinusCos - y * sin, z * y * oneMinusCos + x * sin, dot + z * z * oneMinusCos,
  ];
}

/**
 * Turn each selected VOB so its local **+Y axis** aligns to a hit normal found
 * for it alone (level-editor.md §16.5) — the engine is Y-up, so +Y is the
 * standard default, with no per-visual-class exception. A per-VOB batch for
 * the same reason `dropVobsToGround` is: each VOB's normal comes from its own
 * raycast, not from one shared delta.
 *
 * The turn is composed on the left, same as `rotateVobs`: it rotates the VOB's
 * current local Y axis (the matrix's middle column) onto the normal, in world
 * space, leaving whatever the VOB's orientation already had about that axis
 * alone rather than resetting it.
 */
export function alignVobsToNormal(
  reader: VobReader,
  hits: readonly { vob: number; normal: ZenPosition }[],
  boundsOf: (vob: number) => ZenBounds | null,
): RotateVob[] {
  return hits.map(({ vob, normal }) => {
    const from = reader.rotation(vob);
    if (from === null) throw new RangeError(`no vob ${vob} in the index`);

    const currentUp: ZenPosition = [from[1], from[4], from[7]];
    const length = Math.hypot(normal[0], normal[1], normal[2]);
    const unitNormal: ZenPosition = [normal[0] / length, normal[1] / length, normal[2] / length];
    const delta = rotationBetween(currentUp, unitNormal);

    return rotateVob(reader, vob, multiplyRotation(delta, from as ZenRotation), boundsOf(vob));
  });
}

/**
 * A move of one waypoint, in ZenGin space.
 *
 * Takes the waynet payload's own columns rather than a reader, because there is
 * no waynet equivalent of `VobReader` and this op needs no part of one: an index
 * into `positions`, and the name at the same index. `from` is read out of the
 * payload for the same reason every other op reads it — undo replays an op and
 * never consults a snapshot beside the history.
 */
export function moveWaypoint(
  positions: Float32Array,
  names: readonly string[],
  waypoint: number,
  to: ZenPosition,
): MoveWaypoint {
  if (waypoint < 0 || waypoint >= names.length) {
    throw new RangeError(`no waypoint ${waypoint} in the waynet`);
  }

  const at = waypoint * 3;
  return {
    op: 'MoveWaypoint',
    waypoint,
    name: names[waypoint],
    from: [positions[at], positions[at + 1], positions[at + 2]],
    to,
  };
}

/**
 * A rename of one waypoint.
 *
 * Takes the payload's own names for the same reason `moveWaypoint` takes its
 * positions: there is no waynet reader, and `from` has to be read where the op
 * is made rather than out of the world at apply time.
 *
 * The new name is not checked here. Emptiness and collision are refused by the
 * binding, which is the only layer that can see the whole point list — this one
 * is handed the payload the overlay happens to be holding.
 */
export function renameWaypoint(
  names: readonly string[],
  waypoint: number,
  to: string,
): RenameWaypoint {
  if (waypoint < 0 || waypoint >= names.length) {
    throw new RangeError(`no waypoint ${waypoint} in the waynet`);
  }

  return { op: 'RenameWaypoint', waypoint, from: names[waypoint], to };
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

/**
 * Set class fields on one VOB, given what it currently holds.
 *
 * `current` is the props the reader in `zenkit-node` answered for this VOB — the
 * whole of the `from` side, because the columnar index has none of it. It is
 * taken as a whole rather than per key so the caller passes what it fetched
 * unchanged; the op keeps only the keys `to` names.
 *
 * The four refusals are all here rather than at the binding, because every one
 * of them is knowable before the world is touched and the alternative is a batch
 * that has already half-applied: an edit that sets nothing (fifty VOBs and a
 * dialog dismissed unchanged), a VOB that is not in the index, a key that this
 * VOB's class does not have, and a key with no value on the `from` side — which
 * would be an inverse that writes `undefined` into the world.
 *
 * The class is stamped from the reader rather than taken from the caller: a
 * caller that could name the class could name the wrong one, and the op is
 * addressed by a path the same reader resolved.
 */
export function setVobClassProp(
  reader: VobReader, vob: number, current: ClassProps, to: ClassProps,
): SetVobClassProp {
  const named = Object.keys(to).filter((key) => to[key] !== undefined);
  if (named.length === 0) {
    throw new RangeError('a class property op must set at least one property');
  }

  const path = vobIndexPath(reader, vob);
  const className = reader.className(vob);
  if (path === null || className === null) throw new RangeError(`no vob ${vob} in the index`);

  for (const key of named) {
    if (fieldOf(className, key) === null) {
      throw new RangeError(`a ${className} has no class property ${key}`);
    }
    if (current[key] === undefined) {
      throw new RangeError(`no current value for ${key}: its inverse would restore nothing`);
    }
  }

  // Catalogue order rather than the order the grid emitted, so two ops built
  // from the same edit are the same object — the property grid iterates a record
  // and the history compares ops.
  const keys = classPropKeys(className).filter((key) => named.includes(key));
  return {
    op: 'SetVobClassProp',
    vob,
    path,
    className,
    from: Object.fromEntries(keys.map((key) => [key, current[key]])),
    to: Object.fromEntries(keys.map((key) => [key, to[key]])),
  };
}

/**
 * Place a new VOB in the world — appended to `parent`'s children, or to the
 * roots when `parent` is null.
 *
 * **A root renumbers nothing and a parent renumbers**, and the whole difference
 * between the two cases is that one sentence. A VOB's flat index is its position
 * in a depth-first traversal, so a VOB appended to the roots is enumerated last
 * and takes the index one past the end; one appended under a parent is
 * enumerated as soon as that parent's subtree ends, and every VOB after it moves
 * up by one — which is why `renumbersPaths` says so, and why `commitOps` refuses
 * the batch unless every op in it is an add (`duplicateVobs`).
 *
 * What makes the renumbering safe is the history's discipline rather than
 * anything here, the same answer `reparentVob` needed: the redo stack is cleared
 * on every new edit and batches replay strictly LIFO, so an op is only ever
 * applied to a world in the enumeration it was recorded against.
 */
export function addVob(reader: VobReader, spec: NewVob, parent: number | null = null): AddVob {
  const parentPath = parent === null ? null : vobIndexPath(reader, parent);
  if (parent !== null && parentPath === null) {
    throw new RangeError(`no VOB ${parent} in this world to place under`);
  }

  const columns = reader.columns;
  if (parentPath === null) {
    // The slot it will occupy among the roots — the binding appends to the same
    // list, so this is the path it comes back with, and `commitOps` refuses the
    // op if it does not.
    let roots = 0;
    for (let vob = 0; vob < reader.count; vob++) if (columns.parent[vob] < 0) roots += 1;
    return {
      op: 'AddVob', vob: reader.count, path: String(roots), parentPath: null, from: null, to: spec,
    };
  }

  let children = 0;
  for (let vob = 0; vob < reader.count; vob++) if (columns.parent[vob] === parent) children += 1;

  return {
    op: 'AddVob',
    vob: subtreeEnd(reader, parent!),
    path: `${parentPath}/${children}`,
    parentPath,
    from: null,
    to: spec,
  };
}

/**
 * Read a VOB back out of the index as something `addVob` can author — the whole
 * of a duplicate (level-editor.md §16.14, D1).
 *
 * A duplicate needs no op of its own: `AddVob` already carries a full
 * description of a VOB, and its one-null-side shape is already its own inverse.
 * What it needs is this — the reading — and the reason it is a function rather
 * than an object literal at the call site is that this is where a field goes
 * missing. **Two do, and both are deliberate.**
 *
 * `physicsEnabled` is dropped because `NewVob` has no place for it: `insertVob`
 * does not take it (`NEW_VOB_FLAG_KEYS` is `VOB_FLAG_KEYS` minus that one).
 * D2 is where it comes back, as a follow-up `SetVobProp` in the same batch.
 *
 * The **bbox is not in the index at all** — there is no column for it — so it
 * comes in as `bounds`, the visual's own box, which the caller already holds
 * for a rotation. It is fitted through the row's own pose, so a turned VOB
 * duplicates with the box it had; without bounds there is nothing honest to
 * fit, and the VOB gets the binding's default exactly as a placement does.
 *
 * The **class is not here either, and neither are the class properties**, which
 * is now a gap rather than a wall: `insertVob` can author a class since I1
 * (§16.15), so a duplicate of an `oCItem` *could* be one — this function still
 * emits no `class`, so a duplicated `oCMobDoor` is a `zCVob` with the door's
 * name, visual and pose. Reading the class back out of the index and carrying
 * the class properties with it is D2's remaining half (§16.14), and it wants
 * the classes I1 does not author yet.
 */
export function duplicateVobSpec(
  reader: VobReader, vob: number, bounds: ZenBounds | null = null,
): NewVob {
  const position = reader.position(vob);
  const rotation = reader.rotation(vob);
  if (position === null || rotation === null) throw new RangeError(`no vob ${vob} in the index`);

  const name = reader.name(vob);
  const visual = reader.visual(vob);
  const flags = reader.flags(vob);

  return {
    ...(name ? { name } : {}),
    ...(visual ? { visual } : {}),
    position,
    rotation: rotation as ZenRotation,
    ...(bounds === null ? {} : { bbox: placeBounds(bounds, rotation as ZenRotation, position) }),
    // Every authorable flag, false ones included: an omitted flag is authored
    // as the binding's default, not as the value the row had.
    showVisual: flags.showVisual,
    vobStatic: flags.vobStatic,
    ambient: flags.ambient,
    cdStatic: flags.cdStatic,
    cdDynamic: flags.cdDynamic,
  };
}

/**
 * Duplicate a whole selection as **one batch**, therefore one undo entry
 * (level-editor.md §16.14, D4).
 *
 * D1's spec, N times, plus the one correction a batch needs — and it is a
 * correction, not a `map`. `addVob` resolves the slot a copy lands in against
 * the world as it was, so two copies of the *same* parent would both claim its
 * last slot and `writeOp` would refuse the second: the list it was appended to
 * has changed since. The slot is advanced here for each copy already appended
 * to that list, roots being one such list like any other.
 *
 * **Nothing else in the batch needs correcting, and that is the whole reason a
 * batch of these is safe at all.** An op addresses the world by an index path,
 * and appending never changes an existing one — a new last child takes a new
 * slot and moves none of its siblings. What an append does change is every
 * *flat* index after it, which is why `renumbersPaths` still says so and why
 * `commitOps` still refuses a delete or a reparent in company.
 *
 * The `vob` each op carries is that flat index, and it is right for the batches
 * that occur: exact for a selection under one parent, and one low only for a
 * copy whose parent is an ancestor of another copy's — the same approximation a
 * single `addVob` already carries into any batch. Nothing reads it either way:
 * a structural op cannot be applied to the projection at all
 * (`isStructuralOp`), so the renderer re-reads the index whole.
 *
 * Like `setVobProps`, one VOB that is not in the index refuses the whole batch
 * rather than being skipped.
 */
export function duplicateVobs(
  reader: VobReader,
  vobs: readonly number[],
  bounds: (vob: number) => ZenBounds | null = () => null,
): AddVob[] {
  // How many copies this batch has already appended to each list — keyed by the
  // parent's path, with the roots keyed by an empty string no path can be.
  const appended = new Map<string, number>();

  return vobs.map((vob) => {
    const parent = reader.columns.parent[vob];
    const op = addVob(
      reader, duplicateVobSpec(reader, vob, bounds(vob)), parent < 0 ? null : parent,
    );

    const list = op.parentPath ?? '';
    const ahead = appended.get(list) ?? 0;
    appended.set(list, ahead + 1);
    return appendedAfter(op, ahead);
  });
}

/**
 * The same op moved along by `ahead` copies already appended to its list.
 *
 * `addVob` resolves a slot against the world as it was, so the second copy into
 * a list would otherwise claim the first one's slot and `writeOp` would refuse
 * it — the list it was appended to has changed since. Shared by `duplicateVobs`
 * and `pasteVobs` because the correction is the same one; only the counting
 * differs, per original's parent there and once per copy here.
 */
function appendedAfter(op: AddVob, ahead: number): AddVob {
  if (ahead === 0) return op;
  const slot = Number(op.path.slice(op.path.lastIndexOf('/') + 1)) + ahead;
  return {
    ...op,
    vob: op.vob + ahead,
    path: op.parentPath === null ? String(slot) : `${op.parentPath}/${slot}`,
  };
}

/**
 * Paste a clipboard of specs into one list — `parent`'s children, or the roots
 * (level-editor.md §16.14, D3).
 *
 * Copy and paste are `duplicateVobs` taken apart at the seam that makes them
 * different verbs: the specs are read out of the index at the copy
 * (`duplicateVobSpec`), and *where* they land is chosen at the paste. So this
 * takes values rather than VOB indices, and a clipboard outlives the selection
 * that filled it — and outlives the VOBs themselves, which is the point of
 * having copied them.
 *
 * All the copies go into the one list, unlike a duplicate, which puts each back
 * beside its own original. That is still a batch of pure adds, so it is still
 * one undo entry and `commitOps` still takes it: an append moves no index path.
 */
export function pasteVobs(
  reader: VobReader, specs: readonly NewVob[], parent: number | null = null,
): AddVob[] {
  return specs.map((spec, ahead) => appendedAfter(addVob(reader, spec, parent), ahead));
}

/**
 * The flat index just past `vob`'s whole subtree — where a depth-first traversal
 * reaches its new last child.
 *
 * A subtree is a contiguous run of indices because the enumeration is strictly
 * pre-order (`CollectVobs` and the columnar builder are the same traversal), so
 * this walks forward from `vob` while each index is still a descendant. The
 * ancestor chain terminates: a parent is always enumerated before its children,
 * so climbing from a later index either reaches `vob` or passes below it.
 */
function subtreeEnd(reader: VobReader, vob: number): number {
  const { parent } = reader.columns;
  let at = vob + 1;
  for (; at < reader.count; at++) {
    let ancestor = parent[at];
    while (ancestor > vob) ancestor = parent[ancestor];
    if (ancestor !== vob) break;
  }
  return at;
}

/**
 * Move a VOB into another parent, at a slot — `toParent` null meaning a root.
 *
 * **It renumbers, and no slot avoids that.** `addVob` sidesteps the question by
 * appending a root; a move has two ends and every VOB between them changes its
 * flat index and its path. What makes that safe is the history's discipline
 * rather than anything here: `WorldService` clears the redo stack on every new
 * edit and replays batches strictly LIFO, so an op is only ever applied to a
 * world in the enumeration it was recorded against. What cannot follow is the
 * renderer's projection, which is re-read whole — `isStructuralOp` says so.
 */
export function reparentVob(
  reader: VobReader, vob: number, toParent: number | null, slot: number,
): ReparentVob {
  const path = vobIndexPath(reader, vob);
  if (path === null) throw new RangeError(`no VOB ${vob} in this world`);

  const parentPath = toParent === null ? null : vobIndexPath(reader, toParent);
  if (toParent !== null && parentPath === null) {
    throw new RangeError(`no VOB ${toParent} in this world to reparent under`);
  }

  // A VOB under its own descendant is unreachable from the roots: not
  // enumerated, not counted, not written — it disappears at the next save. The
  // binding refuses it too; this is here so the UI never offers it.
  if (parentPath !== null && (parentPath === path || parentPath.startsWith(`${path}/`))) {
    throw new RangeError(`VOB ${vob} cannot be reparented into itself or its own descendant`);
  }

  const { parent, childIndex } = reader.columns;
  const was = parent[vob] < 0 ? null : vobIndexPath(reader, parent[vob]);

  return {
    op: 'ReparentVob',
    vob,
    from: { path, parentPath: was, slot: childIndex[vob] },
    to: { path: landingPath(path, parentPath, slot), parentPath, slot },
  };
}

/**
 * Where a VOB moved out of `from` and into `parentPath` at `slot` ends up.
 *
 * The removal vacates a slot, so a destination numbered *after* the VOB in the
 * same list has already shifted down one by the time the insert happens. The
 * binding makes the identical adjustment and `commitOps` checks the two agree —
 * the duplication is deliberate: this side has to predict the path for the op's
 * own inverse, and the disagreement is the signal that the world moved under it.
 */
function landingPath(from: string, parentPath: string | null, slot: number): string {
  if (parentPath === null) return String(slot);

  const source = from.split('/').map(Number);
  const destination = parentPath.split('/').map(Number);
  const sharesParent = destination.length >= source.length
    && source.slice(0, -1).every((index, at) => index === destination[at]);

  if (sharesParent && destination[source.length - 1] > source[source.length - 1]) {
    destination[source.length - 1] -= 1;
  }
  return `${destination.join('/')}/${slot}`;
}

/**
 * Remove a VOB, and with it every VOB under it — the binding erases the slot
 * rather than blanking it, so no hole is left for the writer to trip over.
 *
 * The whole builder is an address lookup, because the op carries nothing else:
 * what a delete would have to carry to be invertible is the one thing it cannot
 * get (`DeleteVob`, above). The flat index rides along for the same reason every
 * op has one — it is what the renderer selected — even though the projection
 * cannot follow this op and re-reads the index whole.
 */
export function deleteVob(reader: VobReader, vob: number): DeleteVob {
  const path = vobIndexPath(reader, vob);
  if (path === null) throw new RangeError(`no VOB ${vob} in this world`);
  return { op: 'DeleteVob', vob, path };
}

/** The op that undoes `op` — pure, and an ordinary op in its own right, for
 *  every op that has one. A barrier does not, and is refused rather than given
 *  an inverse that would restore something else. */
export function invertOp(op: WorldOp): Exclude<WorldOp, DeleteVob> {
  if (isBarrierOp(op)) throw barrierError(op);
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
  if (op.op === 'SetVobClassProp') {
    // No box to swap and no class to swap: the class is the same VOB's on both
    // sides, so the plain swap is the whole inverse.
    return { ...op, from: op.to, to: op.from };
  }
  if (op.op === 'AddVob') {
    // A null side means "not in the world", so swapping the two sides turns an
    // add into a delete and back with no special case of its own.
    return { ...op, from: op.to, to: op.from };
  }
  if (op.op === 'ReparentVob') {
    return { ...op, from: op.to, to: op.from };
  }
  if (op.op === 'MoveWaypoint') {
    return { ...op, from: op.to, to: op.from };
  }
  if (op.op === 'RenameWaypoint') {
    // `from` is the guard as well as the origin, so the swap moves the guard
    // too — which is exactly right: undoing a rename addresses the waypoint by
    // the name the rename gave it.
    return { ...op, from: op.to, to: op.from };
  }
  if (op.op === 'MoveVob') {
    return { ...op, from: op.to, to: op.from };
  }
  return unreachableOp(op);
}

/** The slice of the binding an op needs. Injected, like every other binding
 *  call in this package, so the decision below is testable without the addon. */
export interface OpBinding {
  setVobPosition(path: string, to: ZenPosition): void;
  setVobRotation(path: string, to: ZenRotation, bbox: ZenBounds | null): void;
  /** `bbox` is present only when a visual swap changed it — the binding refuses
   *  a box that no visual swap justifies, so it cannot be passed unconditionally. */
  setVobProp(path: string, props: VobProps & { bbox?: ZenBounds }): void;
  /** Writes the fields a VOB has by virtue of its class. It takes no class name
   *  because it does not need one: it resolves the VOB and switches on the type
   *  it actually has, so a key of another class is refused by that class's own
   *  key table. The `className` the op carries is for the layers that cannot
   *  resolve a VOB at all. */
  setVobClassProp(path: string, props: ClassProps): void;
  /** Appends a VOB to `parentPath`'s children — null for a root — and answers
   *  with the index path it landed at, which `commitOps` checks against the one
   *  the op claims. */
  insertVob(spec: NewVob, parentPath: string | null): string;
  deleteVob(path: string): void;
  /** Moves a VOB and its subtree into `parentPath` at `slot` — null for a root
   *  — and answers with the index path it landed at, which `commitOps` checks
   *  against the one the op predicted. */
  reparentVob(from: string, parentPath: string | null, slot: number): string;
  /** Moves the waypoint at `waypoint` in `getWaynet`'s point list. `name` is the
   *  guard, not the address: the binding refuses a mismatch rather than moving
   *  whichever waypoint the index now names. */
  setWaypointPosition(waypoint: number, name: string, to: ZenPosition): void;
  /** Renames the waypoint at `waypoint`, guarded by `name` the same way. It
   *  refuses an empty name and one another waypoint already carries — the two
   *  refusals the point list can see and this package cannot. */
  setWaypointName(waypoint: number, name: string, to: string): void;
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
  if (op.op === 'SetVobClassProp') {
    // Both directions off the one side `direction` names — `commitOps` unwinds a
    // refused batch by replaying the applied ops through `'from'`, so a branch
    // that only ever read `op.to` would leave the field standing.
    binding.setVobClassProp(op.path, op[direction]);
    return;
  }
  if (op.op === 'ReparentVob') {
    // Undo moves the VOB from where the op *put* it, not from where it started —
    // which is the half swapping `from` and `to` does not give for free.
    const [source, destination] = direction === 'to' ? [op.from, op.to] : [op.to, op.from];
    const landed = binding.reparentVob(source.path, destination.parentPath, destination.slot);
    if (landed !== destination.path) {
      // Put it back before reporting, so a refused op changes nothing — the same
      // contract `commitOps` keeps for a batch.
      binding.reparentVob(landed, source.parentPath, source.slot);
      throw new RangeError(
        `the vob landed at ${landed}, not ${destination.path} — the world has changed under this op`,
      );
    }
    return;
  }
  if (op.op === 'AddVob') {
    const spec = op[direction];
    if (spec === null) {
      binding.deleteVob(op.path);
      return;
    }
    // The guard the enumeration needs. If the list it is appended to has gained
    // or lost a VOB since the op was made, it lands at a different path — and
    // this op's own inverse would then delete somebody else.
    const landed = binding.insertVob(spec, op.parentPath);
    if (landed !== op.path) {
      binding.deleteVob(landed);
      throw new RangeError(
        `the new vob landed at ${landed}, not ${op.path} — the list it was appended to has changed`,
      );
    }
    return;
  }
  if (op.op === 'MoveWaypoint') {
    binding.setWaypointPosition(op.waypoint, op.name, op[direction]);
    return;
  }
  if (op.op === 'RenameWaypoint') {
    // The guard is the *other* side, because this op's guard is its origin:
    // going forward the waypoint is still called `from`, and unwinding it is
    // called `to`.
    binding.setWaypointName(
      op.waypoint, direction === 'to' ? op.from : op.to, op[direction],
    );
    return;
  }
  if (op.op === 'DeleteVob') {
    // Forward only. `renumbersPaths` keeps a delete alone in its batch, so there
    // is no later op to fail and unwind it — and nothing to unwind it *with*,
    // which is the same refusal `invertOp` makes and deliberately the same
    // error, because two dispatches disagreeing about it is how a barrier would
    // quietly become half-invertible.
    if (direction === 'from') throw barrierError(op);
    binding.deleteVob(op.path);
    return;
  }
  if (op.op === 'MoveVob') {
    binding.setVobPosition(op.path, op[direction]);
    return;
  }
  unreachableOp(op);
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
  // Every op carries a path resolved before the batch ran, so one that renumbers
  // makes the ones after it address different VOBs. Refused here rather than
  // left to callers: the batch is where the addresses were resolved, and this is
  // the only place that can see the whole of one.
  //
  // **A batch of adds is the exception, and it is the only one** (§16.14, D4).
  // A path is a chain of sibling slots and every add here is an *append*, so it
  // takes a new last slot and moves none of the paths the ops after it carry —
  // it renumbers flat indices, which no op is addressed by. The exception is
  // written as "all adds" rather than "no delete and no reparent" so that the
  // inverse batch is covered by the same sentence: undo replays these back to
  // front as removals of exactly the slots they appended, which is the one order
  // that leaves the remaining paths standing. Any other op in the batch and the
  // refusal is back, `physicsEnabled`'s follow-up (D2) included.
  const adds = ops.every((op) => op.op === 'AddVob');
  const renumbering = ops.length > 1 && !adds ? ops.find(renumbersPaths) : undefined;
  if (renumbering !== undefined) {
    throw new RangeError(
      `a ${renumbering.op} that renumbers invalidates every path after it: `
      + 'it has to be the only op in its batch',
    );
  }

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

/**
 * Apply waynet ops to the overlay's own positions column, and answer which
 * waypoints moved.
 *
 * The waynet counterpart of `applyOps`, and separate from it because the two
 * write different payloads: `applyOps` has the columnar VOB index, this has the
 * `Float32Array` the point cloud and the edge lines *share*. Written in place
 * rather than rebuilt, because that sharing is the thing keeping the two in
 * agreement.
 */
export function applyWaypointPositions(
  positions: Float32Array, ops: readonly MoveWaypoint[],
): number[] {
  const touched: number[] = [];

  for (const op of ops) {
    const at = op.waypoint * 3;
    if (at < 0 || at + 2 >= positions.length) {
      throw new RangeError(`no waypoint ${op.waypoint} in the waynet`);
    }
    positions[at] = op.to[0];
    positions[at + 1] = op.to[1];
    positions[at + 2] = op.to[2];
    touched.push(op.waypoint);
  }

  return touched;
}

/**
 * Apply rename ops to the payload's own name list, and answer which waypoints
 * were renamed.
 *
 * Separate from `applyWaypointPositions` rather than folded into it, because
 * the two write payloads with opposite lifetimes. The positions column is a
 * `Float32Array` the point cloud and the edge lines *share*, so it is written
 * in place and the sharing is the point. Names are drawn by nothing — only the
 * waypoint panel reads them — so this writes an array the caller then hands to
 * React, and mutating the payload's own would leave the panel showing the old
 * name until something else re-rendered it.
 */
export function applyWaypointNames(
  names: string[], ops: readonly RenameWaypoint[],
): number[] {
  const touched: number[] = [];

  for (const op of ops) {
    if (op.waypoint < 0 || op.waypoint >= names.length) {
      throw new RangeError(`no waypoint ${op.waypoint} in the waynet`);
    }
    names[op.waypoint] = op.to;
    touched.push(op.waypoint);
  }

  return touched;
}

export function applyOps(reader: VobReader, ops: readonly WorldOp[]): number[] {
  const { positions, rotations, flags, nameIndex, visualIndex } = reader.columns;
  const touched: number[] = [];

  for (const op of ops) {
    if (isStructuralOp(op)) {
      // Every other op writes into columns that already exist; this one changes
      // how many there are. The typed arrays cannot grow, and every index after
      // the new VOB would shift if they could — so the caller re-reads the index
      // rather than being handed a projection that quietly disagrees with the
      // world.
      throw new RangeError(
        `${op.op} is structural: re-read the index rather than applying it to the projection`,
      );
    }
    if (isWaynetOp(op)) {
      // Refused by name rather than skipped, for the same reason a structural op
      // is: these are the *VOB* columns and a waypoint has no row in them. The
      // caller partitions the batch — a silent skip would leave the overlay
      // drawing a waypoint the world no longer has there.
      throw new RangeError(
        `${op.op} is a waynet op: it does not project onto the vob columns`,
      );
    }
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
    } else if (op.op === 'SetVobClassProp') {
      // Nothing to write, and said so out loud. The index has the class name and
      // not one field of the class, so this op has no column — but it is still
      // *touched*, because `touched` is what re-attaches the gizmo and re-renders
      // the panels. The alternative shapes both fail worse: falling through to
      // the exhaustiveness tail throws after `commitOps` has already changed the
      // authoritative world, and filtering it out upstream is a partition every
      // caller would have to make identically, with the world one edit ahead of
      // the projection for whichever one forgot.
    } else if (op.op === 'RotateVob') {
      // A rotation is not a move: the position column is not the op's to touch,
      // and the matrix goes in row-major, which is the order it came out in.
      rotations.set(op.to, op.vob * 9);
    } else if (op.op === 'MoveVob') {
      positions[op.vob * 3] = op.to[0];
      positions[op.vob * 3 + 1] = op.to[1];
      positions[op.vob * 3 + 2] = op.to[2];
    } else {
      unreachableOp(op);
    }
    touched.push(op.vob);
  }

  return touched;
}
