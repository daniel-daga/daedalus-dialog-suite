import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { useFileStore } from './fileStore';
import type { SemanticModel } from '../types/global';

/**
 * Snapshot used by the per-file edit history. The timestamp coalesces rapid
 * edits into a single undo step. The model is held by reference (structurally
 * shared with Immer-frozen fileStore state), not deep-cloned.
 */
export interface EditSnapshot {
  /** Monotonic, process-unique id assigned when the snapshot is created. */
  id: number;
  model: SemanticModel;
  timestamp: number;
}

export interface EditHistoryState {
  past: EditSnapshot[];
  future: EditSnapshot[];
}

const MAX_HISTORY_SIZE = 50;
const COALESCE_MS = 300;

// Enable Map/Set support in Immer
enableMapSet();

interface HistoryStore {
  // Per-file edit history: snapshots capture the semantic model, so undo
  // walks a per-file timeline.
  editHistory: Map<string, EditHistoryState>;
  pushSnapshot: (filePath: string) => void;
  pushSnapshotTransactional: (filePath: string, mutate: () => void) => void;
  undo: (filePath: string) => void;
  redo: (filePath: string) => void;
  canUndo: (filePath: string) => boolean;
  canRedo: (filePath: string) => boolean;

  // Internal cleanup actions called by subscription
  clearHistoryForFile: (filePath: string) => void;
  resetHistory: () => void;
}

// ---------------------------------------------------------------------------
// Helpers operating on the Immer-draft history maps + fileStore
// ---------------------------------------------------------------------------

/**
 * Snapshot models are stored by reference, never deep-cloned: fileStore state
 * is produced by Immer (copy-on-write, auto-frozen), so a captured model can
 * never be mutated in place afterwards — later edits replace it with a new
 * structurally shared object. The model passed here must therefore come from
 * plain fileStore state (`useFileStore.getState()`), not from an Immer draft.
 */
// Monotonic snapshot-id source. Every EditSnapshot gets a unique id.
let nextSnapshotId = 1;

const createEditSnapshot = (
  model: SemanticModel,
  timestamp: number
): EditSnapshot => ({
  id: nextSnapshotId++,
  model,
  timestamp,
});

/**
 * One planned undo/redo step. Built from plain (non-draft) store state so the
 * snapshot model can be handed to fileStore by reference — reading it through
 * an Immer draft inside set() would leak a revocable proxy.
 */
interface RestoreStep {
  filePath: string;
  snapshot: EditSnapshot;
  currentModel: SemanticModel;
}

/** Plan an undo step for filePath, or null if there is nothing to undo. */
const planUndoForFile = (
  editHistory: Map<string, EditHistoryState>,
  filePath: string
): RestoreStep | null => {
  const fileState = useFileStore.getState().openFiles.get(filePath);
  const history = editHistory.get(filePath);
  if (!fileState || !history || history.past.length === 0) {
    return null;
  }
  return {
    filePath,
    snapshot: history.past[history.past.length - 1],
    currentModel: fileState.semanticModel,
  };
};

/** Plan a redo step for filePath, or null if there is nothing to redo. */
const planRedoForFile = (
  editHistory: Map<string, EditHistoryState>,
  filePath: string
): RestoreStep | null => {
  const fileState = useFileStore.getState().openFiles.get(filePath);
  const history = editHistory.get(filePath);
  if (!fileState || !history || history.future.length === 0) {
    return null;
  }
  return {
    filePath,
    snapshot: history.future[0],
    currentModel: fileState.semanticModel,
  };
};

/** Move the stacks for a planned undo step. Mutates the Immer draft map. */
const commitUndoForFile = (
  editHistory: Map<string, EditHistoryState>,
  step: RestoreStep
): void => {
  const history = editHistory.get(step.filePath);
  if (!history) return;
  const futureSnapshot = createEditSnapshot(step.currentModel, 0);
  history.future = [futureSnapshot, ...history.future];
  history.past = history.past.slice(0, history.past.length - 1);
};

/** Move the stacks for a planned redo step. Mutates the Immer draft map. */
const commitRedoForFile = (
  editHistory: Map<string, EditHistoryState>,
  step: RestoreStep
): void => {
  const history = editHistory.get(step.filePath);
  if (!history) return;
  const pastSnapshot = createEditSnapshot(step.currentModel, 0);
  history.past = [...history.past, pastSnapshot];
  if (history.past.length > MAX_HISTORY_SIZE) history.past.shift();
  history.future = history.future.slice(1);
};

/** Restore the planned snapshot models into fileStore (outside the Immer draft). */
const applyRestoreSteps = (steps: RestoreStep[]): void => {
  steps.forEach((step) => {
    useFileStore.getState()._applyHistoryModelUpdate(step.filePath, step.snapshot.model);
  });
};

