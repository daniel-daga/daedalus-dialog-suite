import { create } from 'zustand';
import { generateActionId } from '../components/actionFactory';
import type {
  SemanticModel,
  Dialog,
  DialogFunction,
  DialogAction,
  ParseError,
  CodeGenerationSettings
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
  hasErrors?: boolean;
  errors?: ParseError[];
}

interface EditorProject {
  id: string;
  name: string;
  rootPath: string;
  lastOpened: Date;
  recentFiles: string[];
}

interface EditorStore {
  // Current project
  project: EditorProject | null;

  // Open files (keyed by path)
  openFiles: Map<string, FileState>;

  // Current active file
  activeFile: string | null;

  // UI state
  selectedDialog: string | null;
  selectedAction: number | null;

  // Code generation settings
  codeSettings: CodeGenerationSettings;

  // Actions
  openFile: (filePath: string) => Promise<void>;
  closeFile: (filePath: string) => void;
  updateModel: (filePath: string, model: SemanticModel) => void;
  updateDialog: (filePath: string, dialogName: string, dialog: Dialog) => void;
  updateFunction: (filePath: string, functionName: string, func: DialogFunction) => void;
  saveFile: (filePath: string) => Promise<void>;
  generateCode: (filePath: string) => Promise<string>;
  setSelectedDialog: (dialogName: string | null) => void;
  setSelectedAction: (actionIndex: number | null) => void;
  updateCodeSettings: (settings: Partial<CodeGenerationSettings>) => void;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  project: null,
  openFiles: new Map(),
  activeFile: null,
  selectedDialog: null,
  selectedAction: null,
  codeSettings: {
    indentChar: '\t',
    includeComments: true,
    sectionHeaders: true,
    uppercaseKeywords: true,
  },

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
      };
      const newOpenFiles = new Map(state.openFiles);
      newOpenFiles.set(filePath, updatedFileState);
      return { openFiles: newOpenFiles };
    });
  },

  saveFile: async (filePath: string) => {
    const state = get();
    const fileState = state.openFiles.get(filePath);
    if (!fileState) {
      throw new Error('File not open');
    }

    try {
      // Generate code and save in main process
      await window.editorAPI.saveFile(filePath, fileState.semanticModel, state.codeSettings);

      set((state) => {
        const updatedFileState: FileState = {
          ...fileState,
          isDirty: false,
          lastSaved: new Date(),
        };
        const newOpenFiles = new Map(state.openFiles);
        newOpenFiles.set(filePath, updatedFileState);
        return { openFiles: newOpenFiles };
      });
    } catch (error) {
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

    // Generate code in main process
    return window.editorAPI.generateCode(fileState.semanticModel, state.codeSettings);
  },

  setSelectedDialog: (dialogName: string | null) => {
    set({ selectedDialog: dialogName });
  },

  setSelectedAction: (actionIndex: number | null) => {
    set({ selectedAction: actionIndex });
  },

  updateCodeSettings: (settings: Partial<CodeGenerationSettings>) => {
    set((state) => ({
      codeSettings: { ...state.codeSettings, ...settings },
    }));
  },
}));