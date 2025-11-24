export interface DialogMetadata {
  dialogName: string;
  npc: string;
  filePath: string;
}

export interface ProjectIndex {
  npcs: string[];
  dialogsByNpc: Map<string, DialogMetadata[]>;
  allFiles: string[];
}

export interface EditorAPI {
  // Parser API - runs in main process (has access to native modules)
  parseSource: (sourceCode: string) => Promise<any>;

  // Code Generator API - runs in main process
  generateCode: (model: any, settings: any) => Promise<string>;
  saveFile: (filePath: string, model: any, settings: any) => Promise<{ success: boolean }>;

  // File I/O API
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean }>;
  openFileDialog: () => Promise<string | null>;
  saveFileDialog: () => Promise<string | null>;

  // Project API
  openProjectFolderDialog: () => Promise<string | null>;
  buildProjectIndex: (folderPath: string) => Promise<ProjectIndex>;
  parseDialogFile: (filePath: string) => Promise<any>;
}

declare global {
  interface Window {
    editorAPI: EditorAPI;
  }
}

export {};