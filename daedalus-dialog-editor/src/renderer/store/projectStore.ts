/**
 * Project Store - Manages Gothic mod project state
 *
 * Handles:
 * - Project loading and indexing
 * - NPC list from project
 * - Dialog file discovery
 * - Lazy loading of dialog semantic models
 */

import { create } from 'zustand';
import type { DialogMetadata, SemanticModel, GlobalSymbol } from '../types/global';

export interface ParsedFileCache {
  filePath: string;
  semanticModel: SemanticModel;
  lastParsed: Date;
}

/** Empty semantic model factory */
function createEmptySemanticModel(): SemanticModel {
  return {
    dialogs: {},
    functions: {},
    constants: {},
    variables: {},
    instances: {},
    hasErrors: false,
    errors: []
  };
}

interface ProjectState {
  // Project metadata
  projectPath: string | null;
  projectName: string | null;

  // Project index (lightweight)
  npcList: string[];
  dialogIndex: Map<string, DialogMetadata[]>; // NPC ID → dialogs
  allDialogFiles: string[];
  questFiles: string[];
  symbols: Map<string, GlobalSymbol>;
  questReferences: Map<string, string[]>;

  // Cached parsed files (full semantic models)
  parsedFiles: Map<string, ParsedFileCache>;

  // Merged semantic model for currently selected NPC
  mergedSemanticModel: SemanticModel;

  // Current selection
  selectedNpc: string | null;

  // Loading state
  isLoading: boolean;
  loadError: string | null;
}

interface ProjectActions {
  // Open and index a project
  openProject: (folderPath: string) => Promise<void>;

  // Close project
  closeProject: () => void;

  // Select an NPC
  selectNpc: (npcId: string) => void;

  // Get dialogs for currently selected NPC
  getSelectedNpcDialogs: () => DialogMetadata[];

  // Get or parse a dialog file
  getSemanticModel: (filePath: string) => Promise<SemanticModel>;

  // Ensure specific files are parsed and cached
  ensureFilesParsed: (filePaths: string[]) => Promise<void>;

  // Merge multiple semantic models into one
  mergeSemanticModels: (models: SemanticModel[]) => void;

  // Load and merge semantic models for a specific NPC
  loadAndMergeNpcModels: (npcId: string) => void;

  // Load and merge quest data (global constants/vars)
  loadQuestData: () => Promise<void>;

  // Load files relevant to a quest
  loadQuestFiles: (questName: string) => Promise<void>;

  // Get usage data for a specific quest from loaded files
  getQuestUsage: (questName: string) => SemanticModel;

  // Create a new quest
  createQuest: (title: string, internalName: string, topicFilePath: string, variableFilePath: string) => Promise<void>;

  // Add a new global variable or constant
  addVariable: (name: string, type: string, value: string | number | boolean | undefined, filePath: string, isConstant: boolean) => Promise<void>;

  // Delete a global variable or constant
  deleteVariable: (filePath: string, range: { startIndex: number, endIndex: number }) => Promise<void>;

  // Clear merged semantic model
  clearMergedModel: () => void;

  // Clear cached semantic models (free memory)
  clearCache: () => void;
}

type ProjectStore = ProjectState & ProjectActions;

