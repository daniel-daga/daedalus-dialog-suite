/**
 * Problems Store - project-wide lint results for the Problems panel.
 *
 * Reads the parsed per-file models the project store already caches, runs the
 * lint rules via the store-agnostic application layer, and holds the resulting
 * navigable problem list. The heavy logic lives in `problems/domain` and
 * `problems/application`; this store is just the Zustand seam plus the scan
 * scheduling (defer-during-ingestion + debounce) and the cross-scan facts cache.
 */

import { create } from 'zustand';
import type { SemanticModel } from '../../shared/types';
import type { FileFacts, FileModel, Problem } from '../problems/domain/types';
import { scanProject } from '../problems/application/scanProject';
import { useProjectStore } from './projectStore';

/**
 * Trailing delay for parsed-model-driven scans, so watcher batches and
 * keystroke syncs coalesce into one scan instead of one per parseGeneration
 * bump. Manual rescans bypass it via `runScan`.
 */
const SCAN_DEBOUNCE_MS = 300;

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
  /** Immediately re-run every lint rule over the currently-parsed project files. */
  runScan: () => void;
  /**
   * Schedule a scan in response to parsed-model churn. While background
   * ingestion runs this is a no-op that arms exactly one scan for when it
   * completes (a scan per parseGeneration bump over the growing file set would
   * be O(n²)); outside ingestion the scan is debounced by
   * {@link SCAN_DEBOUNCE_MS}.
   */
  requestScan: () => void;
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

export const useProblemsStore = create<ProblemsStore>((set, get) => {
  // Scheduling state and the facts cache live outside the reactive state —
  // nothing renders from them. The WeakMap lets each scan reuse the extracted
  // facts of every file whose model object is unchanged, and drops entries
  // automatically when models are evicted or replaced.
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let scanPendingAfterIngestion = false;
  let factsCache = new WeakMap<SemanticModel, FileFacts>();

  const cancelScheduledScan = (): void => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    scanPendingAfterIngestion = false;
  };

  return {
    ...initialState,

    runScan: () => {
      cancelScheduledScan();
      set({ isScanning: true });

      const project = useProjectStore.getState();
      const files: FileModel[] = Array.from(project.parsedFiles.values()).map((cache) => ({
        filePath: cache.filePath,
        model: cache.semanticModel
      }));
      const knownNpcNames = [...project.npcList, ...project.npcPrototypes];

      const { problems, scannedFileCount } = scanProject({ files, knownNpcNames, factsCache });

      set({
        problems,
        isScanning: false,
        hasScanned: true,
        scannedFileCount,
        totalFileCount: project.allDialogFiles.length
      });
    },

    requestScan: () => {
      if (useProjectStore.getState().isIngesting) {
        scanPendingAfterIngestion = true;
        return;
      }
      if (scanPendingAfterIngestion) {
        // Ingestion just completed: run the single deferred scan right away.
        get().runScan();
        return;
      }
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        get().runScan();
      }, SCAN_DEBOUNCE_MS);
    },

    clear: () => {
      cancelScheduledScan();
      factsCache = new WeakMap();
      set({ ...initialState });
    }
  };
});
