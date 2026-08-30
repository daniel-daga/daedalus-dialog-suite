import { create } from 'zustand';
import { applyOps, createVobReader, isStructuralOp, isWaynetOp } from 'zen-world';
import type { WaynetPayload, WorldOp, WorldSummary } from '../../shared/worldTypes';
import type { WorldLocus, WorldWaynetView } from '../problems/domain/types';

/**
 * World-surface state (level-editor.md §7).
 *
 * The React state never holds the world. What lives here is the summary the
 * worker returned — the lightweight VOB index, the bbox, the per-phase load
 * timings — plus selection. Mesh and texture buffers never enter the store:
 * they go straight from IPC into Three.js.
 *
 * Deliberately without the `immer` middleware every other store uses: the
 * summary carries the `VobIndex`'s `ArrayBuffer` columns, and a draft proxy
 * over binary data is both wrong and expensive.
 */

export type WorldStatus = 'idle' | 'opening' | 'ready' | 'error';

/**
 * A place in the open world something outside the World surface wants looked
 * at — today the Problems panel's click on a world finding (level-editor.md
 * §16.20 slice 2).
 *
 * Only what the surface can actually address: a VOB has a row in the columnar
 * index, a waypoint has a name in the waynet. A polygon has neither and is
 * deliberately absent — framing one is slice 3's, with the mesh it needs.
 *
 * `add-waypoint` is not a jump at all — it is the Problems panel's "Add to
 * world" action on a `waypoint-not-in-world` finding, which names a place the
 * open world does not have and so has no position to frame. What it asks for
 * is the overlay on and the name armed for the next terrain click, which is
 * the same placement `world-add-waypoint` already offers.
 */
export type WorldFocus =
  | { kind: 'vob'; vob: number }
  | { kind: 'waypoint'; name: string }
  | { kind: 'add-waypoint'; name: string };

/**
 * The focus a world locus asks for, or null when the locus names nothing the
 * surface can jump to. The panel uses it twice — to decide whether the row is
 * clickable at all, and to build the request the click sends.
 */
export const worldFocusOf = (locus: WorldLocus): WorldFocus | null => {
  if (locus.vob !== undefined) return { kind: 'vob', vob: locus.vob };
  if (locus.waypoint !== undefined) return { kind: 'waypoint', name: locus.waypoint };
  return null;
};

// The waynet reduced to what a *name* question needs, uppercased once because
// Daedalus is case-insensitive. The overlay's payload — positions, edges,
// flags — stays where it is drawn; this is the reference data the Problems
// scan reads, the way it reads `knownNpcNames` from `projectStore`.
//
// Stored as the `WorldWaynetView` the rule takes, not as a near-twin the scan
// converts: the key set is ~3,000 entries on a retail world and a scan runs on
// every debounced keystroke re-parse, while this runs only on a real change.

/** Whether two name lists hold the same names in the same order. */
const sameNames = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((name, i) => name === b[i]);

/** Whether two key sets hold the same names. Order is not a name question. */
const sameKeys = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...b].every((name) => a.has(name));

interface WorldStore {
  status: WorldStatus;
  summary: WorldSummary | null;
  error: string | null;
  /**
   * Indices into `summary.vobIndex`, not names — names are not unique.
   *
   * Ordered and without duplicates: the **last** entry is the VOB the gizmo
   * anchors on, and a repeat would put two ops on one VOB in a batch that is
   * meant to be one op each.
   */
  selection: readonly number[];
  /**
   * The waypoint the gizmo is on instead, or null.
   *
   * Separate from `selection` rather than folded into it, and never held at the
   * same time as one: a waypoint is not a VOB — it has no row in the columnar
   * index, no properties in the grid and no place in the scene tree — but there
   * is only *one* gizmo, and the mode keys and the delete button follow the
   * same selection it does. Two selections standing at once would make every
   * one of those ambiguous.
   */
  selectedWaypoint: number | null;
  /**
   * The open world's waynet names, or null while none has been read.
   *
   * Null is "nothing is known", never "no waypoint is legal" — the rule that
   * reads it returns no findings rather than calling every script site
   * dangling.
   */
  waynetNames: WorldWaynetView | null;
  /** A refused edit, or one the *view* could not follow — a failure past the
   *  commit point, which says so rather than claiming a refusal. Deliberately
   *  not `error`/`status: 'error'`, which replaces the whole surface: the world
   *  is still open, and in the refusal case still correct. */
  editError: string | null;
  /**
   * A jump the World surface has been asked for and has not made yet, or null.
   *
   * A command rather than a state, and consumed exactly once: the same finding
   * is clicked twice precisely after the camera has been flown away from it,
   * so a request that stood would make the second click do nothing.
   */
  focusRequest: WorldFocus | null;