export const useHistoryStore = create<HistoryStore>()(immer((set, get) => ({
  editHistory: new Map(),

  pushSnapshot: (filePath: string) => {
    const fileState = useFileStore.getState().openFiles.get(filePath);
    if (!fileState) return;

    const now = Date.now();
    const history = get().editHistory.get(filePath);
    const lastTimestamp = history?.past[history.past.length - 1]?.timestamp ?? 0;

    if (lastTimestamp !== 0 && now - lastTimestamp < COALESCE_MS) {
      // Coalesce: within burst window — clear future to commit this new edit branch
      set((state) => {
        const h = state.editHistory.get(filePath);
        if (h) h.future = [];
      });
      return;
    }

    const snapshot = createEditSnapshot(fileState.semanticModel, now);

    set((state) => {
      const h: EditHistoryState = state.editHistory.get(filePath) ?? { past: [], future: [] };
      h.past.push(snapshot);
      if (h.past.length > MAX_HISTORY_SIZE) h.past.shift();
      h.future = [];
      state.editHistory.set(filePath, h);
    });
  },

  // Push a snapshot, run `mutate`, then roll the snapshot back if the mutation
  // no-opped (finding F-A). fileStore is Immer-produced, so any real change
  // yields a NEW semanticModel object; an unchanged reference means the mutation
  // hit a silent no-op guard (missing dialog/function, updater returned null).
  // In that case restoring the pre-call past/future avoids a phantom undo step
  // and, crucially, avoids wiping the redo `future`.
  pushSnapshotTransactional: (filePath: string, mutate: () => void) => {
    const beforeModel = useFileStore.getState().openFiles.get(filePath)?.semanticModel;

    const prevHistory = get().editHistory.get(filePath);
    const hadHistory = prevHistory !== undefined;
    const capturedPast = prevHistory ? [...prevHistory.past] : [];
    const capturedFuture = prevHistory ? [...prevHistory.future] : [];

    get().pushSnapshot(filePath);
    mutate();

    const afterModel = useFileStore.getState().openFiles.get(filePath)?.semanticModel;

    // Only restore when the file exists and its model reference is unchanged.
    if (beforeModel !== undefined && afterModel === beforeModel) {
      set((state) => {
        if (!hadHistory) {
          state.editHistory.delete(filePath);
          return;
        }
        const h = state.editHistory.get(filePath);
        if (!h) return;
        h.past = capturedPast;
        h.future = capturedFuture;
      });
    }
  },

  undo: (filePath: string) => {
    const step = planUndoForFile(get().editHistory, filePath);
    if (!step) return;
    set((state) => {
      commitUndoForFile(state.editHistory, step);
    });
    applyRestoreSteps([step]);
  },

  redo: (filePath: string) => {
    const step = planRedoForFile(get().editHistory, filePath);
    if (!step) return;
    set((state) => {
      commitRedoForFile(state.editHistory, step);
    });
    applyRestoreSteps([step]);
  },

  canUndo: (filePath: string) => {
    const history = get().editHistory.get(filePath);
    return !!history && history.past.length > 0;
  },

  canRedo: (filePath: string) => {
    const history = get().editHistory.get(filePath);
    return !!history && history.future.length > 0;
  },

  clearHistoryForFile: (filePath: string) => {
    set((state) => {
      state.editHistory.delete(filePath);
    });
  },

  resetHistory: () => {
    set((state) => {
      state.editHistory.clear();
    });
  },
})));

// ---------------------------------------------------------------------------
// File-store subscription: keep history in sync with open-file lifecycle
// ---------------------------------------------------------------------------

/**
 * Subscribe to fileStore changes to automatically clean up history when:
 *  - a file is closed (removed from openFiles)
 *  - source code is saved via saveSource (originalCode changes + isDirty=false)
 *
 * This wires historyStore to fileStore without creating a circular dependency.
 */
useFileStore.subscribe((state, prevState) => {
  if (state.openFiles === prevState.openFiles) return;

  const removedFiles: string[] = [];
  prevState.openFiles.forEach((_, filePath) => {
    if (!state.openFiles.has(filePath)) {
      removedFiles.push(filePath);
    }
  });

  if (removedFiles.length > 0) {
    const historyState = useHistoryStore.getState();
    removedFiles.forEach((fp) => historyState.clearHistoryForFile(fp));
  }

  // Detect source saves: existing file whose originalCode changed and is no
  // longer dirty. Only the saved file's history is cleared.
  state.openFiles.forEach((fileState, filePath) => {
    const prevFileState = prevState.openFiles.get(filePath);
    if (
      prevFileState &&
      prevFileState.originalCode !== fileState.originalCode &&
      !fileState.isDirty
    ) {
      useHistoryStore.getState().clearHistoryForFile(filePath);
    }
  });
});
