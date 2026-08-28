import { create } from 'zustand';
import { applyOps, createVobReader, isStructuralOp, isWaynetOp } from 'zen-world';
import type { WaynetPayload, WorldOp, WorldSummary } from '../../shared/worldTypes';

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
 * The waynet reduced to what a *name* question needs, uppercased once because
 * Daedalus is case-insensitive. The overlay's payload — positions, edges,
 * flags — stays where it is drawn; this is the reference data the Problems
 * scan reads, the way it reads `knownNpcNames` from `projectStore`.
 */
export interface WaynetNames {
  /** Every point's name: waypoints and free points alike. */
  all: readonly string[];
  /** The free-point subset, which the engine matches by prefix. */
  freePoints: readonly string[];
}

const FREE_POINT_FLAG = 1;

/** Whether two name lists hold the same names in the same order. */
const sameNames = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((name, i) => name === b[i]);

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
  waynetNames: WaynetNames | null;
  /** A refused edit. Deliberately not `error`/`status: 'error'`, which replaces
   *  the whole surface: the world is still open and still correct. */
  editError: string | null;

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
  waynetNames: null as WaynetNames | null,
  editError: null,
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

  waynetLoaded: (payload) => {
    if (payload === null) {
      if (get().waynetNames !== null) set({ waynetNames: null });
      return;
    }

    const all = payload.names.map((name) => name.toUpperCase());
    const current = get().waynetNames;
    if (current !== null && sameNames(current.all, all)) return;

    const flags = new Uint32Array(payload.flags);
    const freePoints = all.filter((_, i) => (flags[i] & FREE_POINT_FLAG) !== 0);
    set({ waynetNames: { all, freePoints } });
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
  indexRefreshed: (summary) => set({ summary, editError: null }),

  editFailed: (editError) => set({ editError }),

  reset: () => set({ ...EMPTY }),
}));

// `describeVob` used to live here, reading one VOB out of the columnar index
// for a one-line status bar. The property grid replaced it, and it reads
// through `zen-world`'s `createVobReader` instead — which makes its column
// views once rather than five typed arrays per call, because a virtualized tree
// over 23,288 VOBs calls it on every scroll frame.
