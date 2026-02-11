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

  // Current active file
  activeFile: string | null;

  // View state
  activeView: 'dialog' | 'quest' | 'variable' | 'source';

  // UI state
  selectedNPC: string | null;
  selectedDialog: string | null;
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
  updateFunction: (filePath: string, functionName: string, func: DialogFunction) => void;
  validateFile: (filePath: string) => Promise<ValidationResult>;
  saveFile: (filePath: string, options?: { forceOnErrors?: boolean }) => Promise<SaveFileResult>;
  clearPendingValidation: () => void;
  generateCode: (filePath: string) => Promise<string>;
  setWorkingCode: (filePath: string, code: string | undefined) => void;
  saveSource: (filePath: string, code: string) => Promise<void>;
  setSelectedNPC: (npcName: string | null) => void;
  setSelectedDialog: (dialogName: string | null) => void;
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
  activeFile: null,
  activeView: 'dialog',
  selectedNPC: null,
  selectedDialog: null,
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
      });
    } catch (error) {
      console.error('Failed to save source:', error);
      throw error;
    }
  },

  setSelectedNPC: (npcName: string | null) => {
    set((state) => { state.selectedNPC = npcName; });
  },

  setSelectedDialog: (dialogName: string | null) => {
    set((state) => { state.selectedDialog = dialogName; });
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
