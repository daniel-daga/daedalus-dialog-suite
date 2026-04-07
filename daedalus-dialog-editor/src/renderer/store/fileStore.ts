import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { createDialogLineId } from '../components/actionFactory';
import { collectDialogLineActions } from '../components/nestedActionUtils';
import { useUISelectionStore } from './uiSelectionStore';
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

  // Build a map from function name to dialog base name.
  // First, map info functions directly via dialog properties.
  const funcToDialogName = new Map<string, string>();
  const dialogBaseNames = new Set<string>();

  Object.entries(model.dialogs || {}).forEach(([dialogName, dialog]) => {
    const infoRef = dialog?.properties?.information;
    const infoFunctionName = typeof infoRef === 'string'
      ? infoRef
      : infoRef?.name;
    if (infoFunctionName) {
      funcToDialogName.set(infoFunctionName, dialogName);
    }
    dialogBaseNames.add(dialogName);
  });

  // For functions not directly mapped (e.g. choice target functions),
  // check if a dialog name is a prefix of the function name.
  Object.keys(model.functions).forEach(funcName => {
    if (funcToDialogName.has(funcName)) return;
    for (const baseName of dialogBaseNames) {
      if (funcName.startsWith(baseName + '_')) {
        funcToDialogName.set(funcName, baseName);
        return;
      }
    }
  });

  // Pre-collect all existing dialog line actions per dialog base name
  // (only those that already have valid IDs).
  const dialogLinesByBaseName = new Map<string, DialogAction[]>();
  Object.entries(model.functions).forEach(([funcName, func]) => {
    const baseName = funcToDialogName.get(funcName) || funcName;
    const existing = dialogLinesByBaseName.get(baseName) || [];
    existing.push(...collectDialogLineActions(func.actions || []));
    dialogLinesByBaseName.set(baseName, existing);
  });

  const updatedFunctions = { ...model.functions };
  Object.keys(updatedFunctions).forEach(funcName => {
    const func = updatedFunctions[funcName];
    if (func.actions && Array.isArray(func.actions)) {
      const actions = [...func.actions];
      let hasChanges = false;
      const dialogName = funcToDialogName.get(funcName) || funcName;
      const allDialogLines = dialogLinesByBaseName.get(dialogName) || [];

      for (let index = 0; index < actions.length; index += 1) {
        const action = actions[index] as DialogAction & { speaker?: 'self' | 'other' };
        if (action?.type !== 'DialogLine') {
          continue;
        }

        if (action.id && action.id !== 'NEW_LINE_ID') {
          continue;
        }

        const speaker: 'self' | 'other' = action.speaker === 'other' ? 'other' : 'self';
        const actionsWithoutCurrent = allDialogLines.filter((a) => a !== action);
        const newId = createDialogLineId({
          dialogName,
          speaker,
          actions: actionsWithoutCurrent
        });
        const newAction = { ...action, id: newId } as DialogAction;
        actions[index] = newAction;
        // Update the shared collection so subsequent ID generation sees this new ID
        allDialogLines.push(newAction);
        hasChanges = true;
      }

      if (!hasChanges) {
        return;
      }

      updatedFunctions[funcName] = {
        ...func,
        actions
      };
    }
  });

  return { ...model, functions: updatedFunctions };
}

export interface FileState {
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

export interface FileStore {
  // Current project
  project: EditorProject | null;

  // Open files (keyed by path)
  openFiles: Map<string, FileState>;

  // Current active file
  activeFile: string | null;

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
  removeDialog: (filePath: string, dialogName: string) => void;
  renameDialog: (filePath: string, oldDialogName: string, newDialogName: string, renameFunctions?: boolean) => void;
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
  updateCodeSettings: (settings: Partial<CodeGenerationSettings>) => void;
  setAutoSaveEnabled: (enabled: boolean) => void;
  setAutoSaveInterval: (interval: number) => void;
  resetEditorSession: () => void;

