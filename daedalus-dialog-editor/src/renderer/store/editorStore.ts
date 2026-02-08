import { create } from 'zustand';
import { generateActionId } from '../components/actionFactory';
import type {
  SemanticModel,
  Dialog,
  DialogFunction,
  DialogAction,
  ParseError,
  CodeGenerationSettings,
  ValidationResult
} from '../types/global';

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

export const useEditorStore = create<EditorStore>((set, get) => ({
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
          const newOpenFiles = new Map(state.openFiles);
          newOpenFiles.set(filePath, fileState);
          return {
            openFiles: newOpenFiles,
            activeFile: filePath,
          };
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
        const newOpenFiles = new Map(state.openFiles);
        newOpenFiles.set(filePath, fileState);
        return {
          openFiles: newOpenFiles,
          activeFile: filePath,
        };
      });
    } catch (error) {
      console.error('Failed to open file:', error);
      throw error;
    }
  },

  closeFile: (filePath: string) => {
    set((state) => {
      const newOpenFiles = new Map(state.openFiles);
      newOpenFiles.delete(filePath);
      return {
        openFiles: newOpenFiles,
        activeFile: state.activeFile === filePath ? null : state.activeFile,
      };
    });
  },

  updateModel: (filePath: string, model: SemanticModel) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (fileState) {
        const updatedFileState: FileState = {
          ...fileState,
          semanticModel: model,
          isDirty: true,
          workingCode: undefined, // Invalidate source cache
        };
        const newOpenFiles = new Map(state.openFiles);
        newOpenFiles.set(filePath, updatedFileState);
        return { openFiles: newOpenFiles };
      }
      return state;
    });
  },

  updateDialog: (filePath: string, dialogName: string, dialog: Dialog) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (!fileState) {
        return state;
      }
      const updatedModel: SemanticModel = {
        ...fileState.semanticModel,
        dialogs: {
          ...fileState.semanticModel.dialogs,
          [dialogName]: dialog
        }
      };
      const updatedFileState: FileState = {
        ...fileState,
        semanticModel: updatedModel,
        isDirty: true,
        workingCode: undefined, // Invalidate source cache
      };
      const newOpenFiles = new Map(state.openFiles);
      newOpenFiles.set(filePath, updatedFileState);
      return { openFiles: newOpenFiles };
    });
  },

  updateFunction: (filePath: string, functionName: string, func: DialogFunction) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (!fileState) {
        return state;
      }
      const updatedModel: SemanticModel = {
        ...fileState.semanticModel,
        functions: {
          ...fileState.semanticModel.functions,
          [functionName]: func
        }
      };
      const updatedFileState: FileState = {
        ...fileState,
        semanticModel: updatedModel,
        isDirty: true,
        workingCode: undefined, // Invalidate source cache
      };
      const newOpenFiles = new Map(state.openFiles);
      newOpenFiles.set(filePath, updatedFileState);
      return { openFiles: newOpenFiles };
    });
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
        const updatedFileState: FileState = {
          ...currentFileState,
          lastValidationResult: validationResult,
        };
        const newOpenFiles = new Map(state.openFiles);
        newOpenFiles.set(filePath, updatedFileState);
        return { openFiles: newOpenFiles };
      }
      return state;
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
        // Store pending validation for UI to display
        set({ pendingValidation: { filePath, validationResult: result.validationResult } });

        // Update file state with validation result
        set((state) => {
          const currentFileState = state.openFiles.get(filePath);
          if (currentFileState) {
            const updatedFileState: FileState = {
              ...currentFileState,
              lastValidationResult: result.validationResult,
            };
            const newOpenFiles = new Map(state.openFiles);
            newOpenFiles.set(filePath, updatedFileState);
            return { openFiles: newOpenFiles };
          }
          return state;
        });

        return { success: false, validationResult: result.validationResult };
      }

      // Save succeeded
      set((state) => {
        const currentFileState = state.openFiles.get(filePath);
        if (currentFileState) {
          const updatedFileState: FileState = {
            ...currentFileState,
            isDirty: false,
            lastSaved: new Date(),
            lastValidationResult: result.validationResult,
          };
          const newOpenFiles = new Map(state.openFiles);
          newOpenFiles.set(filePath, updatedFileState);
          return { openFiles: newOpenFiles, pendingValidation: null };
        }
        return state;
      });

      return { success: true, validationResult: result.validationResult };
    } catch (error) {
      console.error('Failed to save file:', error);
      throw error;
    }
  },

  clearPendingValidation: () => {
    set({ pendingValidation: null });
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
        const updatedFileState: FileState = {
          ...fileState,
          workingCode: code,
        };
        const newOpenFiles = new Map(state.openFiles);
        newOpenFiles.set(filePath, updatedFileState);
        return { openFiles: newOpenFiles };
      }
      return state;
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
          const updatedFileState: FileState = {
            ...currentFileState,
            semanticModel: processedModel,
            isDirty: false,
            lastSaved: new Date(),
            originalCode: code,
            workingCode: undefined, // Clear working code as it matches disk
            hasErrors: model.hasErrors || false,
            errors: model.errors || [],
            lastValidationResult: undefined // Clear old validation result
          };
          const newOpenFiles = new Map(state.openFiles);
          newOpenFiles.set(filePath, updatedFileState);
          return { openFiles: newOpenFiles };
        }
        return state;
      });
    } catch (error) {
      console.error('Failed to save source:', error);
      throw error;
    }
  },

  setSelectedNPC: (npcName: string | null) => {
    set({ selectedNPC: npcName });
  },

  setSelectedDialog: (dialogName: string | null) => {
    set({ selectedDialog: dialogName });
  },

  setSelectedFunctionName: (functionName: string | null) => {
    set({ selectedFunctionName: functionName });
  },

  setSelectedAction: (actionIndex: number | null) => {
    set({ selectedAction: actionIndex });
  },

  setActiveView: (view: 'dialog' | 'quest' | 'variable' | 'source') => {
    set({ activeView: view });
  },

  updateCodeSettings: (settings: Partial<CodeGenerationSettings>) => {
    set((state) => ({
      codeSettings: { ...state.codeSettings, ...settings },
    }));
  },

  setAutoSaveEnabled: (enabled: boolean) => {
    set({ autoSaveEnabled: enabled });
  },

  setAutoSaveInterval: (interval: number) => {
    set({ autoSaveInterval: interval });
  },
}));