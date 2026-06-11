import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { useFileStore } from './fileStore';
import {
  cloneSemanticModel,
  cloneQuestNodePositionsForFile,
  normalizeBatchFilePaths,
} from '../utils/historyUtils';
import type {
  QuestNodePosition,
  QuestNodePositionMap,
  QuestBatchHistoryState,
  EditSnapshot,
  EditHistoryState,
} from '../utils/historyUtils';
import type { SemanticModel } from '../types/global';

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
  undoLastQuestBatch: () => void;
  redoLastQuestBatch: () => void;
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

const createEditSnapshot = (
  model: SemanticModel,
  nodePositions: Map<string, QuestNodePositionMap> | undefined,
  timestamp: number
): EditSnapshot => ({
  model: cloneSemanticModel(model),
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
): void => {
  const snapshot = createEditSnapshot(model, questNodePositions.get(filePath), 0);
  const history: EditHistoryState = editHistory.get(filePath) ?? { past: [], future: [] };
  history.past.push(snapshot);
  if (history.past.length > MAX_HISTORY_SIZE) history.past.shift();
  history.future = [];
  editHistory.set(filePath, history);
};

/**
 * Apply a single undo step for filePath on the unified stack: restores the
 * previous model AND node positions. Mutates the Immer draft maps and calls
 * fileStore._applyHistoryModelUpdate for the file state update.
 * Returns true if an undo step was applied.
 */
const applyUndoForFile = (
  editHistory: Map<string, EditHistoryState>,
  questNodePositions: Map<string, Map<string, QuestNodePositionMap>>,
  filePath: string
): boolean => {
  const fileState = useFileStore.getState().openFiles.get(filePath);
  const history = editHistory.get(filePath);
  if (!fileState || !history || history.past.length === 0) {
    return false;
  }

  const previousSnapshot = history.past[history.past.length - 1];
  history.future = [
    createEditSnapshot(fileState.semanticModel, questNodePositions.get(filePath), 0),
    ...history.future
  ];
  history.past = history.past.slice(0, history.past.length - 1);
  questNodePositions.set(filePath, cloneQuestNodePositionsForFile(previousSnapshot.nodePositions));

  // Update file store separately (outside the Immer draft)
  useFileStore.getState()._applyHistoryModelUpdate(
    filePath,
    cloneSemanticModel(previousSnapshot.model)
  );

  return true;
};

/**
 * Apply a single redo step for filePath on the unified stack.
 * Returns true if a redo step was applied.
 */
const applyRedoForFile = (
  editHistory: Map<string, EditHistoryState>,
  questNodePositions: Map<string, Map<string, QuestNodePositionMap>>,
  filePath: string
): boolean => {
  const fileState = useFileStore.getState().openFiles.get(filePath);
  const history = editHistory.get(filePath);
  if (!fileState || !history || history.future.length === 0) {
    return false;
  }

  const nextSnapshot = history.future[0];
  history.past = [
    ...history.past,
    createEditSnapshot(fileState.semanticModel, questNodePositions.get(filePath), 0)
  ];
  if (history.past.length > MAX_HISTORY_SIZE) history.past.shift();
  history.future = history.future.slice(1);
  questNodePositions.set(filePath, cloneQuestNodePositionsForFile(nextSnapshot.nodePositions));

  // Update file store separately (outside the Immer draft)
  useFileStore.getState()._applyHistoryModelUpdate(
    filePath,
    cloneSemanticModel(nextSnapshot.model)
  );

  return true;
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
    set((state) => {
      applyUndoForFile(state.editHistory, state.questNodePositions, filePath);
    });
  },

  redo: (filePath: string) => {
    set((state) => {
      applyRedoForFile(state.editHistory, state.questNodePositions, filePath);
    });
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

  applyQuestModelsWithHistory: (updates: Array<{ filePath: string; model: SemanticModel }>) => {
    if (!updates.length) return;

    const uniqueUpdates = new Map<string, SemanticModel>();
    updates.forEach((entry) => {
      uniqueUpdates.set(entry.filePath, entry.model);
    });

    const fileStoreState = useFileStore.getState();

    set((state) => {
      const appliedFilePaths: string[] = [];
      uniqueUpdates.forEach((_, filePath) => {
        const fileState = fileStoreState.openFiles.get(filePath);
        if (!fileState) return;
        pushUncoalescedSnapshot(
          state.editHistory,
          state.questNodePositions,
          filePath,
          fileState.semanticModel
        );
        appliedFilePaths.push(filePath);
      });

      const batchFilePaths = normalizeBatchFilePaths(appliedFilePaths);
      if (batchFilePaths.length > 0) {
        state.questBatchHistory.past = [...state.questBatchHistory.past, batchFilePaths];
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

  undoLastQuestBatch: () => {
    set((state) => {
      const latestBatch = state.questBatchHistory.past[state.questBatchHistory.past.length - 1];
      if (!latestBatch || latestBatch.length === 0) {
        return;
      }

      const normalizedBatch = normalizeBatchFilePaths(latestBatch);
      const actuallyUndone: string[] = [];
      normalizedBatch.forEach((filePath) => {
        const didUndo = applyUndoForFile(state.editHistory, state.questNodePositions, filePath);
        if (didUndo) {
          actuallyUndone.push(filePath);
        }
      });

      if (actuallyUndone.length === 0) {
        state.questBatchHistory.past = state.questBatchHistory.past.slice(0, state.questBatchHistory.past.length - 1);
        return;
      }

      state.questBatchHistory.past = state.questBatchHistory.past.slice(0, state.questBatchHistory.past.length - 1);
      state.questBatchHistory.future = [actuallyUndone, ...state.questBatchHistory.future];
    });
  },

  redoLastQuestBatch: () => {
    set((state) => {
      const latestBatch = state.questBatchHistory.future[0];
      if (!latestBatch || latestBatch.length === 0) {
        return;
      }

      const normalizedBatch = normalizeBatchFilePaths(latestBatch);
      const actuallyRedone: string[] = [];
      normalizedBatch.forEach((filePath) => {
        const didRedo = applyRedoForFile(state.editHistory, state.questNodePositions, filePath);
        if (didRedo) {
          actuallyRedone.push(filePath);
        }
      });

      if (actuallyRedone.length === 0) {
        state.questBatchHistory.future = state.questBatchHistory.future.slice(1);
        return;
      }

      state.questBatchHistory.future = state.questBatchHistory.future.slice(1);
      state.questBatchHistory.past = [...state.questBatchHistory.past, actuallyRedone];
    });
  },

  canUndoLastQuestBatch: () => get().questBatchHistory.past.length > 0,

  canRedoLastQuestBatch: () => get().questBatchHistory.future.length > 0,

  applyQuestNodePositionWithHistory: (filePath: string, questName: string, nodeId: string, position: QuestNodePosition) => {
    const fileState = useFileStore.getState().openFiles.get(filePath);
    if (!fileState) return;

    set((state) => {
      pushUncoalescedSnapshot(
        state.editHistory,
        state.questNodePositions,
        filePath,
        fileState.semanticModel
      );
      state.questBatchHistory.past = [...state.questBatchHistory.past, [filePath]];
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
        (batch) => !batch.includes(filePath)
      );
      state.questBatchHistory.future = state.questBatchHistory.future.filter(
        (batch) => !batch.includes(filePath)
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
