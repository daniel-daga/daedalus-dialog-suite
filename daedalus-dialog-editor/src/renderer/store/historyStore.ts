import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { useFileStore } from './fileStore';
import {
  cloneQuestNodePositionsForFile,
} from '../utils/historyUtils';
import type {
  QuestNodePosition,
  QuestNodePositionMap,
  QuestBatchHistoryState,
  QuestBatchEntry,
  EditSnapshot,
  EditHistoryState,
} from '../utils/historyUtils';
import type { SemanticModel } from '../types/global';

/**
 * Result of a quest batch undo/redo attempt. `ok: false` with a `message` means
 * the batch was refused (a newer edit sits on top of one of its files); callers
 * should surface the message rather than treating it as a silent no-op.
 */
export interface QuestBatchUndoResult {
  ok: boolean;
  message?: string;
}

const MAX_HISTORY_SIZE = 50;
const COALESCE_MS = 300;

// Enable Map/Set support in Immer
enableMapSet();

interface HistoryStore {
  // Unified edit history: dialog and quest surfaces share one stack per file.
  // Snapshots capture the semantic model AND quest node positions, so undo
  // from either surface walks the same per-file timeline.
  editHistory: Map<string, EditHistoryState>;
  pushSnapshot: (filePath: string) => void;
  undo: (filePath: string) => void;
  redo: (filePath: string) => void;
  canUndo: (filePath: string) => boolean;
  canRedo: (filePath: string) => boolean;

  // Multi-file quest operations additionally record which files changed
  // together, so the quest surface can undo/redo a whole batch at once.
  questBatchHistory: QuestBatchHistoryState;
  questNodePositions: Map<string, Map<string, QuestNodePositionMap>>;

  applyQuestModelWithHistory: (filePath: string, model: SemanticModel) => void;
  applyQuestModelsWithHistory: (updates: Array<{ filePath: string; model: SemanticModel }>) => void;
  undoQuestModel: (filePath: string) => void;
  redoQuestModel: (filePath: string) => void;
  canUndoQuestModel: (filePath: string) => boolean;
  canRedoQuestModel: (filePath: string) => boolean;
  undoLastQuestBatch: () => QuestBatchUndoResult;
  redoLastQuestBatch: () => QuestBatchUndoResult;
  canUndoLastQuestBatch: () => boolean;
  canRedoLastQuestBatch: () => boolean;
  applyQuestNodePositionWithHistory: (
    filePath: string,
    questName: string,
    nodeId: string,
    position: QuestNodePosition
  ) => void;
  setQuestNodePosition: (
    filePath: string,
    questName: string,
    nodeId: string,
    position: QuestNodePosition
  ) => void;
  getQuestNodePositions: (filePath: string, questName: string) => QuestNodePositionMap;
  clearQuestNodePositions: (filePath: string, questName?: string) => void;

