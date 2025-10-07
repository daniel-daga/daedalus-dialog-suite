import { create } from 'zustand';

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
      // Read and parse file in main process (has access to native modules)
      const sourceCode = await window.editorAPI.readFile(filePath);
      const model = await window.editorAPI.parseSource(sourceCode);

      const fileState: FileState = {
        filePath,
        semanticModel: model,
        isDirty: false,
        lastSaved: new Date(),
        originalCode: sourceCode,
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