  beginOpen: () => void;
  openSucceeded: (summary: WorldSummary) => void;
  openFailed: (error: string) => void;
  /** Replace the selection — a plain click. `null` clears it. */
  selectVob: (vob: number | null) => void;
  /** Add or remove one VOB — a Ctrl/Cmd click, which is how a batch is built. */
  toggleVob: (vob: number) => void;
  /**
   * Publish the waynet the World surface just read. The object identity is
   * kept when no name changed, which is what keeps a `SetWaypointEdge` or a
   * `MoveWaypoint` re-read from triggering a project-wide re-scan: only
   * `AddWaypoint`, `DeleteWaypoint` and `RenameWaypoint` can change the set.
   */
  waynetLoaded: (payload: WaynetPayload | null) => void;
  /** Put the gizmo on a waypoint instead — the waynet overlay's own pick.
   *  `null` clears it. */
  selectWaypoint: (waypoint: number | null) => void;
  /** Ask the World surface to select and frame a place in the open world. */
  requestFocus: (focus: WorldFocus) => void;
  /** The surface took the request — clear it, so the next one is a new jump. */
  focusHandled: () => void;
  /** Apply ops the main process has already applied to the authoritative world. */
  applyEdit: (ops: readonly WorldOp[]) => void;
  /** A re-read of the VOB enumeration after a structural edit. The columns are
   *  new buffers, so every cached reader over the old summary is stale — which
   *  is why this replaces the summary rather than writing into it. */
  indexRefreshed: (summary: WorldSummary) => void;
  editFailed: (error: string) => void;
  reset: () => void;
}

const EMPTY = {
  status: 'idle' as WorldStatus,
  summary: null,
  error: null,
  selection: [] as readonly number[],
  selectedWaypoint: null as number | null,
  waynetNames: null as WorldWaynetView | null,
  editError: null,
  focusRequest: null as WorldFocus | null,
};

/**
 * The class a free point is. Not a name convention — `FP_` is one, and it is
 * carried by VOBs of other classes too — so the class is what this selects on.
 */
const FREE_POINT_CLASS = 'zCVobSpot';

/**
 * The world's free-point names, uppercased and in index order.
 *
 * **From the VOBs, because that is where a world keeps them.** Retail NewWorld
 * holds 2,254 `zCVobSpot`s named `FP_*`; its waynet holds one waypoint with the
 * stored `free_point` flag, `TOT`, which no script mentions. This used to read
 * that flag, so the Problems rule's free-point branch could suppress nothing
 * and every one of the 874 `FP_` sites in the retail scripts raised a warning.
 *
 * One pass over the interned columns, on a world open or an index refresh —
 * never per scan and never per render.
 */
const freePointsOf = (summary: WorldSummary | null): string[] => {
  if (summary === null) return [];
  const { vobIndex } = summary;
  const spotClass = vobIndex.classes.indexOf(FREE_POINT_CLASS);
  if (spotClass < 0) return [];

  const classIndex = new Uint32Array(vobIndex.classIndex);
  const nameIndex = new Uint32Array(vobIndex.nameIndex);
  const names = new Set<string>();
  for (let vob = 0; vob < vobIndex.count; vob += 1) {
    if (classIndex[vob] !== spotClass) continue;
    const name = vobIndex.names[nameIndex[vob]];
    // An unnamed spot is a place nothing can name, so it answers for nothing.
    if (name) names.add(name.toUpperCase());
  }
  return [...names];
};

/**
 * The free point a script name reaches, as a VOB index — `worldHasPoint`'s
 * answer made concrete, so the jump it enables lands on something.
 *
 * Exact first, then the first spot whose name contains the fragment: the
 * engine's own order, and the resolver's.
 */
export const findFreePointVob = (summary: WorldSummary | null, name: string): number | null => {
  if (summary === null) return null;
  const { vobIndex } = summary;
  const spotClass = vobIndex.classes.indexOf(FREE_POINT_CLASS);
  if (spotClass < 0) return null;

  const upper = name.toUpperCase();
  const classIndex = new Uint32Array(vobIndex.classIndex);
  const nameIndex = new Uint32Array(vobIndex.nameIndex);
  let fragment: number | null = null;
  for (let vob = 0; vob < vobIndex.count; vob += 1) {
    if (classIndex[vob] !== spotClass) continue;
    const spot = vobIndex.names[nameIndex[vob]]?.toUpperCase();
    if (!spot) continue;
    if (spot === upper) return vob;
    if (fragment === null && spot.includes(upper)) fragment = vob;
  }
  return fragment;
};

/** The VOB the panels describe and the gizmo sits on: the last one selected. */
export const primaryVob = (selection: readonly number[]): number | null =>
  (selection.length === 0 ? null : selection[selection.length - 1]);

