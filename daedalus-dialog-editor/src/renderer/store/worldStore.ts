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

/** The class, name and visual of one VOB, read out of the columnar index. */
export function describeVob(summary: WorldSummary, vob: number): {
  index: number;
  className: string;
  name: string;
  visual: string;
  visualType: string;
  position: [number, number, number];
} | null {
  const index = summary.vobIndex;
  if (vob < 0 || vob >= index.count) return null;

  const positions = new Float32Array(index.positions);
  return {
    index: vob,
    className: index.classes[new Uint32Array(index.classIndex)[vob]],
    name: index.names[new Uint32Array(index.nameIndex)[vob]],
    visual: index.visuals[new Uint32Array(index.visualIndex)[vob]],
    visualType: index.visualTypes[new Uint32Array(index.visualTypeIndex)[vob]],
    // ZenGin space, unconverted — what the property grid shows and what an op
    // would carry.
    position: [positions[vob * 3], positions[vob * 3 + 1], positions[vob * 3 + 2]],
  };
}
