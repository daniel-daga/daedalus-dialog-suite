/**
 * Mock API for browser-based development and testing
 *
 * This module provides a browser-compatible implementation of the EditorAPI
 * that normally runs in Electron's main process. It uses localStorage for
 * file persistence and includes sample dialog data for testing.
 */

import type { EditorAPI, ValidationResult, SaveResult } from '../types/global';

// Sample semantic model for testing
const SAMPLE_MODEL = {
  dialogs: {
    'DIA_Example_Hello': {
      name: 'DIA_Example_Hello',
      parent: 'C_INFO',
      properties: {
        npc: 'PC_Hero',
        nr: 1,
        condition: 'DIA_Example_Hello_Condition',
        information: 'DIA_Example_Hello_Info',
        important: false,
      },
    },
  },
  functions: {
    'DIA_Example_Hello_Condition': {
      name: 'DIA_Example_Hello_Condition',
      returnType: 'INT',
      actions: [],
      calls: [],
    },
    'DIA_Example_Hello_Info': {
      name: 'DIA_Example_Hello_Info',
      returnType: 'VOID',
      calls: [],
      actions: [
        {
          speaker: 'self',
          text: 'DIA_Example_Hello_15_00',
          id: 'action_1234567890_hello',
          type: 'DialogLine',
        },
        {
          speaker: 'other',
          text: 'DIA_Example_Hello_15_01',
          id: 'action_1234567891_reply',
          type: 'DialogLine',
        },
      ],
    },
  },
  hasErrors: false,
  errors: [],
};

// Sample source code
const SAMPLE_SOURCE = `// Sample Dialog File
INSTANCE DIA_Example_Hello(C_INFO)
{
\tnpc = PC_Hero;
\tnr = 1;
\tcondition = DIA_Example_Hello_Condition;
\tinformation = DIA_Example_Hello_Info;
\timportant = FALSE;
};

FUNC INT DIA_Example_Hello_Condition()
{
};

FUNC VOID DIA_Example_Hello_Info()
{
\tAI_Output(self, other, "DIA_Example_Hello_15_00"); //Hello there!
\tAI_Output(other, self, "DIA_Example_Hello_15_01"); //Hi! How are you?
};
`;

// In-memory file system using localStorage
class MockFileSystem {
  private static STORAGE_PREFIX = 'mockapi_file_';

  static readFile(filePath: string): string {
    const key = this.STORAGE_PREFIX + filePath;
    const content = localStorage.getItem(key);

    if (content === null) {
      // Return sample file for default path
      if (filePath === 'sample.d' || filePath === '/sample.d') {
        return SAMPLE_SOURCE;
      }
      throw new Error(`File not found: ${filePath}`);
    }

    return content;
  }

  static writeFile(filePath: string, content: string): void {
    const key = this.STORAGE_PREFIX + filePath;
    localStorage.setItem(key, content);
  }

  static fileExists(filePath: string): boolean {
    const key = this.STORAGE_PREFIX + filePath;
    return localStorage.getItem(key) !== null;
  }

  static listFiles(): string[] {
    const files: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.STORAGE_PREFIX)) {
        files.push(key.substring(this.STORAGE_PREFIX.length));
      }
    }
    return files;
  }

  static clear(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.STORAGE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  }
}

// Simple parser that returns the sample model
// In a real implementation, this could use tree-sitter WASM
function parseSource(sourceCode: string): any {
  // For testing, return a model based on whether the source is the sample
  if (sourceCode.includes('DIA_Example_Hello')) {
    return { ...SAMPLE_MODEL };
  }

  // Try to extract basic dialog information using regex
  // This is a very simplified parser for testing purposes
  const dialogs: any = {};
  const functions: any = {};

  // Match INSTANCE declarations
  const instanceRegex = /INSTANCE\s+(\w+)\s*\([^)]+\)\s*\{([^}]+)\}/gi;
  let match;

  while ((match = instanceRegex.exec(sourceCode)) !== null) {
    const dialogName = match[1];
    const body = match[2];

    // Parse properties
    const properties: any = {};
    const propRegex = /(\w+)\s*=\s*([^;]+);/g;
    let propMatch;

    while ((propMatch = propRegex.exec(body)) !== null) {
      const key = propMatch[1].trim();
      let value = propMatch[2].trim();

      // Convert TRUE/FALSE to boolean
      if (value === 'TRUE') value = true;
      else if (value === 'FALSE') value = false;

      properties[key] = value;
    }

    dialogs[dialogName] = {
      name: dialogName,
      parent: 'C_INFO',
      properties,
    };
  }

  // Match FUNC declarations
  const funcRegex = /FUNC\s+(INT|VOID|STRING)\s+(\w+)\s*\(\)\s*\{([^}]+)\}/gi;

  while ((match = funcRegex.exec(sourceCode)) !== null) {
    const returnType = match[1];
    const funcName = match[2];
    const body = match[3];

    // Parse AI_Output calls
    const actions: any[] = [];
    const aiOutputRegex = /AI_Output\s*\([^,]+,\s*[^,]+,\s*"([^"]+)"\s*\)/g;
    let actionMatch;

    while ((actionMatch = aiOutputRegex.exec(body)) !== null) {
      const textId = actionMatch[1];
      actions.push({
        speaker: 'self',
        text: textId,
        id: textId,
        type: 'DialogLine',
      });
    }

    functions[funcName] = {
      name: funcName,
      returnType,
      actions,
      calls: [],
    };
  }

  return {
    dialogs,
    functions,
    hasErrors: false,
    errors: [],
  };
}

