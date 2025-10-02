export interface EditorAPI {
  // Parser API
  parseFile: (filePath: string) => Promise<any>;
  parseSource: (sourceCode: string) => Promise<any>;
  validateSyntax: (sourceCode: string) => Promise<{ isValid: boolean; errors: any[] }>;

  // Code Generator API
  generateCode: (model: any, settings: any) => Promise<string>;
  generateDialog: (dialog: any, settings: any) => Promise<string>;
  generateFunction: (func: any, settings: any) => Promise<string>;

  // File API
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean }>;
  saveFile: (filePath: string, model: any, settings: any) => Promise<{ success: boolean }>;
  openFileDialog: () => Promise<string | null>;
  saveFileDialog: () => Promise<string | null>;
}

declare global {
  interface Window {
    editorAPI: EditorAPI;
  }
}

export {};