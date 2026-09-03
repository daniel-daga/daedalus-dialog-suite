/**
 * Mock API for browser-based development and testing
 *
 * This module provides a browser-compatible implementation of the EditorAPI
 * that normally runs in Electron's main process. It uses localStorage for
 * file persistence and includes sample dialog data for testing.
 */

import type { EditorAPI, ValidationResult, SaveResult, FileChangeEvent, AppendInsertNpcResult, OpenedProjectConfig } from '../types/global';

// Captured file-change callback (see onFileChanged). Lets E2E tests inject
// external change/unlink events through the `__mockEmitFileChange` window hook.
let mockFileChangeListener: ((event: FileChangeEvent) => void) | null = null;

// Captured close-requested callback (see onCloseRequested). There is no real
// window in the mock harness, so E2E tests inject the request via the
// `__mockEmitCloseRequested` window hook and assert against the recorded
// ack/approve/cancel calls on `window.__closeGuardCalls`.
let mockCloseRequestedListener: (() => void) | null = null;

type CloseGuardCall = 'ackCloseRequest' | 'approveClose' | 'cancelClose';

const recordCloseGuardCall = (name: CloseGuardCall) => {
  if (typeof window === 'undefined') {
    return;
  }
  const w = window as any;
  w.__closeGuardCalls = w.__closeGuardCalls || {
    ackCloseRequest: 0,
    approveClose: 0,
    cancelClose: 0,
  };
  w.__closeGuardCalls[name] += 1;
};

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
      conditions: [
          { variableName: 'MIS_MyQuest', negated: false }
      ]
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
        {
           type: 'CreateTopic',
           topic: 'TOPIC_MyQuest',
           topicType: 'LOG_MISSION'
        }
      ],
    },
  },
  constants: {
    'TOPIC_MyQuest': {
      name: 'TOPIC_MyQuest',
      type: 'string',
      value: '"The Lost Sheep"',
      filePath: 'sample.d'
    }
  },
  variables: {
    'MIS_MyQuest': {
      name: 'MIS_MyQuest',
      type: 'int',
      filePath: 'sample.d'
    }
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
// Test seam: a seeded file may carry a hand-authored SemanticModel as JSON on a
// line beginning `//__MOCK_MODEL__`. The mock regex parser cannot synthesise quest
// data (conditions, MIS transitions, choice-based transitions, condition
// expressions), so E2E specs that need a real quest graph inject the model directly
// through this marker. Everything after the marker on that line is JSON.
const MOCK_MODEL_MARKER = '//__MOCK_MODEL__';

function extractInjectedModel(sourceCode: string): any | null {
  const markerIndex = sourceCode.indexOf(MOCK_MODEL_MARKER);
  if (markerIndex === -1) return null;
  const afterMarker = sourceCode.slice(markerIndex + MOCK_MODEL_MARKER.length);
  const newlineIndex = afterMarker.indexOf('\n');
  const jsonText = (newlineIndex === -1 ? afterMarker : afterMarker.slice(0, newlineIndex)).trim();
  try {
    const model = JSON.parse(jsonText);
    return { hasErrors: false, errors: [], dialogs: {}, functions: {}, ...model };
  } catch (error) {
    return {
      dialogs: {},
      functions: {},
      hasErrors: true,
      errors: [{ type: 'MockModelParseError', message: String(error) }]
    };
  }
}

function parseSource(sourceCode: string): any {
  const injected = extractInjectedModel(sourceCode);
  if (injected) {
    return injected;
  }

  // For testing, return a model based on whether the source is the sample
  if (sourceCode.includes('DIA_Example_Hello')) {
    return { ...SAMPLE_MODEL };
  }

  // Try to extract basic dialog information using regex
  // This is a very simplified parser for testing purposes
  const dialogs: any = {};
  const functions: any = {};
  const npcs: any = {};

  // Match INSTANCE declarations
  const instanceRegex = /INSTANCE\s+(\w+)\s*\([^)]+\)\s*\{([^}]+)\}/gi;
  let match;

  while ((match = instanceRegex.exec(sourceCode)) !== null) {
    const dialogName = match[1];
    const parent = sourceCode.slice(match.index).match(/INSTANCE\s+\w+\s*\(([^)]+)\)/i)?.[1]?.trim() || 'C_INFO';
    const body = match[2];

    // Parse properties
    const properties: any = {};
    const propRegex = /(\w+)\s*=\s*([^;]+);/g;
    let propMatch;

    while ((propMatch = propRegex.exec(body)) !== null) {
      const key = propMatch[1].trim();
      let value: string | boolean = propMatch[2].trim();

      // Convert TRUE/FALSE to boolean
      if (value === 'TRUE') value = true;
      else if (value === 'FALSE') value = false;

      properties[key] = value;
    }

    if (parent === 'C_NPC') {
      npcs[dialogName] = {
        name: dialogName,
        parent: 'C_NPC',
      };
    } else {
      dialogs[dialogName] = {
        name: dialogName,
        parent: 'C_INFO',
        properties,
      };
    }
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
    npcs,
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
          // DialogLine: listener is the opposite of speaker
          const listener = action.speaker === 'other' ? 'self' : 'other';
          code += `${indent}AI_Output(${action.speaker}, ${listener}, "${action.id}");\n`;
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

  async generateDialogCode(model: any, _dialogName: string, settings: any): Promise<string> {
    return this.generateCode(model, settings);
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

  async validateModel(model: any, settings: any, _options?: any): Promise<ValidationResult> {
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

  async saveFile(filePath: string, model: any, settings: any, _options?: { skipValidation?: boolean; forceOnErrors?: boolean }): Promise<SaveResult> {
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

  async loadProjectConfig(projectRoot: string): Promise<OpenedProjectConfig> {
    return {
      projectFilePath: `${projectRoot}/mock.gothicproject.json`, projectRoot, scriptsRoot: projectRoot,
      config: { version: 1, target: 'g2-notr', scriptsRoot: '.', worlds: [], assetSources: ['.'] },
      resolvedAssetSources: [projectRoot], warnings: [],
    };
  },

  async selectAssetSourceFolder(): Promise<string | null> {
    return prompt('Enter asset source folder path:') || null;
  },

  async saveProjectAssetSources(projectFilePath: string, assetSources: string[]): Promise<OpenedProjectConfig> {
    const projectRoot = projectFilePath.replace(/[\\/][^\\/]+$/, '');
    return { projectFilePath, projectRoot, scriptsRoot: projectRoot,
      config: { version: 1, target: 'g2-notr', scriptsRoot: '.', worlds: [], assetSources },
      resolvedAssetSources: assetSources.map((source) => source === '.' ? projectRoot : source), warnings: [] };
  },

  async buildProjectIndex(_folderPath: string): Promise<any> {
    // Scan all files in the mock file system to build an index
    const files = MockFileSystem.listFiles();
    const npcs = new Set<string>();
    const dialogsByNpc: Record<string, any[]> = {};
    // Files carrying quest topic constants are prioritized by ingestion and merged
    // into the base model by loadQuestData so the QuestList can see the topics.
    const questFiles: string[] = [];

    for (const filePath of files) {
      const content = MockFileSystem.readFile(filePath);
      const model = parseSource(content);

      const hasQuestTopic = Object.keys(model.constants || {})
        .some((name) => /^topic_/i.test(name));
      if (hasQuestTopic) {
        questFiles.push(filePath);
      }

      for (const npcName in model.npcs || {}) {
        npcs.add(npcName);
        if (!dialogsByNpc[npcName]) {
          dialogsByNpc[npcName] = [];
        }
      }
      
      for (const dialogName in model.dialogs) {
        const dialog = model.dialogs[dialogName];
        const npcName = dialog.properties?.npc || 'Unknown';
        
        npcs.add(npcName);
        
        if (!dialogsByNpc[npcName]) {
          dialogsByNpc[npcName] = [];
        }
        
        dialogsByNpc[npcName].push({
          dialogName,
          npc: npcName,
          filePath
        });
      }
    }

    return {
      npcs: Array.from(npcs).sort(),
      dialogsByNpc, // Return as object, projectStore handles conversion
      allFiles: files,
      questFiles,
      npcPrototypes: []
    };
  },

  async parseDialogFile(filePath: string): Promise<any> {
    // Test seam: the mock parser is synchronous, so a whole project ingests
    // within a single microtask burst — faster than the store's 500 ms flush
    // window. That makes the real app's "ingestion in progress" phase
    // unobservable in the harness. A spec may set `mockapi_parse_delay_ms` in
    // localStorage to add a per-file latency (modelling real parse cost) so
    // ingestion spans multiple flush windows and the progress UI is exercisable.
    // Defaults to 0 → no effect on any spec that does not opt in.
    const delayMs = Number(localStorage.getItem('mockapi_parse_delay_ms')) || 0;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
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

  async addAllowedPath(folderPath: string): Promise<void> {
    console.log('[Mock API] Adding allowed path:', folderPath);
  },

  async getRecentProjects(): Promise<any[]> {
    const recent = localStorage.getItem('recent_projects');
    return recent ? JSON.parse(recent) : [];
  },

  // File Watcher API (no-op in mock/browser mode). The change callback is
  // captured so E2E tests can inject external file-change events via the
  // `__mockEmitFileChange` window hook (there is no real watcher in the mock).
  async startFileWatcher(): Promise<void> {},
  async stopFileWatcher(): Promise<void> {},
  onFileChanged(callback): () => void {
    mockFileChangeListener = callback;
    if (typeof window !== 'undefined') {
      (window as any).__mockEmitFileChange = (event: any) => mockFileChangeListener?.(event);
    }
    return () => { mockFileChangeListener = null; };
  },

  async getAppVersion(): Promise<string> {
    return '0.0.0-mock';
  },

  // Crash logging (fix-08 §5). No-ops in the browser harness so window.onerror
  // forwarding is inert and the mock stays unaffected.
  async logRendererError(_payload: { message: string; stack?: string }): Promise<void> {},
  async getLogPath(): Promise<string> {
    return '';
  },
  async showLogFile(): Promise<void> {},

  // Window close guard (E1). The request callback is captured so E2E tests can
  // inject a close request via the `__mockEmitCloseRequested` window hook; the
  // ack/approve/cancel signals are recorded for assertion (no real window here).
  onCloseRequested(callback: () => void): () => void {
    mockCloseRequestedListener = callback;
    if (typeof window !== 'undefined') {
      (window as any).__mockEmitCloseRequested = () => mockCloseRequestedListener?.();
    }
    return () => { mockCloseRequestedListener = null; };
  },
  ackCloseRequest(): void {
    recordCloseGuardCall('ackCloseRequest');
  },
  approveClose(): void {
    recordCloseGuardCall('approveClose');
  },
  cancelClose(): void {
    recordCloseGuardCall('cancelClose');
  },

  // Updater API (no-op in mock/browser mode)
  async checkForUpdate() {
    return { updateAvailable: false, currentVersion: '0.0.0-mock' };
  },
  async downloadUpdate(_url: string): Promise<string> {
    return '';
  },
  async installUpdate(_installerPath: string): Promise<void> {},

  async dismissUpdateVersion(_version: string): Promise<void> {},
  async openExternal(_url: string): Promise<void> {},
  onDownloadProgress(_callback: (percent: number) => void): () => void {
    return () => {};
  },

  // World API. There is no browser-mode stand-in for a ZenGin world: it needs
  // the native binding, a Gothic install and tens of megabytes of geometry.
  // These report "no world" rather than fabricating one — a mock world would
  // be a scene nobody could tell apart from a broken real one.
  async openWorldDialog(): Promise<string | null> { return null; },
  async openWorld(): Promise<never> {
    throw new Error('The world editor needs the desktop app — it is not available in browser mode.');
  },
  async getWorldMesh(): Promise<never> {
    throw new Error('No world is open');
  },
  async getWorldVisuals(): Promise<never> {
    throw new Error('No world is open');
  },
  async getWorldTexture(): Promise<null> { return null; },
  // Null is what the real call returns for a path with nothing to list, so an
  // asset browser in browser mode shows its empty state rather than an error.
  async listWorldAssets(): Promise<null> { return null; },
  async getWorldWaynet(): Promise<never> {
    throw new Error('No world is open');
  },
  async getWorldPortalFindings(): Promise<never> {
    throw new Error('No world is open');
  },
  // Null is what the real call returns for a visual that does not resolve, and
  // the op treats that as "leave the stale box alone" rather than as an error.
  async getVisualBounds(): Promise<null> { return null; },
  // Null is what the real call returns for a visual the binding cannot extract.
  async getWorldVisual(): Promise<null> { return null; },
  // No world means no VOB to have class properties, so this refuses like its
  // siblings rather than answering with an empty object a grid would render as
  // a VOB whose every field is blank.
  async getVobProps(): Promise<never> {
    throw new Error('No world is open');
  },
  async refreshWorldIndex(): Promise<never> {
    throw new Error('No world is open');
  },
  async applyWorldOps(): Promise<never> {
    throw new Error('No world is open');
  },
  async undoWorldEdit(): Promise<null> { return null; },
  async redoWorldEdit(): Promise<null> { return null; },
  async getWorldHistoryDepth(): Promise<{ undo: number; redo: number }> { return { undo: 0, redo: 0 }; },
  // Cancelled rather than "no world is open": in browser mode there is no
  // dialog to open, and a cancelled save is a state the surface already handles.
  async saveWorldDialog(): Promise<null> { return null; },
  async saveWorld(): Promise<never> {
    throw new Error('No world is open');
  },
  async getVobFolders(): Promise<never> {
    throw new Error('No world is open');
  },
  async saveVobFolders(): Promise<never> {
    throw new Error('No world is open');
  },
  async closeWorld(): Promise<void> {},
  // The browser harness has no world and no Startup.d on disk; a typed
  // refusal keeps the surface's error path reachable without a file.
  async appendInsertNpc(_filePath: string, functionName: string): Promise<AppendInsertNpcResult> {
    return { ok: false, reason: { kind: 'function-not-found', functionName } };
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
