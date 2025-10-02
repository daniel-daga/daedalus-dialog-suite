import { create } from 'zustand';

// Helper function to normalize semantic model for serialization
function normalizeSemanticModel(model: any): any {
  const normalized = {
    dialogs: {} as any,
    functions: {} as any
  };

  // Normalize dialogs
  for (const dialogName in model.dialogs) {
    const dialog = model.dialogs[dialogName];
    normalized.dialogs[dialogName] = {
      ...dialog,
      properties: normalizeProperties(dialog.properties)
    };
  }

  // Copy functions as-is
  normalized.functions = { ...model.functions };

  return normalized;
}

function normalizeProperties(properties: any): any {
  const normalized: any = {};

  for (const key in properties) {
    const value = properties[key];

    // Convert DialogFunction objects to their name strings
    if (typeof value === 'object' && value !== null && 'name' in value && 'returnType' in value) {
      normalized[key] = value.name;
    } else {
      normalized[key] = value;
    }
  }

  return normalized;
}

interface FileState {
  filePath: string;
  semanticModel: any;
  isDirty: boolean;
  lastSaved: Date;
  originalCode?: string;
}

interface EditorProject {
  id: string;
  name: string;
  rootPath: string;
  lastOpened: Date;
  recentFiles: string[];
}

interface CodeGenerationSettings {
  indentChar: '\t' | ' ';
  includeComments: boolean;
  sectionHeaders: boolean;
  uppercaseKeywords: boolean;
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
  updateModel: (filePath: string, model: any) => void;
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
      const model = await window.editorAPI.parseFile(filePath);
      const fileState: FileState = {
        filePath,
        semanticModel: model,
        isDirty: false,
        lastSaved: new Date(),
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

  updateModel: (filePath: string, model: any) => {
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

  saveFile: async (filePath: string) => {
    const state = get();
    const fileState = state.openFiles.get(filePath);
    if (!fileState) {
      throw new Error('File not open');
    }

    try {
      // Normalize the model to convert DialogFunction objects to strings
      const normalizedModel = normalizeSemanticModel(fileState.semanticModel);

      await window.editorAPI.saveFile(
        filePath,
        normalizedModel,
        state.codeSettings
      );

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

    return window.editorAPI.generateCode(
      fileState.semanticModel,
      state.codeSettings
    );
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