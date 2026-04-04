import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { useFileStore } from './fileStore';
import {
  cloneSemanticModel,
  cloneQuestNodePositionsForFile,
  createQuestHistorySnapshot,
  normalizeBatchFilePaths,
} from '../utils/historyUtils';
import type {
  QuestNodePosition,
  QuestNodePositionMap,
  QuestHistoryState,
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
  // Unified edit history (dialog + quest surfaces share one stack per file)
  editHistory: Map<string, EditHistoryState>;
  pushSnapshot: (filePath: string) => void;
  undo: (filePath: string) => void;
  redo: (filePath: string) => void;
  canUndo: (filePath: string) => boolean;
  canRedo: (filePath: string) => boolean;

  questHistory: Map<string, QuestHistoryState>;
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
// Helpers: undo/redo applied against Immer-draft history maps + fileStore
// ---------------------------------------------------------------------------

/**
 * Apply a single undo step for filePath.
 * Mutates the Immer draft maps (questHistory, questNodePositions) and
 * calls fileStore._applyHistoryModelUpdate for the file state update.
 * Returns true if an undo step was applied.
 */
const applyUndoForFile = (
  questHistory: Map<string, QuestHistoryState>,
  questNodePositions: Map<string, Map<string, QuestNodePositionMap>>,
  filePath: string
): boolean => {
  const fileState = useFileStore.getState().openFiles.get(filePath);
  const history = questHistory.get(filePath);
  if (!fileState || !history || history.past.length === 0) {
    return false;
  }

  const previousSnapshot = history.past[history.past.length - 1];
  const remainingPast = history.past.slice(0, history.past.length - 1);
  const nextFuture = [
    createQuestHistorySnapshot(fileState.semanticModel, questNodePositions.get(filePath)),
    ...history.future
  ];

  questHistory.set(filePath, {
    past: remainingPast,
    future: nextFuture
  });
  questNodePositions.set(filePath, cloneQuestNodePositionsForFile(previousSnapshot.nodePositions));

  // Update file store separately (outside the Immer draft)
  useFileStore.getState()._applyHistoryModelUpdate(
    filePath,
    cloneSemanticModel(previousSnapshot.model)
  );

  return true;
};

/**
 * Apply a single redo step for filePath.
 * Mutates the Immer draft maps (questHistory, questNodePositions) and
 * calls fileStore._applyHistoryModelUpdate for the file state update.
 * Returns true if a redo step was applied.
 */
const applyRedoForFile = (
  questHistory: Map<string, QuestHistoryState>,
  questNodePositions: Map<string, Map<string, QuestNodePositionMap>>,
  filePath: string
): boolean => {
  const fileState = useFileStore.getState().openFiles.get(filePath);
  const history = questHistory.get(filePath);
  if (!fileState || !history || history.future.length === 0) {
    return false;
  }

  const nextSnapshot = history.future[0];
  const remainingFuture = history.future.slice(1);
  const nextPast = [
    ...history.past,
    createQuestHistorySnapshot(fileState.semanticModel, questNodePositions.get(filePath))
  ];

  questHistory.set(filePath, {
    past: nextPast,
    future: remainingFuture
  });
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
  questHistory: new Map(),
  questBatchHistory: { past: [], future: [] },
  questNodePositions: new Map(),

  pushSnapshot: (filePath: string) => {
    const fileState = useFileStore.getState().openFiles.get(filePath);
    if (!fileState) return;

    const now = Date.now();
    const history = get().editHistory.get(filePath);
    const lastTimestamp = history?.past[history.past.length - 1]?.timestamp ?? 0;

    if (now - lastTimestamp < COALESCE_MS) {
      // Coalesce: within burst window — clear future to commit this new edit branch
      set((state) => {
        const h = state.editHistory.get(filePath);
        if (h) h.future = [];
      });
      return;
    }

    const snapshot: EditSnapshot = {
      model: cloneSemanticModel(fileState.semanticModel),
      nodePositions: cloneQuestNodePositionsForFile(get().questNodePositions.get(filePath)),
      timestamp: now,
    };

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
      const fileState = useFileStore.getState().openFiles.get(filePath);
      const history = state.editHistory.get(filePath);
      if (!fileState || !history || history.past.length === 0) return;

      const previousSnapshot = history.past[history.past.length - 1];
      const currentSnapshot: EditSnapshot = {
        model: cloneSemanticModel(fileState.semanticModel),
        nodePositions: cloneQuestNodePositionsForFile(state.questNodePositions.get(filePath)),
        timestamp: Date.now(),
      };

      history.future = [currentSnapshot, ...history.future];
      history.past = history.past.slice(0, history.past.length - 1);

      useFileStore.getState()._applyHistoryModelUpdate(
        filePath,
        cloneSemanticModel(previousSnapshot.model)
      );
    });
  },

  redo: (filePath: string) => {
    set((state) => {
      const fileState = useFileStore.getState().openFiles.get(filePath);
      const history = state.editHistory.get(filePath);
      if (!fileState || !history || history.future.length === 0) return;

      const nextSnapshot = history.future[0];
      const currentSnapshot: EditSnapshot = {
        model: cloneSemanticModel(fileState.semanticModel),
        nodePositions: cloneQuestNodePositionsForFile(state.questNodePositions.get(filePath)),
        timestamp: Date.now(),
      };

      history.past = [...history.past, currentSnapshot];
      if (history.past.length > MAX_HISTORY_SIZE) history.past.shift();
      history.future = history.future.slice(1);

      useFileStore.getState()._applyHistoryModelUpdate(
        filePath,
        cloneSemanticModel(nextSnapshot.model)
      );
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
    const fileState = useFileStore.getState().openFiles.get(filePath);
    if (!fileState) return;

    const currentNodePositions = get().questNodePositions.get(filePath);
    const snapshot = createQuestHistorySnapshot(fileState.semanticModel, currentNodePositions);

    set((state) => {
      const existingHistory = state.questHistory.get(filePath) || { past: [], future: [] };
      state.questHistory.set(filePath, {
        past: [...existingHistory.past, snapshot],
        future: []
      });
      state.questBatchHistory.past = [...state.questBatchHistory.past, [filePath]];
      state.questBatchHistory.future = [];
    });

    useFileStore.getState()._applyHistoryModelUpdate(filePath, model);
  },

  applyQuestModelsWithHistory: (updates: Array<{ filePath: string; model: SemanticModel }>) => {
    if (!updates.length) return;

    const uniqueUpdates = new Map<string, SemanticModel>();
    updates.forEach((entry) => {
      uniqueUpdates.set(entry.filePath, entry.model);
    });

    const fileStoreState = useFileStore.getState();
    const snapshots = new Map<string, ReturnType<typeof createQuestHistorySnapshot>>();
    const currentNodePositions = get().questNodePositions;

    uniqueUpdates.forEach((_, filePath) => {
      const fileState = fileStoreState.openFiles.get(filePath);
      if (fileState) {
        snapshots.set(
          filePath,
          createQuestHistorySnapshot(fileState.semanticModel, currentNodePositions.get(filePath))
        );
      }
    });

    set((state) => {
      const batchFilePaths = normalizeBatchFilePaths(Array.from(uniqueUpdates.keys()));
      uniqueUpdates.forEach((_, filePath) => {
        const snapshot = snapshots.get(filePath);
        if (!snapshot) return;

        const existingHistory = state.questHistory.get(filePath) || { past: [], future: [] };
        state.questHistory.set(filePath, {
          past: [...existingHistory.past, snapshot],
          future: []
        });
      });
      if (batchFilePaths.length > 0) {
        state.questBatchHistory.past = [...state.questBatchHistory.past, batchFilePaths];
        state.questBatchHistory.future = [];
      }
    });

    uniqueUpdates.forEach((model, filePath) => {
      fileStoreState._applyHistoryModelUpdate(filePath, model);
    });
  },

  undoQuestModel: (filePath: string) => {
    set((state) => {
      applyUndoForFile(state.questHistory, state.questNodePositions, filePath);
    });
  },

  redoQuestModel: (filePath: string) => {
    set((state) => {
      applyRedoForFile(state.questHistory, state.questNodePositions, filePath);
    });
  },

  canUndoQuestModel: (filePath: string) => {
    const history = get().questHistory.get(filePath);
    return !!history && history.past.length > 0;
  },

  canRedoQuestModel: (filePath: string) => {
    const history = get().questHistory.get(filePath);
    return !!history && history.future.length > 0;
  },

  undoLastQuestBatch: () => {
    set((state) => {
      const latestBatch = state.questBatchHistory.past[state.questBatchHistory.past.length - 1];
      if (!latestBatch || latestBatch.length === 0) {
        return;
      }

      const normalizedBatch = normalizeBatchFilePaths(latestBatch);
      const actuallyUndone: string[] = [];
      normalizedBatch.forEach((filePath) => {
        const didUndo = applyUndoForFile(state.questHistory, state.questNodePositions, filePath);
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
        const didRedo = applyRedoForFile(state.questHistory, state.questNodePositions, filePath);
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

    const currentNodePositions = get().questNodePositions.get(filePath);
    const snapshot = createQuestHistorySnapshot(fileState.semanticModel, currentNodePositions);

    set((state) => {
      const existingHistory = state.questHistory.get(filePath) || { past: [], future: [] };
      state.questHistory.set(filePath, {
        past: [...existingHistory.past, snapshot],
        future: []
      });
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
      state.questHistory.delete(filePath);
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
      state.questHistory.clear();
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
