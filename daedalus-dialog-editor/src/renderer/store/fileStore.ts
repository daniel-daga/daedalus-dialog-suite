import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { createDialogLineId, generateActionId } from '../components/actionFactory';
import { collectDialogLineActions, mapChoiceTargetFunctions } from '../components/nestedActionUtils';
import {
  collectReachableChoiceFunctions,
  computeDialogDeletionSet,
  resolveFunctionRef
} from '../components/dialogUtils';
import { firstLineText, followFirstLine } from '../components/descriptionSync';
import { useUISelectionStore } from './uiSelectionStore';
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
import { classifySaveError, type SaveError } from '../utils/saveError';

// Enable Map/Set support in Immer
enableMapSet();

/**
 * Stamp a stable synthetic `id` on every non-DialogLine action that lacks one,
 * recursing into ConditionalAction branches. DialogLine ids are the AI_Output
 * ids handled separately below; other action types need a stable identity so
 * their React/draggable key survives a sibling deletion (0.1). The factory
 * already stamps session-created actions — this covers actions loaded from disk.
 * Returns the original array unchanged when nothing needed an id.
 */
function stampNonDialogLineActionIds(
  actions: DialogAction[]
): { actions: DialogAction[]; changed: boolean } {
  let changed = false;
  const next = actions.map((action) => {
    let result = action as DialogAction & {
      id?: string;
      thenActions?: DialogAction[];
      elseActions?: DialogAction[];
    };

    if (result.type !== 'DialogLine' && !result.id) {
      result = { ...result, id: generateActionId() };
      changed = true;
    }

    if (result.type === 'ConditionalAction') {
      const thenResult = stampNonDialogLineActionIds(result.thenActions || []);
      const elseResult = stampNonDialogLineActionIds(result.elseActions || []);
      if (thenResult.changed || elseResult.changed) {
        result = { ...result, thenActions: thenResult.actions, elseActions: elseResult.actions };
        changed = true;
      }
    }

    return result;
  });

  return changed ? { actions: next, changed } : { actions, changed };
}

/**
 * Models already put through `ensureActionIds`, keyed on the object that went
 * in and on the one that came out. `openFile` is handed the projectStore's
 * cached model object on a cross-file dialog click, and the same object again
 * on the next click — the walk is O(functions × dialogs) and has nothing left
 * to stamp the second time (§3 P3). A fresh parse is a fresh object and misses.
 */
const normalizedModels = new WeakMap<SemanticModel, SemanticModel>();

/**
 * Ensure all actions in the model have unique IDs
 */
function ensureActionIds(model: SemanticModel): SemanticModel {
  if (!model || !model.functions) return model;
  const normalized = normalizedModels.get(model);
  if (normalized) return normalized;
  const result = walkActionIds(model);
  normalizedModels.set(model, result);
  normalizedModels.set(result, result);
  return result;
}

