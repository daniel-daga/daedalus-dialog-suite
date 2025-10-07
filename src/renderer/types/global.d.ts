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
}

declare global {
  interface Window {
    editorAPI: EditorAPI;
  }
}

export {};