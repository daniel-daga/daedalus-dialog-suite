import { create } from 'zustand';
import { applyOps, createVobReader } from 'zen-world';
import type { WorldOp, WorldSummary } from '../../shared/worldTypes';

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

interface WorldStore {
  status: WorldStatus;
  summary: WorldSummary | null;
  error: string | null;
  /** Index into `summary.vobIndex`, not a name — names are not unique. */
  selectedVob: number | null;
  /** A refused edit. Deliberately not `error`/`status: 'error'`, which replaces
   *  the whole surface: the world is still open and still correct. */
  editError: string | null;

  beginOpen: () => void;
  openSucceeded: (summary: WorldSummary) => void;
  openFailed: (error: string) => void;
  selectVob: (vob: number | null) => void;
  /** Apply ops the main process has already applied to the authoritative world. */
  applyEdit: (ops: readonly WorldOp[]) => void;
  editFailed: (error: string) => void;
  reset: () => void;
}

const EMPTY = {
  status: 'idle' as WorldStatus,
  summary: null,
  error: null,
  selectedVob: null,
  editError: null,
};

export const useWorldStore = create<WorldStore>((set, get) => ({
  ...EMPTY,

  beginOpen: () => set({ ...EMPTY, status: 'opening' }),
  openSucceeded: (summary) => set({ ...EMPTY, status: 'ready', summary }),
  openFailed: (error) => set({ ...EMPTY, status: 'error', error }),
  selectVob: (selectedVob) => set({ selectedVob }),

  applyEdit: (ops) => {
    const summary = get().summary;
    // A keystroke can arrive between closing one world and opening the next.
    if (summary === null) return;

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
    applyOps(createVobReader(summary.vobIndex), ops);
    if (get().editError !== null) set({ editError: null });
  },

  editFailed: (editError) => set({ editError }),

  reset: () => set({ ...EMPTY }),
}));

// `describeVob` used to live here, reading one VOB out of the columnar index
// for a one-line status bar. The property grid replaced it, and it reads
// through `zen-world`'s `createVobReader` instead — which makes its column
// views once rather than five typed arrays per call, because a virtualized tree
// over 23,288 VOBs calls it on every scroll frame.
