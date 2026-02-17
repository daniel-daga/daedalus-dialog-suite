import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { generateActionId } from '../components/actionFactory';
import { useProjectStore } from './projectStore';
import type {
  SemanticModel,
  Dialog,
  DialogFunction,
  DialogAction,
  ParseError,
  CodeGenerationSettings,
  ValidationResult
} from '../types/global';

// Enable Map/Set support in Immer
enableMapSet();

/**
 * Ensure all actions in the model have unique IDs
 */
function ensureActionIds(model: SemanticModel): SemanticModel {
  if (!model || !model.functions) return model;

  const updatedFunctions = { ...model.functions };
  Object.keys(updatedFunctions).forEach(funcName => {
    const func = updatedFunctions[funcName];
    if (func.actions && Array.isArray(func.actions)) {
      updatedFunctions[funcName] = {
        ...func,
        actions: func.actions.map((action: DialogAction) => {
          // Check if action has id property (DialogLineAction)
          if ('id' in action && (!action.id || action.id === 'NEW_LINE_ID')) {
            return { ...action, id: generateActionId() };
          }
          return action;
        })
      };
    }
  });

  return { ...model, functions: updatedFunctions };
}

function cloneSemanticModel(model: SemanticModel): SemanticModel {
  if (typeof structuredClone === 'function') {
    return structuredClone(model);
  }
  return JSON.parse(JSON.stringify(model)) as SemanticModel;
}

interface FileState {
  filePath: string;
  semanticModel: SemanticModel;
  isDirty: boolean;
  lastSaved: Date;
  originalCode?: string;
  workingCode?: string; // Current code in source editor (may differ from semanticModel or originalCode)
  hasErrors?: boolean;
  errors?: ParseError[];
  lastValidationResult?: ValidationResult;
  autoSaveError?: ValidationResult;
}

interface QuestHistoryState {
  past: QuestHistorySnapshot[];
  future: QuestHistorySnapshot[];
}

interface QuestNodePosition {
  x: number;
  y: number;
}

type QuestNodePositionMap = Map<string, QuestNodePosition>;

interface QuestHistorySnapshot {
  model: SemanticModel;
  nodePositions: Map<string, QuestNodePositionMap>;
}

interface QuestBatchHistoryState {
  past: string[][];
  future: string[][];
}

const normalizeBatchFilePaths = (filePaths: string[]): string[] => (
  Array.from(new Set(filePaths.filter((filePath) => filePath.trim().length > 0)))
);

function cloneQuestNodePositionsForFile(
  positions: Map<string, QuestNodePositionMap> | undefined
): Map<string, QuestNodePositionMap> {
  if (!positions) return new Map();
  const cloned = new Map<string, QuestNodePositionMap>();
  positions.forEach((nodeMap, questName) => {
    const nextNodeMap: QuestNodePositionMap = new Map();
    nodeMap.forEach((position, nodeId) => {
      nextNodeMap.set(nodeId, { x: position.x, y: position.y });
    });
    cloned.set(questName, nextNodeMap);
  });
  return cloned;
}

function createQuestHistorySnapshot(
  model: SemanticModel,
  fileQuestPositions: Map<string, QuestNodePositionMap> | undefined
): QuestHistorySnapshot {
  return {
    model: cloneSemanticModel(model),
    nodePositions: cloneQuestNodePositionsForFile(fileQuestPositions)
  };
}

const applyUndoForFile = (
  openFiles: Map<string, FileState>,
  questHistory: Map<string, QuestHistoryState>,
  questNodePositions: Map<string, Map<string, QuestNodePositionMap>>,
  filePath: string
): boolean => {
  const fileState = openFiles.get(filePath);
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

  fileState.semanticModel = cloneSemanticModel(previousSnapshot.model);
  questNodePositions.set(filePath, cloneQuestNodePositionsForFile(previousSnapshot.nodePositions));
  fileState.isDirty = true;
  fileState.workingCode = undefined;
  fileState.autoSaveError = undefined;
  fileState.hasErrors = false;

  return true;
};