  // Internal cleanup actions called by subscription
  clearHistoryForFile: (filePath: string) => void;
  resetHistory: () => void;
  resetBatchHistory: () => void;
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
const createEditSnapshot = (
  model: SemanticModel,
  nodePositions: Map<string, QuestNodePositionMap> | undefined,
  timestamp: number
): EditSnapshot => ({
  model,
  nodePositions: cloneQuestNodePositionsForFile(nodePositions),
  timestamp,
});

/**
 * Push a snapshot of the file's current state onto its past stack without
 * coalescing (timestamp 0 prevents later pushes from coalescing into it).
 * Used for quest-surface operations, which are explicit commands.
 */
const pushUncoalescedSnapshot = (
  editHistory: Map<string, EditHistoryState>,
  questNodePositions: Map<string, Map<string, QuestNodePositionMap>>,
  filePath: string,
  model: SemanticModel
): EditSnapshot => {
  const snapshot = createEditSnapshot(model, questNodePositions.get(filePath), 0);
  const history: EditHistoryState = editHistory.get(filePath) ?? { past: [], future: [] };
  history.past.push(snapshot);
  if (history.past.length > MAX_HISTORY_SIZE) history.past.shift();
  history.future = [];
  editHistory.set(filePath, history);
  return snapshot;
};

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

/**
 * Move the stacks for a planned undo step. Mutates the Immer draft maps and
 * returns the freshly created future snapshot (the one redo would restore),
 * so quest batch history can record its identity for a later staleness check.
 */
const commitUndoForFile = (
  editHistory: Map<string, EditHistoryState>,
  questNodePositions: Map<string, Map<string, QuestNodePositionMap>>,
  step: RestoreStep
): EditSnapshot | null => {
  const history = editHistory.get(step.filePath);
  if (!history) return null;
  const futureSnapshot = createEditSnapshot(step.currentModel, questNodePositions.get(step.filePath), 0);
  history.future = [futureSnapshot, ...history.future];
  history.past = history.past.slice(0, history.past.length - 1);
  questNodePositions.set(step.filePath, cloneQuestNodePositionsForFile(step.snapshot.nodePositions));
  return futureSnapshot;
};

/**
 * Move the stacks for a planned redo step. Mutates the Immer draft maps and
 * returns the freshly created past snapshot (the one a subsequent undo would
 * restore), so quest batch history can record its identity for the guard.
 */
const commitRedoForFile = (
  editHistory: Map<string, EditHistoryState>,
  questNodePositions: Map<string, Map<string, QuestNodePositionMap>>,
  step: RestoreStep
): EditSnapshot | null => {
  const history = editHistory.get(step.filePath);
  if (!history) return null;
  const pastSnapshot = createEditSnapshot(step.currentModel, questNodePositions.get(step.filePath), 0);
  history.past = [...history.past, pastSnapshot];
  if (history.past.length > MAX_HISTORY_SIZE) history.past.shift();
  history.future = history.future.slice(1);
  questNodePositions.set(step.filePath, cloneQuestNodePositionsForFile(step.snapshot.nodePositions));
  return pastSnapshot;
};

/** Restore the planned snapshot models into fileStore (outside the Immer draft). */
const applyRestoreSteps = (steps: RestoreStep[]): void => {
  steps.forEach((step) => {
    useFileStore.getState()._applyHistoryModelUpdate(step.filePath, step.snapshot.model);
  });
};

export const useHistoryStore = create<HistoryStore>()(immer((set, get) => ({
  editHistory: new Map(),
  questBatchHistory: { past: [], future: [] },
  questNodePositions: new Map(),

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

    const snapshot = createEditSnapshot(
      fileState.semanticModel,
      get().questNodePositions.get(filePath),
      now
    );

    set((state) => {
      const h: EditHistoryState = state.editHistory.get(filePath) ?? { past: [], future: [] };
      h.past.push(snapshot);
      if (h.past.length > MAX_HISTORY_SIZE) h.past.shift();
      h.future = [];
      state.editHistory.set(filePath, h);
    });
  },

  undo: (filePath: string) => {
    const step = planUndoForFile(get().editHistory, filePath);
    if (!step) return;
    set((state) => {
      commitUndoForFile(state.editHistory, state.questNodePositions, step);
    });
    applyRestoreSteps([step]);
  },

  redo: (filePath: string) => {
    const step = planRedoForFile(get().editHistory, filePath);
    if (!step) return;
    set((state) => {
      commitRedoForFile(state.editHistory, state.questNodePositions, step);
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

  applyQuestModelWithHistory: (filePath: string, model: SemanticModel) => {
    get().applyQuestModelsWithHistory([{ filePath, model }]);
  },

  // Raw, validation-free primitive: pushes history snapshots and swaps in the new models
  // with no guardrail checks. Quest UI must NOT call this directly — route edits through
  // QuestEditingService.applyQuestUpdates, which recomputes guardrail deltas against
  // apply-time fileStore state and refuses blocking changes before delegating here.
  applyQuestModelsWithHistory: (updates: Array<{ filePath: string; model: SemanticModel }>) => {
    if (!updates.length) return;

    const uniqueUpdates = new Map<string, SemanticModel>();
    updates.forEach((entry) => {
      uniqueUpdates.set(entry.filePath, entry.model);
    });

    const fileStoreState = useFileStore.getState();

    set((state) => {
      const batchEntries: QuestBatchEntry[] = [];
      uniqueUpdates.forEach((_, filePath) => {
        const fileState = fileStoreState.openFiles.get(filePath);
        if (!fileState) return;
        const snapshot = pushUncoalescedSnapshot(
          state.editHistory,
          state.questNodePositions,
          filePath,
          fileState.semanticModel
        );
        batchEntries.push({ filePath, snapshot });
      });

      if (batchEntries.length > 0) {
        state.questBatchHistory.past = [...state.questBatchHistory.past, batchEntries];
        state.questBatchHistory.future = [];
      }
    });

    uniqueUpdates.forEach((model, filePath) => {
      if (fileStoreState.openFiles.has(filePath)) {
        fileStoreState._applyHistoryModelUpdate(filePath, model);
      }
    });
  },

  undoQuestModel: (filePath: string) => {
    get().undo(filePath);
  },

  redoQuestModel: (filePath: string) => {
    get().redo(filePath);
  },

  canUndoQuestModel: (filePath: string) => get().canUndo(filePath),

  canRedoQuestModel: (filePath: string) => get().canRedo(filePath),

  undoLastQuestBatch: (): QuestBatchUndoResult => {
    const { editHistory, questBatchHistory } = get();
    const latestBatch = questBatchHistory.past[questBatchHistory.past.length - 1];
    if (!latestBatch || latestBatch.length === 0) {
      return { ok: false };
    }

    // Snapshot-identity guard: every file's top-of-past must still be the exact
    // snapshot this batch pushed. If a newer edit (e.g. a coalesced dialog edit)
    // landed on top of any file, refuse the whole batch — never revert the wrong
    // change (finding U1). A partial undo would desync the stacks permanently.
    const staleEntry = latestBatch.find((entry) => {
      const history = editHistory.get(entry.filePath);
      return !history || history.past[history.past.length - 1] !== entry.snapshot;
    });
    if (staleEntry) {
      return {
        ok: false,
        message: `Undo the newer edits in ${staleEntry.filePath} first (Ctrl+Z), then retry quest undo.`,
      };
    }

    const steps = latestBatch
      .map((entry) => planUndoForFile(editHistory, entry.filePath))
      .filter((step): step is RestoreStep => step !== null);

    set((state) => {
      const futureEntries: QuestBatchEntry[] = [];
      steps.forEach((step) => {
        const snapshot = commitUndoForFile(state.editHistory, state.questNodePositions, step);
        if (snapshot) futureEntries.push({ filePath: step.filePath, snapshot });
      });
      state.questBatchHistory.past = state.questBatchHistory.past.slice(0, state.questBatchHistory.past.length - 1);
      if (futureEntries.length > 0) {
        state.questBatchHistory.future = [futureEntries, ...state.questBatchHistory.future];
      }
    });
    applyRestoreSteps(steps);
    return { ok: true };
  },

  redoLastQuestBatch: (): QuestBatchUndoResult => {
    const { editHistory, questBatchHistory } = get();
    const latestBatch = questBatchHistory.future[0];
    if (!latestBatch || latestBatch.length === 0) {
      return { ok: false };
    }

    // Mirror of the undo guard: every file's top-of-future must still be the
    // exact snapshot this batch queued for redo. A newer edit clears/replaces
    // the redo future, so redoing would restore stale state — refuse instead.
    const staleEntry = latestBatch.find((entry) => {
      const history = editHistory.get(entry.filePath);
      return !history || history.future[0] !== entry.snapshot;
    });
    if (staleEntry) {
      return {
        ok: false,
        message: `Undo the newer edits in ${staleEntry.filePath} first (Ctrl+Z), then retry quest redo.`,
      };
    }

    const steps = latestBatch
      .map((entry) => planRedoForFile(editHistory, entry.filePath))
      .filter((step): step is RestoreStep => step !== null);

    set((state) => {
      const pastEntries: QuestBatchEntry[] = [];
      steps.forEach((step) => {
        const snapshot = commitRedoForFile(state.editHistory, state.questNodePositions, step);
        if (snapshot) pastEntries.push({ filePath: step.filePath, snapshot });
      });
      state.questBatchHistory.future = state.questBatchHistory.future.slice(1);
      if (pastEntries.length > 0) {
        state.questBatchHistory.past = [...state.questBatchHistory.past, pastEntries];
      }
    });
    applyRestoreSteps(steps);
    return { ok: true };
  },

  canUndoLastQuestBatch: () => {
    const { editHistory, questBatchHistory } = get();
    const latestBatch = questBatchHistory.past[questBatchHistory.past.length - 1];
    if (!latestBatch || latestBatch.length === 0) return false;
    return latestBatch.every((entry) => {
      const history = editHistory.get(entry.filePath);
      return !!history && history.past[history.past.length - 1] === entry.snapshot;
    });
  },

  canRedoLastQuestBatch: () => {
    const { editHistory, questBatchHistory } = get();
    const latestBatch = questBatchHistory.future[0];
    if (!latestBatch || latestBatch.length === 0) return false;
    return latestBatch.every((entry) => {
      const history = editHistory.get(entry.filePath);
      return !!history && history.future[0] === entry.snapshot;
    });
  },

  applyQuestNodePositionWithHistory: (filePath: string, questName: string, nodeId: string, position: QuestNodePosition) => {
    const fileState = useFileStore.getState().openFiles.get(filePath);
    if (!fileState) return;

    set((state) => {
      const snapshot = pushUncoalescedSnapshot(
        state.editHistory,
        state.questNodePositions,
        filePath,
        fileState.semanticModel
      );
      state.questBatchHistory.past = [...state.questBatchHistory.past, [{ filePath, snapshot }]];
      state.questBatchHistory.future = [];

      if (!state.questNodePositions.has(filePath)) {
        state.questNodePositions.set(filePath, new Map());
      }
      const fileQuestPositions = state.questNodePositions.get(filePath)!;
      if (!fileQuestPositions.has(questName)) {
        fileQuestPositions.set(questName, new Map());
      }
      fileQuestPositions.get(questName)!.set(nodeId, {
        x: position.x,
        y: position.y
      });
    });

    // Mark the file dirty in fileStore (model unchanged, only position recorded)
    useFileStore.getState()._markFileDirty(filePath);
  },

  setQuestNodePosition: (filePath: string, questName: string, nodeId: string, position: QuestNodePosition) => {
    set((state) => {
      if (!useFileStore.getState().openFiles.has(filePath)) {
        return;
      }

      if (!state.questNodePositions.has(filePath)) {
        state.questNodePositions.set(filePath, new Map());
      }

      const fileQuestPositions = state.questNodePositions.get(filePath)!;
      if (!fileQuestPositions.has(questName)) {
        fileQuestPositions.set(questName, new Map());
      }

      fileQuestPositions.get(questName)!.set(nodeId, {
        x: position.x,
        y: position.y
      });
    });
  },

  getQuestNodePositions: (filePath: string, questName: string) => {
    const positions = get().questNodePositions.get(filePath)?.get(questName);
    return positions ? new Map(positions) : new Map();
  },

  clearQuestNodePositions: (filePath: string, questName?: string) => {
    set((state) => {
      if (!questName) {
        state.questNodePositions.delete(filePath);
        return;
      }

      const fileQuestPositions = state.questNodePositions.get(filePath);
      if (!fileQuestPositions) return;
      fileQuestPositions.delete(questName);
      if (fileQuestPositions.size === 0) {
        state.questNodePositions.delete(filePath);
      }
    });
  },

  clearHistoryForFile: (filePath: string) => {
    set((state) => {
      state.editHistory.delete(filePath);
      state.questNodePositions.delete(filePath);
      state.questBatchHistory.past = state.questBatchHistory.past.filter(
        (batch) => !batch.some((entry) => entry.filePath === filePath)
      );
      state.questBatchHistory.future = state.questBatchHistory.future.filter(
        (batch) => !batch.some((entry) => entry.filePath === filePath)
      );
    });
  },

  resetHistory: () => {
    set((state) => {
      state.editHistory.clear();
      state.questNodePositions.clear();
      state.questBatchHistory = { past: [], future: [] };
    });
  },

  resetBatchHistory: () => {
    set((state) => {
      state.questBatchHistory = { past: [], future: [] };
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

    // If all files were cleared at once (e.g. session reset), also reset batch history
    if (state.openFiles.size === 0 && prevState.openFiles.size > 0) {
      historyState.resetBatchHistory();
    }
  }

  // Detect source saves: existing file whose originalCode changed and is no longer dirty
  state.openFiles.forEach((fileState, filePath) => {
    const prevFileState = prevState.openFiles.get(filePath);
    if (
      prevFileState &&
      prevFileState.originalCode !== fileState.originalCode &&
      !fileState.isDirty
    ) {
      const historyState = useHistoryStore.getState();
      historyState.clearHistoryForFile(filePath);
      historyState.resetBatchHistory();
    }
  });
});