export const useWorldStore = create<WorldStore>((set, get) => ({
  ...EMPTY,

  beginOpen: () => set({ ...EMPTY, status: 'opening' }),
  openSucceeded: (summary) => set({ ...EMPTY, status: 'ready', summary }),
  openFailed: (error) => set({ ...EMPTY, status: 'error', error }),
  // Both VOB picks drop the waypoint, and the waypoint pick drops them, for the
  // reason `selectedWaypoint` documents: one gizmo.
  selectVob: (vob) => set({ selection: vob === null ? [] : [vob], selectedWaypoint: null }),

  toggleVob: (vob) => set(({ selection }) => ({
    selection: selection.includes(vob)
      ? selection.filter((selected) => selected !== vob)
      // Appended, so the VOB just added is the one the gizmo anchors on.
      : [...selection, vob],
    selectedWaypoint: null,
  })),

  selectWaypoint: (selectedWaypoint) => set({ selectedWaypoint, selection: [] }),

  // A fresh object every time, which is what makes two clicks on one finding
  // two jumps: the surface consumes it by identity.
  requestFocus: (focus) => set({ focusRequest: focus }),
  focusHandled: () => set({ focusRequest: null }),

  waynetLoaded: (payload) => {
    // A payload with no points is stored as *no knowledge*, not as a world
    // whose every waypoint site is wrong: `normalize.cc` answers a world with
    // no waynet chunk with an empty point list rather than throwing, and null
    // is what both readers already take for "nothing is known".
    if (payload === null || payload.names.length === 0) {
      if (get().waynetNames !== null) set({ waynetNames: null });
      return;
    }

    const pointNameKeys = new Set(payload.names.map((name) => name.toUpperCase()));
    // The free points are the summary's, not this payload's: they are VOBs.
    // The summary is already stored when a waynet arrives — `openSucceeded`
    // runs first and the surface reads the waynet after it.
    const freePointNames = freePointsOf(get().summary);

    // Both sets, because a re-read can change either: an edge op leaves every
    // name alone, and a scan that early-returned on names would leave a stale
    // free-point set standing behind a false warning.
    const current = get().waynetNames;
    if (current !== null
      && sameKeys(current.pointNameKeys, pointNameKeys)
      && sameNames(current.freePointNames, freePointNames)) return;

    set({ waynetNames: { pointNameKeys, freePointNames } });
  },

  applyEdit: (ops) => {
    const summary = get().summary;
    // A keystroke can arrive between closing one world and opening the next.
    if (summary === null) return;

    // A structural op changes how many VOBs there are, so there is no column to
    // write it into — `zen-world`'s `applyOps` refuses one by name. The whole
    // batch is left alone rather than partly applied, because the caller follows
    // it with `indexRefreshed`, which supersedes anything this could have
    // written.
    if (ops.some(isStructuralOp)) return;

    // Straight into the columns the worker sent, so neither the summary nor
    // the index changes identity: `vobModelOf` caches the tree and the column
    // views against the summary because a virtualized tree over 23,288 VOBs
    // reads them on every scroll frame, and a replaced index would leave every
    // cached reader pointing at the old buffers. A fresh reader here is one
    // more set of views over those same buffers — the cached one sees the
    // write, which is the point.
    //
    // React sees nothing change, which is why what re-renders the panels is the
    // World surface's own `appliedOps` state rather than anything here.
    //
    // Waynet ops are filtered rather than left to `applyOps`, which refuses one
    // by name: they have no row in these columns, but they are not structural
    // either, so the guard above does not catch them and the refusal would
    // throw here — after the authoritative world had already been committed.
    // The waynet overlay's own payload is updated by the World surface, which
    // is the only place that holds one.
    applyOps(createVobReader(summary.vobIndex), ops.filter((op) => !isWaynetOp(op)));
    if (get().editError !== null) set({ editError: null });
  },

  // The selection is kept, and whether that is right is the caller's to decide.
  // A VOB appended to the *roots* takes the index one past the end, so nothing
  // selected has been renumbered — but a reparent and a parented add both move
  // every index after them, and the World surface clears the selection before
  // it gets here (`renumbersPaths`). Clearing it unconditionally would drop a
  // selection an ordinary placement leaves perfectly valid.
  // A structural edit can add or delete a free point without touching the
  // waynet — `AddVob` of a `zCVobSpot` refreshes the index and fires no waynet
  // read at all — so this is the only place that change can be seen. The view
  // object is kept when the set did not move: its identity is what makes the
  // Problems scan re-run, and a drag must not cost a project-wide re-scan.
  indexRefreshed: (summary) => {
    const current = get().waynetNames;
    if (current === null) { set({ summary, editError: null }); return; }

    const freePointNames = freePointsOf(summary);
    if (sameNames(current.freePointNames, freePointNames)) {
      set({ summary, editError: null });
      return;
    }
    set({
      summary,
      editError: null,
      waynetNames: { pointNameKeys: current.pointNameKeys, freePointNames },
    });
  },

  editFailed: (editError) => set({ editError }),

  reset: () => set({ ...EMPTY }),
}));

// `describeVob` used to live here, reading one VOB out of the columnar index
// for a one-line status bar. The property grid replaced it, and it reads
// through `zen-world`'s `createVobReader` instead — which makes its column
// views once rather than five typed arrays per call, because a virtualized tree
// over 23,288 VOBs calls it on every scroll frame.