const applyRedoForFile = (
  openFiles: Map<string, FileState>,
  questHistory: Map<string, QuestHistoryState>,
  questNodePositions: Map<string, Map<string, QuestNodePositionMap>>,
  filePath: string
): boolean => {
  const fileState = openFiles.get(filePath);
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

  fileState.semanticModel = cloneSemanticModel(nextSnapshot.model);
  questNodePositions.set(filePath, cloneQuestNodePositionsForFile(nextSnapshot.nodePositions));
  fileState.isDirty = true;
  fileState.workingCode = undefined;
  fileState.autoSaveError = undefined;
  fileState.hasErrors = false;

  return true;
};

interface EditorProject {
  id: string;
  name: string;
  rootPath: string;
  lastOpened: Date;
  recentFiles: string[];
}

interface SaveFileResult {
  success: boolean;
  validationResult?: ValidationResult;
}

interface EditorStore {
  // Current project
  project: EditorProject | null;

  // Open files (keyed by path)
  openFiles: Map<string, FileState>;
  questHistory: Map<string, QuestHistoryState>;
  questBatchHistory: QuestBatchHistoryState;
  questNodePositions: Map<string, Map<string, QuestNodePositionMap>>;

  // Current active file
  activeFile: string | null;

  // View state
  activeView: 'dialog' | 'quest' | 'variable' | 'source';

  // UI state
  selectedNPC: string | null;
  selectedDialog: string | null;
  selectedQuest: string | null;
  selectedFunctionName: string | null;
  selectedAction: number | null;

  // Validation dialog state
  pendingValidation: {
    filePath: string;
    validationResult: ValidationResult;
  } | null;

  // Code generation settings
  codeSettings: CodeGenerationSettings;

  // Auto-save settings
  autoSaveEnabled: boolean;
  autoSaveInterval: number;

  // Actions
  getFileState: (filePath: string) => FileState | undefined;
  openFile: (filePath: string) => Promise<void>;
  closeFile: (filePath: string) => void;
  updateModel: (filePath: string, model: SemanticModel) => void;
  updateDialog: (filePath: string, dialogName: string, dialog: Dialog) => void;
  updateDialogWithUpdater: (
    filePath: string,
    dialogName: string,
    updater: (existingDialog: Dialog) => Dialog | null
  ) => void;
  updateDialogWithNormalizedProperties: (
    filePath: string,
    dialogName: string,
    updater: (existingDialog: Dialog) => Dialog | null
  ) => void;
  updateFunction: (filePath: string, functionName: string, func: DialogFunction) => void;
  updateFunctionWithUpdater: (
    filePath: string,
    functionName: string,
    updater: (existingFunction: DialogFunction) => DialogFunction | null
  ) => void;
  renameFunction: (filePath: string, oldFunctionName: string, newFunctionName: string) => void;
  updateDialogConditionFunction: (
    filePath: string,
    dialogName: string,
    updater: (existingFunction: DialogFunction) => DialogFunction | null
  ) => void;
  replaceDialogConditionFunction: (
    filePath: string,
    dialogName: string,
    updatedFunction: DialogFunction
  ) => void;
  validateFile: (filePath: string) => Promise<ValidationResult>;
  saveFile: (filePath: string, options?: { forceOnErrors?: boolean }) => Promise<SaveFileResult>;
  clearPendingValidation: () => void;
  generateCode: (filePath: string) => Promise<string>;
  setWorkingCode: (filePath: string, code: string | undefined) => void;
  saveSource: (filePath: string, code: string) => Promise<void>;
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
  setSelectedNPC: (npcName: string | null) => void;
  setSelectedDialog: (dialogName: string | null) => void;
  setSelectedQuest: (questName: string | null) => void;
  setSelectedFunctionName: (functionName: string | null) => void;
  setSelectedAction: (actionIndex: number | null) => void;
  setActiveView: (view: 'dialog' | 'quest' | 'variable' | 'source') => void;
  updateCodeSettings: (settings: Partial<CodeGenerationSettings>) => void;
  setAutoSaveEnabled: (enabled: boolean) => void;
  setAutoSaveInterval: (interval: number) => void;
}