export const useProjectStore = create<ProjectStore>((set, get) => ({
  // Initial state
  projectPath: null,
  projectName: null,
  npcList: [],
  dialogIndex: new Map(),
  allDialogFiles: [],
  questFiles: [],
  symbols: new Map(),
  questReferences: new Map(),
  parsedFiles: new Map(),
  mergedSemanticModel: createEmptySemanticModel(),
  selectedNpc: null,
  isLoading: false,
  loadError: null,

  // Actions
  openProject: async (folderPath: string) => {
    set({ isLoading: true, loadError: null });

    try {
      // Build project index via IPC
      const rawIndex = await window.editorAPI.buildProjectIndex(folderPath);

      // Convert the plain object back to Map (IPC serialization loses Map type)
      const dialogsByNpc = new Map<string, DialogMetadata[]>();
      if (rawIndex.dialogsByNpc) {
        if (rawIndex.dialogsByNpc instanceof Map) {
          rawIndex.dialogsByNpc.forEach((value, key) => {
            dialogsByNpc.set(key, value);
          });
        } else {
          Object.entries(rawIndex.dialogsByNpc).forEach(([key, value]) => {
            dialogsByNpc.set(key, value as DialogMetadata[]);
          });
        }
      }

      const symbols = new Map<string, GlobalSymbol>();
      if (rawIndex.symbols) {
        if (rawIndex.symbols instanceof Map) {
            rawIndex.symbols.forEach((value, key) => symbols.set(key, value));
        } else {
            Object.entries(rawIndex.symbols).forEach(([key, value]) => symbols.set(key, value as GlobalSymbol));
        }
      }

      const questReferences = new Map<string, string[]>();
      if (rawIndex.questReferences) {
        if (rawIndex.questReferences instanceof Map) {
            rawIndex.questReferences.forEach((value, key) => questReferences.set(key, value));
        } else {
            Object.entries(rawIndex.questReferences).forEach(([key, value]) => questReferences.set(key, value as string[]));
        }
      }

      // Extract project name from path
      const pathParts = folderPath.split(/[\\/]/);
      const projectName = pathParts[pathParts.length - 1];

      set({
        projectPath: folderPath,
        projectName,
        npcList: rawIndex.npcs || [],
        dialogIndex: dialogsByNpc,
        allDialogFiles: rawIndex.allFiles || [],
        questFiles: rawIndex.questFiles || [],
        symbols,
        questReferences,
        isLoading: false,
        parsedFiles: new Map(), // Clear any previous cache
        selectedNpc: null
      });

      // We do NOT ingest all files automatically anymore (Performance fix)
      // Only load quest data to ensure global constants are available
      await get().loadQuestData();

    } catch (error) {
      set({
        isLoading: false,
        loadError: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  },

  closeProject: () => {
    set({
      projectPath: null,
      projectName: null,
      npcList: [],
      dialogIndex: new Map(),
      allDialogFiles: [],
      questFiles: [],
      symbols: new Map(),
      questReferences: new Map(),
      parsedFiles: new Map(),
      mergedSemanticModel: createEmptySemanticModel(),
      selectedNpc: null,
      loadError: null
    });
  },

  selectNpc: (npcId: string) => {
    set({ selectedNpc: npcId });
  },

  getSelectedNpcDialogs: () => {
    const { selectedNpc, dialogIndex } = get();
    if (!selectedNpc) return [];
    return dialogIndex.get(selectedNpc) || [];
  },

  getSemanticModel: async (filePath: string) => {
    const { parsedFiles } = get();

    // Check if already cached
    const cached = parsedFiles.get(filePath);
    if (cached) {
      return cached.semanticModel;
    }

    // Parse file via IPC
    const semanticModel = await window.editorAPI.parseDialogFile(filePath);

    // Inject file path into constants and variables for tracking
    if (semanticModel.constants) {
      Object.values(semanticModel.constants).forEach(c => { c.filePath = filePath; });
    }
    if (semanticModel.variables) {
      Object.values(semanticModel.variables).forEach(v => { v.filePath = filePath; });
    }

    // Cache the result
    set((state) => {
      const newCache = new Map(state.parsedFiles);
      newCache.set(filePath, {
        filePath,
        semanticModel,
        lastParsed: new Date()
      });
      return { parsedFiles: newCache };
    });

    return semanticModel;
  },

  ensureFilesParsed: async (filePaths: string[]) => {
    const { parsedFiles, getSemanticModel } = get();
    const uncachedFiles = filePaths.filter(p => !parsedFiles.has(p));

    // Process in parallel with concurrency limit if needed,
    // but typically user selection implies small working set.
    // Using simple Promise.all for now as it shouldn't be 1000s of files.
    await Promise.all(uncachedFiles.map(f => getSemanticModel(f)));
  },

  mergeSemanticModels: (models: SemanticModel[]) => {
    const mergedModel: SemanticModel = createEmptySemanticModel();

    const modelsWithErrors = models.filter(model => model?.hasErrors);
    if (modelsWithErrors.length > 0) {
      mergedModel.hasErrors = true;
      mergedModel.errors = modelsWithErrors.flatMap(model => model.errors || []);
    }

    // Merge all models, skipping those with errors
    models.forEach(model => {
      // Skip models with errors to avoid corrupting the merged model
      if (model?.hasErrors) {
        return;
      }

      if (model?.dialogs) {
        Object.assign(mergedModel.dialogs, model.dialogs);
      }
      if (model?.functions) {
        Object.assign(mergedModel.functions, model.functions);
      }
      if (model?.constants) {
        Object.assign(mergedModel.constants, model.constants);
      }
      if (model?.variables) {
        Object.assign(mergedModel.variables, model.variables);
      }
      if (model?.instances) {
        Object.assign(mergedModel.instances, model.instances);
      }
    });

    set({ mergedSemanticModel: mergedModel });
  },

  loadQuestData: async () => {
    const { questFiles, ensureFilesParsed, parsedFiles, mergeSemanticModels } = get();

    // Ensure all quest files are parsed
    await ensureFilesParsed(questFiles);

    // Collect models
    const models = questFiles
        .map(f => parsedFiles.get(f)?.semanticModel)
        .filter((m): m is SemanticModel => !!m);

    const currentModel = get().mergedSemanticModel;
    mergeSemanticModels([currentModel, ...models]);
  },

  loadQuestFiles: async (questName: string) => {
    const { questReferences, ensureFilesParsed, symbols } = get();

    const referencingFiles = questReferences.get(questName) || [];

    // Also find where the quest is defined (TOPIC_ variable)
    const definitionFile = symbols.get(questName)?.filePath;
    const misVarName = questName.replace('TOPIC_', 'MIS_');
    const misVarFile = symbols.get(misVarName)?.filePath;

    const filesToLoad = new Set([
        ...referencingFiles,
        ...(definitionFile ? [definitionFile] : []),
        ...(misVarFile ? [misVarFile] : [])
    ]);

    await ensureFilesParsed(Array.from(filesToLoad));
  },

  getQuestUsage: (questName: string) => {
    const { parsedFiles } = get();
    const result = createEmptySemanticModel();
    const misVarName = questName.replace('TOPIC_', 'MIS_');
    const relevantFunctionNames = new Set<string>();

    // Pass 1: Identify all relevant functions and add definitions
    for (const fileData of parsedFiles.values()) {
        const model = fileData.semanticModel;

        // Constants & Variables
        if (model.constants && model.constants[questName]) {
             result.constants = result.constants || {};
             result.constants[questName] = model.constants[questName];
        }
        if (model.variables && model.variables[misVarName]) {
             result.variables = result.variables || {};
             result.variables[misVarName] = model.variables[misVarName];
        }

        // Functions
        if (model.functions) {
             Object.values(model.functions).forEach(func => {
                 let isRelevant = false;

                 // Check Actions
                 if (func.actions) {
                     for (const action of func.actions) {
                         // Check for TOPIC usage
                         if ('topic' in action && action.topic === questName) {
                             isRelevant = true;
                             break;
                         }
                     }
                 }

                 // Check Conditions
                 if (!isRelevant && func.conditions) {
                     for (const cond of func.conditions) {
                         // Check for MIS variable usage
                         if ('variableName' in cond && cond.variableName === misVarName) {
                             isRelevant = true;
                             break;
                         }
                     }
                 }

                 if (isRelevant) {
                     relevantFunctionNames.add(func.name);
                     result.functions[func.name] = func;
                 }
             });
        }
    }

    // Pass 2: Identify Dialogs that use relevant functions
    for (const fileData of parsedFiles.values()) {
        const model = fileData.semanticModel;

        if (model.dialogs) {
            Object.values(model.dialogs).forEach(dialog => {
                const info = dialog.properties.information;
                const cond = dialog.properties.condition;

                const infoName = typeof info === 'string' ? info : (typeof info === 'object' ? info.name : null);
                const condName = typeof cond === 'string' ? cond : (typeof cond === 'object' ? cond.name : null);

                if ((infoName && relevantFunctionNames.has(infoName)) ||
                    (condName && relevantFunctionNames.has(condName))) {
                    result.dialogs[dialog.name] = dialog;
                }
            });
        }
    }

    return result;
  },

  createQuest: async (title: string, internalName: string, topicFilePath: string, variableFilePath: string) => {
    const { getSemanticModel, mergeSemanticModels } = get();

    try {
      set({ isLoading: true });

      // 1. Prepare content to append
      // Check if files are the same
      if (topicFilePath === variableFilePath) {
        const content = `\n// Quest: ${title}\nconst string TOPIC_${internalName} = "${title}";\nvar int MIS_${internalName};\n`;

        // Read current content to ensure we append correctly (newline check)
        let currentContent = await window.editorAPI.readFile(topicFilePath);
        if (!currentContent.endsWith('\n')) currentContent += '\n';

        await window.editorAPI.writeFile(topicFilePath, currentContent + content);
      } else {
        // Append constant
        const constContent = `\nconst string TOPIC_${internalName} = "${title}";\n`;
        let topicFileContent = await window.editorAPI.readFile(topicFilePath);
        if (!topicFileContent.endsWith('\n')) topicFileContent += '\n';
        await window.editorAPI.writeFile(topicFilePath, topicFileContent + constContent);

        // Append variable
        const varContent = `\nvar int MIS_${internalName};\n`;
        let varFileContent = await window.editorAPI.readFile(variableFilePath);
        if (!varFileContent.endsWith('\n')) varFileContent += '\n';
        await window.editorAPI.writeFile(variableFilePath, varFileContent + varContent);
      }

      // 2. Clear cache for modified files
      const { parsedFiles } = get();
      const newCache = new Map(parsedFiles);
      newCache.delete(topicFilePath);
      newCache.delete(variableFilePath);
      set({ parsedFiles: newCache });

      // 3. Re-load quest data (re-parse the modified files)
      const topicModel = await get().getSemanticModel(topicFilePath);
      const variableModel = (topicFilePath === variableFilePath) ? topicModel : await get().getSemanticModel(variableFilePath);

      // Merge into current model
      get().mergeSemanticModels([get().mergedSemanticModel, topicModel, variableModel]);

      // Note: We don't update local 'symbols' or 'questReferences' here manually because
      // it's complex to replicate regex logic. They will be out of sync until project reload.
      // However, 'parsedFiles' IS updated, so 'getQuestUsage' will still work fine.

      set({ isLoading: false });

    } catch (error) {
      set({ isLoading: false, loadError: error instanceof Error ? error.message : 'Failed to create quest' });
      throw error; // Re-throw so UI can handle it
    }
  },

  addVariable: async (name: string, type: string, value: string | number | boolean | undefined, filePath: string, isConstant: boolean) => {
    const { getSemanticModel, mergeSemanticModels } = get();

    try {
      set({ isLoading: true });

      let content = '';
      if (isConstant) {
          // Format value based on type or just as string if complex
          let valueStr = String(value);
          // Only quote if type is string
          if (type === 'string') {
              valueStr = `"${value}"`;
          }
          content = `\nconst ${type} ${name} = ${valueStr};\n`;
      } else {
          content = `\nvar ${type} ${name};\n`;
      }

      // Read current content to ensure we append correctly (newline check)
      let currentContent = await window.editorAPI.readFile(filePath);
      if (!currentContent.endsWith('\n')) currentContent += '\n';

      await window.editorAPI.writeFile(filePath, currentContent + content);

      // Clear cache for modified file
      const { parsedFiles } = get();
      const newCache = new Map(parsedFiles);
      newCache.delete(filePath);
      set({ parsedFiles: newCache });

      // Re-parse the modified file
      const updatedModel = await get().getSemanticModel(filePath);

      // Merge into current model
      get().mergeSemanticModels([get().mergedSemanticModel, updatedModel]);

      set({ isLoading: false });

    } catch (error) {
       set({ isLoading: false, loadError: error instanceof Error ? error.message : 'Failed to add variable' });
       throw error;
    }
  },

  deleteVariable: async (filePath: string, range: { startIndex: number, endIndex: number }) => {
    const { getSemanticModel, mergeSemanticModels } = get();

    try {
      set({ isLoading: true });

      // Read current content
      const content = await window.editorAPI.readFile(filePath);

      // Remove the variable definition
      // We also check for a following newline to remove blank lines if possible
      let end = range.endIndex;
      if (content[end] === '\n') end++;
      else if (content[end] === '\r' && content[end + 1] === '\n') end += 2;

      const newContent = content.slice(0, range.startIndex) + content.slice(end);

      await window.editorAPI.writeFile(filePath, newContent);

      // Clear cache for modified file
      const { parsedFiles } = get();
      const newCache = new Map(parsedFiles);
      newCache.delete(filePath);
      set({ parsedFiles: newCache });

      // Re-parse the modified file
      const updatedModel = await get().getSemanticModel(filePath);

      // Merge into current model
      get().mergeSemanticModels([get().mergedSemanticModel, updatedModel]);

      set({ isLoading: false });

    } catch (error) {
       set({ isLoading: false, loadError: error instanceof Error ? error.message : 'Failed to delete variable' });
       throw error;
    }
  },

  loadAndMergeNpcModels: (npcId: string) => {
    const { dialogIndex, parsedFiles } = get();

    // Get dialog metadata for this NPC
    const dialogMetadata = dialogIndex.get(npcId) || [];

    // Extract unique file paths
    const uniqueFilePaths = [...new Set(dialogMetadata.map(m => m.filePath))];

    // Get semantic models from cache
    const semanticModels = uniqueFilePaths
      .map(filePath => parsedFiles.get(filePath)?.semanticModel)
      .filter((model): model is SemanticModel => model !== undefined);

    // Merge the models
    get().mergeSemanticModels(semanticModels);
  },

  clearMergedModel: () => {
    set({
      mergedSemanticModel: createEmptySemanticModel()
    });
  },

  clearCache: () => {
    set({ parsedFiles: new Map() });
  }
}));
