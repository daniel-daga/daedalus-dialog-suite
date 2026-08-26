import { create } from 'zustand';
import type { WorldSummary } from '../../shared/worldTypes';

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

  beginOpen: () => void;
  openSucceeded: (summary: WorldSummary) => void;
  openFailed: (error: string) => void;
  selectVob: (vob: number | null) => void;
  reset: () => void;
}

export const useWorldStore = create<WorldStore>((set) => ({
  status: 'idle',
  summary: null,
  error: null,
  selectedVob: null,

  beginOpen: () => set({ status: 'opening', error: null, summary: null, selectedVob: null }),
  openSucceeded: (summary) => set({ status: 'ready', summary, error: null }),
  openFailed: (error) => set({ status: 'error', error, summary: null }),
  selectVob: (selectedVob) => set({ selectedVob }),
  reset: () => set({ status: 'idle', summary: null, error: null, selectedVob: null }),
}));

// `describeVob` used to live here, reading one VOB out of the columnar index
// for a one-line status bar. The property grid replaced it, and it reads
// through `zen-world`'s `createVobReader` instead — which makes its column
// views once rather than five typed arrays per call, because a virtualized tree
// over 23,288 VOBs calls it on every scroll frame.