export const useEditorStore = create<EditorStore>()(immer((set, get) => ({
  project: null,
  openFiles: new Map(),
  questHistory: new Map(),
  questBatchHistory: { past: [], future: [] },
  questNodePositions: new Map(),
  activeFile: null,
  activeView: 'dialog',
  selectedNPC: null,
  selectedDialog: null,
  selectedQuest: null,
  selectedFunctionName: null,
  selectedAction: null,
  pendingValidation: null,
  codeSettings: {
    indentChar: '\t',
    includeComments: true,
    sectionHeaders: true,
    uppercaseKeywords: true,
  },
  autoSaveEnabled: true,
  autoSaveInterval: 2000,

  getFileState: (filePath: string) => get().openFiles.get(filePath),

  openFile: async (filePath: string) => {
    try {
      // Read and parse file in main process (has access to native modules)
      const sourceCode = await window.editorAPI.readFile(filePath);
      const model = await window.editorAPI.parseSource(sourceCode);

      // Check for syntax errors
      if (model.hasErrors) {
        // Do not process the model if there are syntax errors
        const fileState: FileState = {
          filePath,
          semanticModel: model,
          isDirty: false,
          lastSaved: new Date(),
          originalCode: sourceCode,
          hasErrors: true,
          errors: model.errors || [],
        };

      set((state) => {
          state.openFiles.set(filePath, fileState);
          state.questHistory.set(filePath, { past: [], future: [] });
          state.activeFile = filePath;
        });
        return;
      }

      // Ensure all actions have unique IDs (only for valid models)
      const modelWithIds = ensureActionIds(model);

      const fileState: FileState = {
        filePath,
        semanticModel: modelWithIds,
        isDirty: false,
        lastSaved: new Date(),
        originalCode: sourceCode,
        hasErrors: false,
        errors: [],
      };

      set((state) => {
        state.openFiles.set(filePath, fileState);
        state.questHistory.set(filePath, { past: [], future: [] });
        state.activeFile = filePath;
      });
    } catch (error) {
      console.error('Failed to open file:', error);
      throw error;
    }
  },

  closeFile: (filePath: string) => {
    set((state) => {
      state.openFiles.delete(filePath);
      state.questHistory.delete(filePath);
      state.questNodePositions.delete(filePath);
      state.questBatchHistory.past = state.questBatchHistory.past.filter(
        (batch) => !batch.includes(filePath)
      );
      state.questBatchHistory.future = state.questBatchHistory.future.filter(
        (batch) => !batch.includes(filePath)
      );
      if (state.activeFile === filePath) {
        state.activeFile = null;
      }
    });
  },

  updateModel: (filePath: string, model: SemanticModel) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (fileState) {
        fileState.semanticModel = model;
        fileState.isDirty = true;
        fileState.workingCode = undefined; // Invalidate source cache
        fileState.autoSaveError = undefined;
        fileState.hasErrors = false;
      }
    });
    // Sync with project store using the committed (non-draft) state
    const committedModel = get().openFiles.get(filePath)?.semanticModel;
    if (committedModel) {
      useProjectStore.getState().updateFileModel(filePath, committedModel);
    }
  },

  updateDialog: (filePath: string, dialogName: string, dialog: Dialog) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (!fileState) {
        return;
      }
      fileState.semanticModel.dialogs[dialogName] = dialog;
      fileState.isDirty = true;
      fileState.workingCode = undefined; // Invalidate source cache
      fileState.autoSaveError = undefined;
      fileState.hasErrors = false;
    });
    // Sync with project store using the committed (non-draft) state
    const committedModel = get().openFiles.get(filePath)?.semanticModel;
    if (committedModel) {
      useProjectStore.getState().updateFileModel(filePath, committedModel);
    }
  },

  updateDialogWithUpdater: (filePath: string, dialogName: string, updater: (existingDialog: Dialog) => Dialog | null) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (!fileState) {
        return;
      }

      const existingDialog = fileState.semanticModel.dialogs[dialogName];
      if (!existingDialog) {
        return;
      }

      const updatedDialog = updater(existingDialog);
      if (!updatedDialog) {
        return;
      }

      fileState.semanticModel.dialogs[dialogName] = updatedDialog;
      fileState.isDirty = true;
      fileState.workingCode = undefined;
      fileState.autoSaveError = undefined;
      fileState.hasErrors = false;
    });

    const committedModel = get().openFiles.get(filePath)?.semanticModel;
    if (committedModel) {
      useProjectStore.getState().updateFileModel(filePath, committedModel);
    }
  },

  updateDialogWithNormalizedProperties: (filePath: string, dialogName: string, updater: (existingDialog: Dialog) => Dialog | null) => {
    get().updateDialogWithUpdater(filePath, dialogName, (existingDialog) => {
      const updatedDialog = updater(existingDialog);
      if (!updatedDialog) {
        return null;
      }

      return {
        ...updatedDialog,
        properties: {
          ...updatedDialog.properties,
          information: typeof updatedDialog.properties?.information === 'object'
            ? updatedDialog.properties.information.name
            : updatedDialog.properties?.information,
          condition: typeof updatedDialog.properties?.condition === 'object'
            ? updatedDialog.properties.condition.name
            : updatedDialog.properties?.condition
        }
      };
    });
  },

  updateFunction: (filePath: string, functionName: string, func: DialogFunction) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (!fileState) {
        return;
      }
      fileState.semanticModel.functions[functionName] = func;
      fileState.isDirty = true;
      fileState.workingCode = undefined; // Invalidate source cache
      fileState.autoSaveError = undefined;
      fileState.hasErrors = false;
    });
    // Sync with project store using the committed (non-draft) state
    const committedModel = get().openFiles.get(filePath)?.semanticModel;
    if (committedModel) {
      useProjectStore.getState().updateFileModel(filePath, committedModel);
    }
  },

  updateFunctionWithUpdater: (filePath: string, functionName: string, updater: (existingFunction: DialogFunction) => DialogFunction | null) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (!fileState) {
        return;
      }

      const existingFunction = fileState.semanticModel.functions[functionName];
      if (!existingFunction) {
        return;
      }

      const updatedFunction = updater(existingFunction);
      if (!updatedFunction) {
        return;
      }

      fileState.semanticModel.functions[functionName] = updatedFunction;
      fileState.isDirty = true;
      fileState.workingCode = undefined;
      fileState.autoSaveError = undefined;
      fileState.hasErrors = false;
    });

    const committedModel = get().openFiles.get(filePath)?.semanticModel;
    if (committedModel) {
      useProjectStore.getState().updateFileModel(filePath, committedModel);
    }
  },

  renameFunction: (filePath: string, oldFunctionName: string, newFunctionName: string) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (!fileState) {
        return;
      }

      const existingFunction = fileState.semanticModel.functions[oldFunctionName];
      if (!existingFunction) {
        return;
      }

      const updatedFunctions = { ...fileState.semanticModel.functions };
      delete updatedFunctions[oldFunctionName];
      updatedFunctions[newFunctionName] = { ...existingFunction, name: newFunctionName };

      fileState.semanticModel.functions = updatedFunctions;
      fileState.isDirty = true;
      fileState.workingCode = undefined;
      fileState.autoSaveError = undefined;
      fileState.hasErrors = false;
    });

    const committedModel = get().openFiles.get(filePath)?.semanticModel;
    if (committedModel) {
      useProjectStore.getState().updateFileModel(filePath, committedModel);
    }
  },

  updateDialogConditionFunction: (filePath: string, dialogName: string, updater: (existingFunction: DialogFunction) => DialogFunction | null) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (!fileState) {
        return;
      }

      const dialog = fileState.semanticModel.dialogs[dialogName];
      const conditionFunctionName = typeof dialog?.properties?.condition === 'object'
        ? dialog.properties.condition.name
        : dialog?.properties?.condition;

      if (!conditionFunctionName) {
        return;
      }

      const existingFunction = fileState.semanticModel.functions[conditionFunctionName];
      if (!existingFunction) {
        return;
      }

      const updatedFunction = updater(existingFunction);
      if (!updatedFunction) {
        return;
      }

      fileState.semanticModel.functions[conditionFunctionName] = updatedFunction;
      fileState.isDirty = true;
      fileState.workingCode = undefined;
      fileState.autoSaveError = undefined;
      fileState.hasErrors = false;
    });

    const committedModel = get().openFiles.get(filePath)?.semanticModel;
    if (committedModel) {
      useProjectStore.getState().updateFileModel(filePath, committedModel);
    }
  },

  replaceDialogConditionFunction: (filePath: string, dialogName: string, updatedFunction: DialogFunction) => {
    get().updateDialogConditionFunction(filePath, dialogName, () => updatedFunction);
  },

  validateFile: async (filePath: string) => {
    const state = get();
    const fileState = state.openFiles.get(filePath);
    if (!fileState) {
      throw new Error('File not open');
    }

    const validationResult = await window.editorAPI.validateModel(
      fileState.semanticModel,
      state.codeSettings
    );

    // Store validation result in file state
    set((state) => {
      const currentFileState = state.openFiles.get(filePath);
      if (currentFileState) {
        currentFileState.lastValidationResult = validationResult;
      }
    });

    return validationResult;
  },

  saveFile: async (filePath: string, options?: { forceOnErrors?: boolean }) => {
    const state = get();
    const fileState = state.openFiles.get(filePath);
    if (!fileState) {
      throw new Error('File not open');
    }

    try {
      // Save with validation (main process handles validation)
      const result = await window.editorAPI.saveFile(
        filePath,
        fileState.semanticModel,
        state.codeSettings,
        { forceOnErrors: options?.forceOnErrors }
      );

      // If validation failed and we didn't force save
      if (!result.success && result.validationResult) {
        // Store pending validation for UI to display and update file state
        set((state) => {
            state.pendingValidation = { filePath, validationResult: result.validationResult! };
            const currentFileState = state.openFiles.get(filePath);
            if (currentFileState) {
                currentFileState.lastValidationResult = result.validationResult;
            }
        });

        return { success: false, validationResult: result.validationResult };
      }

      // Save succeeded
      set((state) => {
        const currentFileState = state.openFiles.get(filePath);
        if (currentFileState) {
            currentFileState.isDirty = false;
            currentFileState.lastSaved = new Date();
            currentFileState.lastValidationResult = result.validationResult;
        }
        state.pendingValidation = null;
      });

      return { success: true, validationResult: result.validationResult };
    } catch (error) {
      console.error('Failed to save file:', error);
      throw error;
    }
  },

  clearPendingValidation: () => {
    set((state) => {
        state.pendingValidation = null;
    });
  },

  generateCode: async (filePath: string) => {
    const state = get();
    const fileState = state.openFiles.get(filePath);
    if (!fileState) {
      throw new Error('File not open');
    }

    // Generate code in main process
    return window.editorAPI.generateCode(fileState.semanticModel, state.codeSettings);
  },

  setWorkingCode: (filePath: string, code: string | undefined) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (fileState) {
        fileState.workingCode = code;
      }
    });
  },

  saveSource: async (filePath: string, code: string) => {
    const state = get();
    const fileState = state.openFiles.get(filePath);
    if (!fileState) {
      throw new Error('File not open');
    }

    try {
      // 1. Write file
      await window.editorAPI.writeFile(filePath, code);

      // 2. Parse and update model
      const model = await window.editorAPI.parseSource(code);

      // 3. Ensure action IDs if valid
      const processedModel = model.hasErrors ? model : ensureActionIds(model);

      // 4. Update state
      set((state) => {
        const currentFileState = state.openFiles.get(filePath);
        if (currentFileState) {
            currentFileState.semanticModel = processedModel;
            currentFileState.isDirty = false;
            currentFileState.lastSaved = new Date();
            currentFileState.originalCode = code;
            currentFileState.workingCode = undefined; // Clear working code as it matches disk
            currentFileState.hasErrors = model.hasErrors || false;
            currentFileState.errors = model.errors || [];
            currentFileState.lastValidationResult = undefined; // Clear old validation result
        }
        state.questHistory.set(filePath, { past: [], future: [] });
        state.questNodePositions.set(filePath, new Map());
        state.questBatchHistory = { past: [], future: [] };
      });
    } catch (error) {
      console.error('Failed to save source:', error);
      throw error;
    }
  },

  applyQuestModelWithHistory: (filePath: string, model: SemanticModel) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (!fileState) {
        return;
      }

      const existingHistory = state.questHistory.get(filePath) || { past: [], future: [] };
      const nextPast = [
        ...existingHistory.past,
        createQuestHistorySnapshot(fileState.semanticModel, state.questNodePositions.get(filePath))
      ];

      state.questHistory.set(filePath, {
        past: nextPast,
        future: []
      });
      state.questBatchHistory.past = [...state.questBatchHistory.past, [filePath]];
      state.questBatchHistory.future = [];

      fileState.semanticModel = model;
      fileState.isDirty = true;
      fileState.workingCode = undefined;
      fileState.autoSaveError = undefined;
      fileState.hasErrors = false;
    });

    const committedModel = get().openFiles.get(filePath)?.semanticModel;
    if (committedModel) {
      useProjectStore.getState().updateFileModel(filePath, committedModel);
    }
  },

  applyQuestModelsWithHistory: (updates: Array<{ filePath: string; model: SemanticModel }>) => {
    if (!updates.length) return;

    const uniqueUpdates = new Map<string, SemanticModel>();
    updates.forEach((entry) => {
      uniqueUpdates.set(entry.filePath, entry.model);
    });

    set((state) => {
      const batchFilePaths = normalizeBatchFilePaths(Array.from(uniqueUpdates.keys()));
      uniqueUpdates.forEach((model, filePath) => {
        const fileState = state.openFiles.get(filePath);
        if (!fileState) {
          return;
        }

        const existingHistory = state.questHistory.get(filePath) || { past: [], future: [] };
        const nextPast = [
          ...existingHistory.past,
          createQuestHistorySnapshot(fileState.semanticModel, state.questNodePositions.get(filePath))
        ];

        state.questHistory.set(filePath, {
          past: nextPast,
          future: []
        });

        fileState.semanticModel = model;
        fileState.isDirty = true;
        fileState.workingCode = undefined;
        fileState.autoSaveError = undefined;
        fileState.hasErrors = false;
      });
      if (batchFilePaths.length > 0) {
        state.questBatchHistory.past = [...state.questBatchHistory.past, batchFilePaths];
        state.questBatchHistory.future = [];
      }
    });

    uniqueUpdates.forEach((_, filePath) => {
      const committedModel = get().openFiles.get(filePath)?.semanticModel;
      if (committedModel) {
        useProjectStore.getState().updateFileModel(filePath, committedModel);
      }
    });
  },

  undoQuestModel: (filePath: string) => {
    let didUndo = false;
    set((state) => {
      didUndo = applyUndoForFile(state.openFiles, state.questHistory, state.questNodePositions, filePath);
    });

    if (!didUndo) return;
    const committedModel = get().openFiles.get(filePath)?.semanticModel;
    if (committedModel) {
      useProjectStore.getState().updateFileModel(filePath, committedModel);
    }
  },

  redoQuestModel: (filePath: string) => {
    let didRedo = false;
    set((state) => {
      didRedo = applyRedoForFile(state.openFiles, state.questHistory, state.questNodePositions, filePath);
    });

    if (!didRedo) return;
    const committedModel = get().openFiles.get(filePath)?.semanticModel;
    if (committedModel) {
      useProjectStore.getState().updateFileModel(filePath, committedModel);
    }
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
    let undoneBatch: string[] = [];
    set((state) => {
      const latestBatch = state.questBatchHistory.past[state.questBatchHistory.past.length - 1];
      if (!latestBatch || latestBatch.length === 0) {
        return;
      }

      const normalizedBatch = normalizeBatchFilePaths(latestBatch);
      const actuallyUndone: string[] = [];
      normalizedBatch.forEach((filePath) => {
        const didUndo = applyUndoForFile(state.openFiles, state.questHistory, state.questNodePositions, filePath);
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
      undoneBatch = actuallyUndone;
    });

    undoneBatch.forEach((filePath) => {
      const committedModel = get().openFiles.get(filePath)?.semanticModel;
      if (committedModel) {
        useProjectStore.getState().updateFileModel(filePath, committedModel);
      }
    });
  },

  redoLastQuestBatch: () => {
    let redoneBatch: string[] = [];
    set((state) => {
      const latestBatch = state.questBatchHistory.future[0];
      if (!latestBatch || latestBatch.length === 0) {
        return;
      }

      const normalizedBatch = normalizeBatchFilePaths(latestBatch);
      const actuallyRedone: string[] = [];
      normalizedBatch.forEach((filePath) => {
        const didRedo = applyRedoForFile(state.openFiles, state.questHistory, state.questNodePositions, filePath);
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
      redoneBatch = actuallyRedone;
    });

    redoneBatch.forEach((filePath) => {
      const committedModel = get().openFiles.get(filePath)?.semanticModel;
      if (committedModel) {
        useProjectStore.getState().updateFileModel(filePath, committedModel);
      }
    });
  },

  canUndoLastQuestBatch: () => get().questBatchHistory.past.length > 0,

  canRedoLastQuestBatch: () => get().questBatchHistory.future.length > 0,

  applyQuestNodePositionWithHistory: (filePath: string, questName: string, nodeId: string, position: QuestNodePosition) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (!fileState) {
        return;
      }

      const existingHistory = state.questHistory.get(filePath) || { past: [], future: [] };
      const nextPast = [
        ...existingHistory.past,
        createQuestHistorySnapshot(fileState.semanticModel, state.questNodePositions.get(filePath))
      ];

      state.questHistory.set(filePath, {
        past: nextPast,
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

      fileState.isDirty = true;
    });
  },

  setQuestNodePosition: (filePath: string, questName: string, nodeId: string, position: QuestNodePosition) => {
    set((state) => {
      if (!state.openFiles.has(filePath)) {
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

  setSelectedNPC: (npcName: string | null) => {
    set((state) => { state.selectedNPC = npcName; });
  },

  setSelectedDialog: (dialogName: string | null) => {
    set((state) => { state.selectedDialog = dialogName; });
  },

  setSelectedQuest: (questName: string | null) => {
    set((state) => { state.selectedQuest = questName; });
  },

  setSelectedFunctionName: (functionName: string | null) => {
    set((state) => { state.selectedFunctionName = functionName; });
  },

  setSelectedAction: (actionIndex: number | null) => {
    set((state) => { state.selectedAction = actionIndex; });
  },

  setActiveView: (view: 'dialog' | 'quest' | 'variable' | 'source') => {
    set((state) => { state.activeView = view; });
  },

  updateCodeSettings: (settings: Partial<CodeGenerationSettings>) => {
    set((state) => {
      state.codeSettings = { ...state.codeSettings, ...settings };
    });
  },

  setAutoSaveEnabled: (enabled: boolean) => {
    set((state) => { state.autoSaveEnabled = enabled; });
  },

  setAutoSaveInterval: (interval: number) => {
    set((state) => { state.autoSaveInterval = interval; });
  },
})));