function walkActionIds(model: SemanticModel): SemanticModel {

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

      // Also stamp stable ids on non-DialogLine actions (including nested ones)
      // so their draggable/React identity is index-independent (0.1).
      const stamped = stampNonDialogLineActionIds(actions);
      if (!hasChanges && !stamped.changed) {
        return;
      }

      updatedFunctions[funcName] = {
        ...func,
        actions: stamped.actions
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
  /**
   * Parse-state mirror of `semanticModel.hasErrors`: true when the file was
   * opened / re-parsed into a partial model. Set only where a fresh parse lands
   * (openFile, reloadFile) — never cleared by model mutations.
   * `semanticModel.hasErrors` is authoritative; this exists for cheap selector
   * access.
   */
  hasErrors?: boolean;
  errors?: ParseError[];
  lastValidationResult?: ValidationResult;
  autoSaveError?: ValidationResult;
  /**
   * Set when a save was rejected with a classifiable worker failure
   * (timeout / crash). isDirty is never cleared while this is set; cleared on
   * the next successful save or on a subsequent edit.
   */
  saveError?: SaveError;
  /**
   * Set when the file changed on disk while the editor holds unsaved changes
   * (E4). Type-only for now — the actions/watcher wiring land in a later slice;
   * the auto-save gate already excludes conflicted files.
   */
  externalConflict?: { detectedAt: string; fileMissing?: boolean };
}

/**
 * A file has unsaved changes when its model is dirty or it is in external
 * conflict. This is the single discard-guard predicate.
 */
export const hasUnsavedChanges = (fs: FileState): boolean =>
  fs.isDirty || !!fs.externalConflict;

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

  // Code generation settings
  codeSettings: CodeGenerationSettings;

  // Auto-save settings
  autoSaveEnabled: boolean;
  autoSaveInterval: number;

  // Actions
  getFileState: (filePath: string) => FileState | undefined;
  openFile: (filePath: string, opts?: { model?: SemanticModel }) => Promise<void>;
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
  saveFile: (filePath: string, options?: { forceOnErrors?: boolean; overwriteExternal?: boolean }) => Promise<SaveFileResult>;
  generateCode: (filePath: string) => Promise<string>;
  reloadFile: (filePath: string) => Promise<void>;
  markExternalConflict: (filePath: string, opts?: { fileMissing?: boolean }) => void;
  resolveExternalConflict: (filePath: string, resolution: 'keepMine' | 'reloadTheirs') => Promise<void>;
  setActiveFile: (filePath: string) => void;
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

/**
 * Cross-file voice-ID context for validation: the project-wide voice-ID index
 * minus the file being validated. Returns undefined outside project mode, so
 * validation degrades to intra-file checks only. The index is built at project
 * load/reindex time and is not refreshed on every save, so it can be stale
 * until the next reindex.
 */
function buildExistingVoiceIds(
  filePath: string
): Record<string, Array<{ filePath: string; functionName: string }>> | undefined {
  const { projectPath, voiceIdIndex } = useProjectStore.getState();
  if (!projectPath) {
    return undefined;
  }
  const existingVoiceIds: Record<string, Array<{ filePath: string; functionName: string }>> = {};
  for (const [id, entries] of Object.entries(voiceIdIndex)) {
    const otherFiles = entries.filter((entry) => entry.filePath !== filePath);
    if (otherFiles.length > 0) {
      existingVoiceIds[id] = otherFiles;
    }
  }
  return existingVoiceIds;
}

export const useFileStore = create<FileStore>()(immer((set, get) => ({
  project: null,
  openFiles: new Map(),
  activeFile: null,
  codeSettings: {
    indentChar: '\t',
    includeComments: true,
    sectionHeaders: true,
    uppercaseKeywords: true,
  },
  autoSaveEnabled: true,
  autoSaveInterval: 2000,

  getFileState: (filePath: string) => get().openFiles.get(filePath),

  openFile: async (filePath: string, opts?: { model?: SemanticModel }) => {
    try {
      const sourceCode = await window.editorAPI.readFile(filePath);
      const processedModel = opts?.model
        ? ensureActionIds(opts.model)
        : await parseSourceWithIds(sourceCode);

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
      if (!fileState) {
        return;
      }
      fileState.semanticModel = model;
      fileState.isDirty = true;
      fileState.autoSaveError = undefined;
      fileState.saveError = undefined;
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
      fileState.autoSaveError = undefined;
      fileState.saveError = undefined;
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
      fileState.autoSaveError = undefined;
      fileState.saveError = undefined;
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
      followFirstLine(fileState.semanticModel, functionName, firstLineText(fileState.semanticModel.functions[functionName]), func);
      fileState.semanticModel.functions[functionName] = func;
      fileState.isDirty = true;
      fileState.autoSaveError = undefined;
      fileState.saveError = undefined;
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

      // Read before the updater runs: it may edit the draft in place.
      const oldFirstLine = firstLineText(existingFunction);
      const updatedFunction = updater(existingFunction);
      if (!updatedFunction) {
        return;
      }

      followFirstLine(fileState.semanticModel, functionName, oldFirstLine, updatedFunction);
      fileState.semanticModel.functions[functionName] = updatedFunction;
      fileState.isDirty = true;
      fileState.autoSaveError = undefined;
      fileState.saveError = undefined;
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
      fileState.autoSaveError = undefined;
      fileState.saveError = undefined;
    });
  },

  removeDialog: (filePath: string, dialogName: string) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (!fileState) return;

      const model = fileState.semanticModel;
      const dialog = model.dialogs[dialogName];
      if (!dialog) return;

      // Functions owned by this dialog and not referenced by any remaining
      // dialog (traverses choices nested in conditional branches too)
      const functionsToDelete = computeDialogDeletionSet(model, dialogName);

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
      fileState.autoSaveError = undefined;
      fileState.saveError = undefined;
    });
  },

  renameDialog: (filePath: string, oldDialogName: string, newDialogName: string, renameFunctions = true) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (!fileState) return;

      const model = fileState.semanticModel;
      const dialogKey = Object.keys(model.dialogs).find((name) => name.toLowerCase() === oldDialogName.toLowerCase());
      const dialog = dialogKey ? model.dialogs[dialogKey] : undefined;
      if (!dialog) return;

      if (Object.keys(model.dialogs).some((name) => name !== dialogKey && name.toLowerCase() === newDialogName.toLowerCase())) {
        throw new Error(`Cannot rename dialog: ${newDialogName} already exists`);
      }

      // Resolve old info/condition function names
      const oldInfoName = resolveFunctionRef(dialog.properties?.information);
      const oldCondName = resolveFunctionRef(dialog.properties?.condition);

      // Build a rename map: oldFuncName → newFuncName
      const renameMap = new Map<string, string>();

      if (renameFunctions) {
        // Functions reachable from the info function via (possibly nested) choices
        const reachable = collectReachableChoiceFunctions(model.functions, oldInfoName);
        if (oldCondName) reachable.add(oldCondName);

        // Compute new names for functions that follow the old dialog name prefix
        for (const name of reachable) {
          if (name.slice(0, oldDialogName.length).toLowerCase() === oldDialogName.toLowerCase()) {
            const suffix = name.slice(oldDialogName.length);
            const newName = newDialogName + suffix;
            renameMap.set(name, newName);
          }
        }
      }

      const mapName = (name: string, names: Map<string, string>): string | undefined => {
        for (const [before, after] of names) {
          if (before.toLowerCase() === name.toLowerCase()) return after;
        }
        return undefined;
      };
      for (const newName of renameMap.values()) {
        const collision = Object.keys(model.functions).find((name) =>
          name.toLowerCase() === newName.toLowerCase() && !mapName(name, renameMap));
        if (collision) throw new Error(`Cannot rename dialog: function ${newName} already exists`);
      }

      // Raw statements and projected predicates do not expose patchable source
      // ranges here. Refuse the transaction before changing declarations when
      // they mention a renamed identifier; typed reference slots below are
      // rewritten directly.
      const renamedIdentifiers = [oldDialogName, ...renameMap.keys()];
      const identifierPattern = (name: string) => new RegExp(
        `(^|[^\\p{L}\\p{N}_])${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}($|[^\\p{L}\\p{N}_])`, 'iu'
      );
      const containsRenamedIdentifier = (text: string) => renamedIdentifiers.some((name) => identifierPattern(name).test(text));
      const opaqueActionText = (actions: any[]): string[] => {
        const text: string[] = [];
        for (const action of actions || []) {
          if (action?.type === 'Action' && typeof action.action === 'string') text.push(action.action);
          if (action?.type === 'ConditionalAction') {
            if (typeof action.condition === 'string') text.push(action.condition);
            text.push(...opaqueActionText(action.thenActions), ...opaqueActionText(action.elseActions));
          }
        }
        return text;
      };
      for (const func of Object.values(model.functions) as DialogFunction[]) {
        const opaque = [...opaqueActionText((func as any).actions || []),
          ...((func as any).conditions || []).map((condition: any) => condition?.condition).filter((value: unknown) => typeof value === 'string')];
        if (opaque.some(containsRenamedIdentifier)) {
          throw new Error('Cannot rename dialog safely: preserved source refers to a renamed identifier');
        }
      }
      for (const currentDialog of Object.values(model.dialogs) as Dialog[]) {
        if (opaqueActionText((currentDialog as any).actions || []).some(containsRenamedIdentifier)) {
          throw new Error('Cannot rename dialog safely: preserved source refers to a renamed identifier');
        }
      }

      const mapTarget = (target: string) => mapName(target, renameMap);
      const dialogRename = new Map([[oldDialogName, newDialogName]]);
      const mapDialog = (name: string) => mapName(name, dialogRename);

      // Update every dialog property that points at a renamed function, while
      // preserving the serialized form of plain-name and object references.
      const mapFunctionRef = (value: string | DialogFunction): string | DialogFunction => {
        const name = resolveFunctionRef(value);
        const renamed = name && mapTarget(name);
        if (!renamed) return value;
        return typeof value === 'string' ? renamed : { ...value, name: renamed };
      };
      const updatedDialogs: Record<string, Dialog> = {};
      for (const [name, value] of Object.entries(model.dialogs) as [string, Dialog][]) {
        const isRenamedDialog = name === dialogKey;
        const nextName = isRenamedDialog ? newDialogName : name;
        const properties = value.properties ? {
          ...value.properties,
          ...(value.properties.information !== undefined ? { information: mapFunctionRef(value.properties.information) } : {}),
          ...(value.properties.condition !== undefined ? { condition: mapFunctionRef(value.properties.condition) } : {}),
        } : value.properties;
        updatedDialogs[nextName] = { ...value, ...(isRenamedDialog ? { name: newDialogName } : {}), properties };
      }

      const updatedFunctions: Record<string, DialogFunction> = {};
      for (const [oldName, func] of Object.entries(model.functions) as [string, DialogFunction][]) {
        const { actions: updatedActions } = mapChoiceTargetFunctions(
          (func as any).actions || [], mapTarget, mapDialog
        );
        let conditionsChanged = false;
        const updatedConditions = ((func as any).conditions || []).map((condition: any) => {
          if (typeof condition?.dialogRef !== 'string') return condition;
          const renamed = mapDialog(condition.dialogRef);
          if (renamed === undefined || renamed === condition.dialogRef) return condition;
          conditionsChanged = true;
          return { ...condition, dialogRef: renamed };
        });
        const newName = mapName(oldName, renameMap) || oldName;
        const changed = updatedActions !== ((func as any).actions || []) || conditionsChanged || newName !== oldName;
        updatedFunctions[newName] = changed
          ? { ...func, name: newName, actions: updatedActions, conditions: updatedConditions }
          : func;
      }

      for (const value of Object.values(updatedDialogs)) {
        const { actions, changed } = mapChoiceTargetFunctions(
          (value as any).actions || [], mapTarget, mapDialog
        );
        if (changed) (value as any).actions = actions;
      }

      // Keep object-form property references linked to the same function
      // records stored in the renamed function map.
      for (const value of Object.values(updatedDialogs)) {
        if (!value.properties) continue;
        for (const propertyName of ['information', 'condition'] as const) {
          const reference = value.properties[propertyName];
          if (!reference || typeof reference === 'string') continue;
          const linked = Object.values(updatedFunctions).find(
            (func) => func.name.toLowerCase() === reference.name.toLowerCase()
          );
          if (linked) value.properties[propertyName] = linked;
        }
      }

      // Update declarationOrder: rename entries for moved dialog and functions
      const updatedOrder = (model.declarationOrder || []).map((entry) => {
        if (entry.type === 'dialog' && entry.name.toLowerCase() === oldDialogName.toLowerCase()) {
          return { ...entry, name: newDialogName };
        }
        if (entry.type === 'function') {
          const newName = mapName(entry.name, renameMap);
          if (newName) return { ...entry, name: newName };
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
      fileState.autoSaveError = undefined;
      fileState.saveError = undefined;
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
      fileState.autoSaveError = undefined;
      fileState.saveError = undefined;
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

    const existingVoiceIds = buildExistingVoiceIds(filePath);
    const validationResult = await window.editorAPI.validateModel(
      fileState.semanticModel,
      state.codeSettings,
      existingVoiceIds ? { existingVoiceIds } : undefined
    );

    set((state) => {
      const currentFileState = state.openFiles.get(filePath);
      if (currentFileState) {
        currentFileState.lastValidationResult = validationResult;
      }
    });

    return validationResult;
  },

  saveFile: async (filePath: string, options?: { forceOnErrors?: boolean; overwriteExternal?: boolean }) => {
    const state = get();
    const fileState = state.openFiles.get(filePath);
    if (!fileState) {
      throw new Error('File not open');
    }

    // A file in external conflict must not be silently overwritten (E4). The
    // save only proceeds with explicit consent (`overwriteExternal`), which the
    // conflict dialog supplies via `resolveExternalConflict('keepMine')`.
    if (fileState.externalConflict && !options?.overwriteExternal) {
      return { success: false };
    }

    // Capture the exact model reference being written so edits landing during
    // the IPC round-trip are not marked clean (E7). Compared OUTSIDE set()
    // below — the immer middleware hands updaters draft proxies which are never
    // reference-equal (same technique/comment as useAutoSave.ts).
    const savedModel = fileState.semanticModel;

    try {
      // The main process arms file-watcher self-write suppression after the
      // actual write succeeds (so a validation failure does not swallow a
      // genuine external change).
      const result = await window.editorAPI.saveFile(
        filePath,
        savedModel,
        state.codeSettings,
        {
          forceOnErrors: options?.forceOnErrors,
          overwriteExternal: options?.overwriteExternal,
          existingVoiceIds: buildExistingVoiceIds(filePath)
        }
      );

      const stillCurrent = get().openFiles.get(filePath)?.semanticModel === savedModel;

      if (!result.success && result.validationResult) {
        set((state) => {
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
          currentFileState.lastValidationResult = result.validationResult;
          currentFileState.saveError = undefined;
          // A successful write reconciles disk with the editor — any external
          // conflict is now resolved in favour of the editor's content (E4).
          currentFileState.externalConflict = undefined;
          // Only mark clean if the written model is still the current one;
          // an edit that landed mid-save is not on disk yet.
          if (stillCurrent) {
            currentFileState.isDirty = false;
            currentFileState.lastSaved = new Date();
          }
        }
      });

      return { success: true, validationResult: result.validationResult };
    } catch (error) {
      // Record a classifiable worker failure so the manual-save path surfaces
      // it the same way auto-save does. isDirty is never cleared on failure.
      const saveError = classifySaveError(error);
      if (saveError?.kind === 'external-conflict') {
        // The main-process mtime precondition (E4 phase 2) caught a change that
        // the watcher had not yet reported. Route it into the same conflict
        // dialog instead of the generic save-error chip.
        get().markExternalConflict(filePath);
      } else if (saveError) {
        set((state) => {
          const currentFileState = state.openFiles.get(filePath);
          if (currentFileState) {
            currentFileState.saveError = saveError;
          }
        });
      }
      console.error('Failed to save file:', error);
      throw error;
    }
  },

  generateCode: async (filePath: string) => {
    const state = get();
    const fileState = state.openFiles.get(filePath);
    if (!fileState) {
      throw new Error('File not open');
    }

    return window.editorAPI.generateCode(fileState.semanticModel, state.codeSettings);
  },

  /**
   * Reload a file from disk into its existing FileState slot (E4/N3). Unlike
   * `openFile`, this never touches `activeFile` and reuses the slot, so an
   * external change to a background file does not steal the user's focus. Any
   * external conflict is cleared — the editor now matches disk.
   */
  reloadFile: async (filePath: string) => {
    const reloadStartedFor = get().openFiles.get(filePath);
    if (!reloadStartedFor) return;
    // A clean-file watcher reload can detect an edit through the dirty flag.
    // A deliberate reloadTheirs starts dirty, so retain a content snapshot to
    // distinguish the edits the user chose to discard from newer ones.
    const startedModel = reloadStartedFor.isDirty
      ? JSON.stringify(reloadStartedFor.semanticModel)
      : null;
    const startedOriginalCode = reloadStartedFor.originalCode;
    const startedLastSaved = reloadStartedFor.lastSaved.getTime();
    const startedDirty = reloadStartedFor.isDirty;
    const startedConflict = reloadStartedFor.externalConflict
      ? `${reloadStartedFor.externalConflict.detectedAt}:${!!reloadStartedFor.externalConflict.fileMissing}`
      : null;

    const sourceCode = await window.editorAPI.readFile(filePath);
    const processedModel = await parseSourceWithIds(sourceCode);

    set((state) => {
      const currentFileState = state.openFiles.get(filePath);
      if (!currentFileState) {
        return;
      }
      // The disk read and parse are asynchronous. Do not apply their snapshot
      // over a FileState that changed while they were in flight. This also
      // preserves the explicit reloadTheirs choice: the dirty state captured
      // above may be discarded, but any edit made after that choice changes
      // the model snapshot and wins over this older parse.
      const currentConflict = currentFileState.externalConflict
        ? `${currentFileState.externalConflict.detectedAt}:${!!currentFileState.externalConflict.fileMissing}`
        : null;
      const modelChangedDuringReload = startedModel !== null
        && JSON.stringify(currentFileState.semanticModel) !== startedModel;
      const changedDuringReload = modelChangedDuringReload
        || currentFileState.originalCode !== startedOriginalCode
        || currentFileState.lastSaved.getTime() !== startedLastSaved
        || currentFileState.isDirty !== startedDirty
        || currentConflict !== startedConflict;
      if (changedDuringReload) {
        if (hasUnsavedChanges(currentFileState)) {
          currentFileState.externalConflict ??= { detectedAt: new Date().toISOString() };
        }
        return;
      }
      currentFileState.semanticModel = processedModel;
      currentFileState.isDirty = false;
      currentFileState.lastSaved = new Date();
      currentFileState.originalCode = sourceCode;
      currentFileState.hasErrors = processedModel.hasErrors || false;
      currentFileState.errors = processedModel.errors || [];
      currentFileState.lastValidationResult = undefined;
      currentFileState.autoSaveError = undefined;
      currentFileState.saveError = undefined;
      currentFileState.externalConflict = undefined;
    });
  },

  /**
   * Record that the file changed on disk while the editor holds unsaved changes
   * (E4). Auto-save is already gated off conflicted files; the conflict dialog
   * drives resolution. `fileMissing` marks the external-delete variant (N5).
   */
  markExternalConflict: (filePath: string, opts?: { fileMissing?: boolean }) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (!fileState) {
        return;
      }
      fileState.externalConflict = {
        detectedAt: new Date().toISOString(),
        fileMissing: opts?.fileMissing,
      };
    });
  },

  /**
   * Resolve an external conflict (E4). `keepMine` overwrites disk with the
   * editor's content; `reloadTheirs` discards the editor's changes — reloading
   * from disk, or closing the file when it was deleted externally (N5). Both
   * paths clear the conflict.
   */
  resolveExternalConflict: async (filePath: string, resolution: 'keepMine' | 'reloadTheirs') => {
    const fileState = get().openFiles.get(filePath);
    if (!fileState) {
      return;
    }

    if (resolution === 'keepMine') {
      await get().saveFile(filePath, { overwriteExternal: true });
      return;
    }

    // reloadTheirs: discard local changes.
    if (fileState.externalConflict?.fileMissing) {
      // The file is gone — there is nothing to reload; discarding means closing.
      get().closeFile(filePath);
      return;
    }
    await get().reloadFile(filePath);
  },

  /**
   * Focus an already-open file without re-reading it from disk (E4). Used by
   * the app-bar background-conflict chip to surface a conflicted file's dialog;
   * unlike `openFile`, it must never reset a dirty/conflicted FileState.
   */
  setActiveFile: (filePath: string) => {
    set((state) => {
      if (state.openFiles.has(filePath)) {
        state.activeFile = filePath;
      }
    });
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
    });
    // historyStore subscribes to openFiles changes and clears history automatically
    useUISelectionStore.getState().resetUISelection();
  },

  _applyHistoryModelUpdate: (filePath: string, model: SemanticModel) => {
    get().updateModel(filePath, model);
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
