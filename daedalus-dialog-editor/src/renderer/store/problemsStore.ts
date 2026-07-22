/**
 * Problems Store - project-wide lint results for the Problems panel.
 *
 * Reads the parsed per-file models the project store already caches, runs the
 * lint rules via the store-agnostic application layer, and holds the resulting
 * navigable problem list. The heavy logic lives in `problems/domain` and
 * `problems/application`; this store is just the Zustand seam.
 */

import { create } from 'zustand';
import type { Problem } from '../problems/domain/types';
import type { FileModel } from '../problems/domain/types';
import { scanProject } from '../problems/application/scanProject';
import { useProjectStore } from './projectStore';

interface ProblemsState {
  problems: Problem[];
  isScanning: boolean;
  /** True once a scan has completed at least once for the current project. */
  hasScanned: boolean;
  /** Files the last scan actually inspected (parsed models available). */
  scannedFileCount: number;
  /** Total dialog files in the project index (may exceed scannedFileCount mid-ingestion). */
  totalFileCount: number;
}

interface ProblemsActions {
  /** Re-run every lint rule over the currently-parsed project files. */
  runScan: () => void;
  /** Reset to the empty state (e.g. when a project closes). */
  clear: () => void;
}

export type ProblemsStore = ProblemsState & ProblemsActions;

const initialState: ProblemsState = {
  problems: [],
  isScanning: false,
  hasScanned: false,
  scannedFileCount: 0,
  totalFileCount: 0
};

export const useProblemsStore = create<ProblemsStore>((set) => ({
  ...initialState,

  runScan: () => {
    set({ isScanning: true });

    const project = useProjectStore.getState();
    const files: FileModel[] = Array.from(project.parsedFiles.values()).map((cache) => ({
      filePath: cache.filePath,
      model: cache.semanticModel
    }));
    const knownNpcNames = [...project.npcList, ...project.npcPrototypes];

    const { problems, scannedFileCount } = scanProject({ files, knownNpcNames });

    set({
      problems,
      isScanning: false,
      hasScanned: true,
      scannedFileCount,
      totalFileCount: project.allDialogFiles.length
    });
  },

  clear: () => set({ ...initialState })
}));