  // Internal actions called by historyStore
  _applyHistoryModelUpdate: (filePath: string, model: SemanticModel) => void;
  _markFileDirty: (filePath: string) => void;
}

/**
 * Parse source code and normalise action IDs in one step.
 */
async function parseSourceWithIds(sourceCode: string): Promise<SemanticModel> {
  const model = await window.editorAPI.parseSource(sourceCode);
  return model.hasErrors ? model : ensureActionIds(model);
}

export const useFileStore = create<FileStore>()(immer((set, get) => ({
  project: null,
  openFiles: new Map(),
  activeFile: null,
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
      const sourceCode = await window.editorAPI.readFile(filePath);
      const processedModel = await parseSourceWithIds(sourceCode);

      const fileState: FileState = {
        filePath,
        semanticModel: processedModel,
        isDirty: false,
        lastSaved: new Date(),
        originalCode: sourceCode,
        hasErrors: processedModel.hasErrors || false,
        errors: processedModel.errors || [],
      };

      set((state) => {
        state.openFiles.set(filePath, fileState);
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
      if (state.activeFile === filePath) {
        state.activeFile = null;
      }
    });
    // historyStore subscribes to openFiles changes and cleans up automatically
  },

  updateModel: (filePath: string, model: SemanticModel) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (fileState) {
        fileState.semanticModel = model;
        fileState.isDirty = true;
        fileState.workingCode = undefined;
        fileState.autoSaveError = undefined;
        fileState.hasErrors = false;
      }
    });
  },