// Simple code generator
function generateCode(model: any, settings: any): string {
  const indent = settings.indentChar || '\t';
  const uppercase = settings.uppercaseKeywords !== false;
  let code = '';

  // Add comments if enabled
  if (settings.includeComments !== false) {
    code += '// Generated by Daedalus Dialog Editor\n';
    code += '// Browser Mock Mode\n\n';
  }

  // Generate dialogs
  for (const dialogName in model.dialogs) {
    const dialog = model.dialogs[dialogName];

    if (settings.sectionHeaders !== false) {
      code += '// ' + '='.repeat(60) + '\n';
      code += `// ${dialogName}\n`;
      code += '// ' + '='.repeat(60) + '\n\n';
    }

    const INSTANCE = uppercase ? 'INSTANCE' : 'instance';
    code += `${INSTANCE} ${dialogName}(${dialog.parent})\n{\n`;

    for (const key in dialog.properties) {
      const value = dialog.properties[key];
      let valueStr = value;

      if (typeof value === 'object' && value !== null) {
        valueStr = value.name || JSON.stringify(value);
      } else if (typeof value === 'boolean') {
        valueStr = uppercase ? value.toString().toUpperCase() : value.toString();
      }

      code += `${indent}${key}${indent}= ${valueStr};\n`;
    }

    code += '};\n\n';
  }

  // Generate functions
  for (const funcName in model.functions) {
    const func = model.functions[funcName];
    const FUNC = uppercase ? 'FUNC' : 'func';
    const returnType = uppercase ? func.returnType : func.returnType.toLowerCase();

    code += `${FUNC} ${returnType} ${funcName}()\n{\n`;

    if (func.actions && func.actions.length > 0) {
      for (const action of func.actions) {
        if (action.speaker && action.text && action.id) {
          // DialogLine
          code += `${indent}AI_Output(${action.speaker}, other, "${action.id}");\n`;
        }
      }
    }

    code += '};\n\n';
  }

  return code;
}

// Mock EditorAPI implementation
export const mockEditorAPI: EditorAPI = {
  async openFileDialog(): Promise<string | null> {
    // In browser mode, prompt for file path
    const path = prompt('Enter file path (or press OK for sample.d):', 'sample.d');
    return path || null;
  },

  async saveFileDialog(): Promise<string | null> {
    const path = prompt('Enter file path to save:', 'dialog.d');
    return path || null;
  },

  async readFile(filePath: string): Promise<string> {
    try {
      return MockFileSystem.readFile(filePath);
    } catch (error) {
      console.error('Mock readFile error:', error);
      throw error;
    }
  },

  async writeFile(filePath: string, content: string): Promise<{ success: boolean }> {
    try {
      MockFileSystem.writeFile(filePath, content);
      console.log(`[Mock API] File written: ${filePath}`);
      return { success: true };
    } catch (error) {
      console.error('Mock writeFile error:', error);
      return { success: false };
    }
  },

  async parseSource(sourceCode: string): Promise<any> {
    try {
      const model = parseSource(sourceCode);
      console.log('[Mock API] Parsed source code:', model);
      return model;
    } catch (error) {
      console.error('Mock parseSource error:', error);
      return {
        dialogs: {},
        functions: {},
        hasErrors: true,
        errors: [
          {
            type: 'ParseError',
            message: 'Mock parser error: ' + (error instanceof Error ? error.message : String(error)),
          },
        ],
      };
    }
  },

  async generateCode(model: any, settings: any): Promise<string> {
    try {
      const code = generateCode(model, settings);
      console.log('[Mock API] Generated code');
      return code;
    } catch (error) {
      console.error('Mock generateCode error:', error);
      throw error;
    }
  },

  async validateModel(model: any, settings: any, options?: any): Promise<ValidationResult> {
    // Mock validation - always passes in browser mode
    console.log('[Mock API] Validating model');
    const generatedCode = generateCode(model, settings);
    return {
      isValid: true,
      errors: [],
      warnings: [],
      generatedCode
    };
  },

  async saveFile(filePath: string, model: any, settings: any, options?: { skipValidation?: boolean; forceOnErrors?: boolean }): Promise<SaveResult> {
    try {
      const code = generateCode(model, settings);
      MockFileSystem.writeFile(filePath, code);
      console.log(`[Mock API] File saved: ${filePath}`);
      return {
        success: true,
        validationResult: {
          isValid: true,
          errors: [],
          warnings: [],
          generatedCode: code
        }
      };
    } catch (error) {
      console.error('Mock saveFile error:', error);
      return { success: false };
    }
  },

  async openProjectFolderDialog(): Promise<string | null> {
    const path = prompt('Enter project folder path:', '/project');
    return path || null;
  },

  async buildProjectIndex(folderPath: string): Promise<any> {
    console.log('[Mock API] Building project index for:', folderPath);
    return {
      npcs: ['PC_Hero'],
      dialogsByNpc: new Map([['PC_Hero', []]]),
      allFiles: []
    };
  },

  async parseDialogFile(filePath: string): Promise<any> {
    try {
      const content = MockFileSystem.readFile(filePath);
      return parseSource(content);
    } catch (error) {
      console.error('Mock parseDialogFile error:', error);
      return {
        dialogs: {},
        functions: {},
        hasErrors: true,
        errors: []
      };
    }
  },
};

// Helper for tests to reset mock file system
export const resetMockFileSystem = () => {
  MockFileSystem.clear();
  console.log('[Mock API] File system cleared');
};

// Helper for tests to seed files
export const seedMockFile = (filePath: string, content: string) => {
  MockFileSystem.writeFile(filePath, content);
  console.log(`[Mock API] Seeded file: ${filePath}`);
};

// Helper to list all mock files
export const listMockFiles = () => {
  return MockFileSystem.listFiles();
};