  updateDialog: (filePath: string, dialogName: string, dialog: Dialog) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (!fileState) {
        return;
      }
      fileState.semanticModel.dialogs[dialogName] = dialog;
      fileState.isDirty = true;
      fileState.workingCode = undefined;
      fileState.autoSaveError = undefined;
      fileState.hasErrors = false;
    });
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
      fileState.workingCode = undefined;
      fileState.autoSaveError = undefined;
      fileState.hasErrors = false;
    });
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
  },

  removeDialog: (filePath: string, dialogName: string) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (!fileState) return;

      const model = fileState.semanticModel;
      const dialog = model.dialogs[dialogName];
      if (!dialog) return;

      // Resolve condition and information function names
      const infoRef = dialog.properties?.information;
      const infoFuncName = typeof infoRef === 'string' ? infoRef : (infoRef as any)?.name;
      const condRef = dialog.properties?.condition;
      const condFuncName = typeof condRef === 'string' ? condRef : (condRef as any)?.name;

      // Collect all functions reachable from the info function (the full subtree)
      const candidatesToDelete = new Set<string>();
      if (infoFuncName) {
        // BFS from info function via Choice.targetFunction
        const queue: string[] = [infoFuncName];
        while (queue.length > 0) {
          const name = queue.pop()!;
          if (candidatesToDelete.has(name)) continue;
          const func = model.functions[name];
          if (!func) continue;
          candidatesToDelete.add(name);
          for (const action of func.actions || []) {
            const a = action as any;
            if (a.type === 'Choice' && typeof a.targetFunction === 'string') {
              if (!candidatesToDelete.has(a.targetFunction)) {
                queue.push(a.targetFunction);
              }
            }
          }
        }
      }
      if (condFuncName) {
        candidatesToDelete.add(condFuncName);
      }

      // Build remaining dialogs (excluding the one being removed) to check shared functions
      const remainingDialogs = (Object.entries(model.dialogs) as [string, Dialog][])
        .filter(([name]) => name !== dialogName)
        .map(([, d]) => d);

      // Collect all function names still referenced by remaining dialogs
      const stillReferenced = new Set<string>();
      for (const d of remainingDialogs) {
        const iRef = d.properties?.information;
        const iName = typeof iRef === 'string' ? iRef : (iRef as any)?.name;
        if (iName) {
          // BFS from each remaining info function
          const q: string[] = [iName];
          while (q.length > 0) {
            const n = q.pop()!;
            if (stillReferenced.has(n)) continue;
            const f = model.functions[n];
            if (!f) continue;
            stillReferenced.add(n);
            for (const action of f.actions || []) {
              const a = action as any;
              if (a.type === 'Choice' && typeof a.targetFunction === 'string') {
                if (!stillReferenced.has(a.targetFunction)) q.push(a.targetFunction);
              }
            }
          }
        }
        const cRef = d.properties?.condition;
        const cName = typeof cRef === 'string' ? cRef : (cRef as any)?.name;
        if (cName) stillReferenced.add(cName);
      }

      // Only delete functions that are not referenced by any remaining dialog
      const functionsToDelete = new Set<string>();
      for (const name of candidatesToDelete) {
        if (!stillReferenced.has(name)) {
          functionsToDelete.add(name);
        }
      }

      // Apply deletions
      const updatedDialogs = { ...model.dialogs };
      delete updatedDialogs[dialogName];

      const updatedFunctions = { ...model.functions };
      for (const name of functionsToDelete) {
        delete updatedFunctions[name];
      }

      // Update declarationOrder
      const deletedNames = new Set([dialogName, ...functionsToDelete]);
      const updatedOrder = (model.declarationOrder || []).filter(
        (entry) => !deletedNames.has(entry.name)
      );

      fileState.semanticModel = {
        ...model,
        dialogs: updatedDialogs,
        functions: updatedFunctions,
        declarationOrder: updatedOrder,
      };
      fileState.isDirty = true;
      fileState.workingCode = undefined;
      fileState.autoSaveError = undefined;
      fileState.hasErrors = false;
    });
  },

  renameDialog: (filePath: string, oldDialogName: string, newDialogName: string, renameFunctions = true) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (!fileState) return;

      const model = fileState.semanticModel;
      const dialog = model.dialogs[oldDialogName];
      if (!dialog) return;

      // Build new dialog with updated name
      const updatedDialog = { ...dialog, name: newDialogName };

      // Resolve old info/condition function names
      const infoRef = dialog.properties?.information;
      const oldInfoName = typeof infoRef === 'string' ? infoRef : (infoRef as any)?.name;
      const condRef = dialog.properties?.condition;
      const oldCondName = typeof condRef === 'string' ? condRef : (condRef as any)?.name;

      const updatedFunctions: { [key: string]: DialogFunction } = { ...model.functions };
      const updatedDialogs = { ...model.dialogs };
      delete updatedDialogs[oldDialogName];

      // Build a rename map: oldFuncName → newFuncName
      const renameMap = new Map<string, string>();

      if (renameFunctions) {
        // Collect all functions reachable from the info function
        const reachable = new Set<string>();
        if (oldInfoName) {
          const q: string[] = [oldInfoName];
          while (q.length > 0) {
            const n = q.pop()!;
            if (reachable.has(n)) continue;
            const f = model.functions[n];
            if (!f) continue;
            reachable.add(n);
            for (const action of f.actions || []) {
              const a = action as any;
              if (a.type === 'Choice' && typeof a.targetFunction === 'string') {
                if (!reachable.has(a.targetFunction)) q.push(a.targetFunction);
              }
            }
          }
        }
        if (oldCondName) reachable.add(oldCondName);

        // Compute new names for functions that follow the old dialog name prefix
        for (const name of reachable) {
          if (name.startsWith(oldDialogName)) {
            const suffix = name.slice(oldDialogName.length);
            const newName = newDialogName + suffix;
            renameMap.set(name, newName);
          }
        }
      }

      // Apply function renames
      for (const [oldName, func] of Object.entries(model.functions) as [string, DialogFunction][]) {
        if (renameMap.has(oldName)) {
          const newName = renameMap.get(oldName)!;
          // Also update Choice.targetFunction references within this function
          const updatedActions = ((func as any).actions || []).map((action: any) => {
            if (action.type === 'Choice' && renameMap.has(action.targetFunction)) {
              return { ...action, targetFunction: renameMap.get(action.targetFunction) };
            }
            return action;
          });
          delete updatedFunctions[oldName];
          updatedFunctions[newName] = { ...func, name: newName, actions: updatedActions };
        } else {
          // Update Choice.targetFunction references in non-renamed functions too
          let changed = false;
          const updatedActions = ((func as any).actions || []).map((action: any) => {
            if (action.type === 'Choice' && renameMap.has(action.targetFunction)) {
              changed = true;
              return { ...action, targetFunction: renameMap.get(action.targetFunction) };
            }
            return action;
          });
          if (changed) {
            updatedFunctions[oldName] = { ...func, conditions: (func as any).conditions, actions: updatedActions };
          }
        }
      }

      // Update the dialog's own property references to functions
      const newInfoName = oldInfoName && renameMap.has(oldInfoName) ? renameMap.get(oldInfoName)! : oldInfoName;
      const newCondName = oldCondName && renameMap.has(oldCondName) ? renameMap.get(oldCondName)! : oldCondName;

      const newProperties: Record<string, any> = { ...updatedDialog.properties };
      if (newInfoName !== undefined) {
        newProperties.information = newInfoName;
      }
      if (newCondName !== undefined) {
        newProperties.condition = newCondName;
      }
      updatedDialog.properties = newProperties;

      updatedDialogs[newDialogName] = updatedDialog;

      // Update NpcKnowsInfoCondition.dialogRef references in same file
      for (const [funcName, func] of Object.entries(updatedFunctions) as [string, DialogFunction][]) {
        let changed = false;
        const updatedConditions = ((func as any).conditions || []).map((cond: any) => {
          if (cond.type === 'NpcKnowsInfoCondition' && cond.dialogRef === oldDialogName) {
            changed = true;
            return { ...cond, dialogRef: newDialogName };
          }
          return cond;
        });
        if (changed) {
          updatedFunctions[funcName] = { ...func, conditions: updatedConditions };
        }
      }

      // Update declarationOrder: rename entries for moved dialog and functions
      const updatedOrder = (model.declarationOrder || []).map((entry) => {
        if (entry.type === 'dialog' && entry.name === oldDialogName) {
          return { ...entry, name: newDialogName };
        }
        if (entry.type === 'function' && renameMap.has(entry.name)) {
          return { ...entry, name: renameMap.get(entry.name)! };
        }
        return entry;
      });

      fileState.semanticModel = {
        ...model,
        dialogs: updatedDialogs,
        functions: updatedFunctions,
        declarationOrder: updatedOrder,
      };
      fileState.isDirty = true;
      fileState.workingCode = undefined;
      fileState.autoSaveError = undefined;
      fileState.hasErrors = false;
    });
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
      // Notify the file watcher that we're about to write this file
      // so the change event is suppressed (not an external change)
      window.editorAPI.notifySelfWrite(filePath);

      const result = await window.editorAPI.saveFile(
        filePath,
        fileState.semanticModel,
        state.codeSettings,
        { forceOnErrors: options?.forceOnErrors }
      );

      if (!result.success && result.validationResult) {
        set((state) => {
          state.pendingValidation = { filePath, validationResult: result.validationResult! };
          const currentFileState = state.openFiles.get(filePath);
          if (currentFileState) {
            currentFileState.lastValidationResult = result.validationResult;
          }
        });

        return { success: false, validationResult: result.validationResult };
      }

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
      // Notify the file watcher that we're writing this file ourselves
      window.editorAPI.notifySelfWrite(filePath);
      await window.editorAPI.writeFile(filePath, code);
      const processedModel = await parseSourceWithIds(code);

      set((state) => {
        const currentFileState = state.openFiles.get(filePath);
        if (currentFileState) {
          currentFileState.semanticModel = processedModel;
          currentFileState.isDirty = false;
          currentFileState.lastSaved = new Date();
          currentFileState.originalCode = code;
          currentFileState.workingCode = undefined;
          currentFileState.hasErrors = processedModel.hasErrors || false;
          currentFileState.errors = processedModel.errors || [];
          currentFileState.lastValidationResult = undefined;
        }
      });
      // historyStore subscribes to originalCode changes and clears history automatically
    } catch (error) {
      console.error('Failed to save source:', error);
      throw error;
    }
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

  resetEditorSession: () => {
    set((state) => {
      state.openFiles.clear();
      state.activeFile = null;
      state.pendingValidation = null;
    });
    // historyStore subscribes to openFiles changes and clears history automatically
    useUISelectionStore.getState().resetUISelection();
  },

  _applyHistoryModelUpdate: (filePath: string, model: SemanticModel) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (fileState) {
        fileState.semanticModel = model;
        fileState.isDirty = true;
        fileState.workingCode = undefined;
        fileState.autoSaveError = undefined;
        fileState.hasErrors = false;
      }
    });
  },

  _markFileDirty: (filePath: string) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (fileState) {
        fileState.isDirty = true;
      }
    });
  },
})));
