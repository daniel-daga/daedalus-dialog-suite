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
import { enableMapSet } from 'immer';
import type { DialogMetadata, SemanticModel } from '../types/global';
import {
  getCanonicalQuestKey,
  getQuestMisVariableName,
  isCaseInsensitiveMatch
} from '../utils/questIdentity';

// Enable Map/Set support in Immer
enableMapSet();

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
    items: {},
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

  // Cached parsed files (full semantic models)
  parsedFiles: Map<string, ParsedFileCache>;

  // Merged semantic model for currently selected NPC
  mergedSemanticModel: SemanticModel;

  // Current selection
  selectedNpc: string | null;

  // Loading state
  isLoading: boolean;
  loadError: string | null;
  
  // Background ingestion
  isIngesting: boolean;
  abortIngestion: (() => void) | null;

  // UI state
  isIngestedFilesOpen: boolean;
}

interface ProjectActions {
  // Open and index a project
  openProject: (folderPath: string) => Promise<void>;

  // Start background ingestion of all files
  startBackgroundIngestion: () => void;

  // Close project
  closeProject: () => void;

  // Select an NPC
  selectNpc: (npcId: string) => void;

  // Get dialogs for currently selected NPC
  getSelectedNpcDialogs: () => DialogMetadata[];

  // Get or parse a dialog file
  getSemanticModel: (filePath: string) => Promise<SemanticModel>;

  // Merge multiple semantic models into one
  mergeSemanticModels: (models: SemanticModel[]) => void;

  // Load and merge semantic models for a specific NPC
  loadAndMergeNpcModels: (npcId: string) => void;

  // Load and merge quest data (global constants/vars)
  loadQuestData: () => Promise<void>;

  // Get usage data for a specific quest across the entire project
  getQuestUsage: (questName: string) => SemanticModel;

  // Create a new quest
  createQuest: (title: string, internalName: string, topicFilePath: string, variableFilePath: string) => Promise<void>;

  // Add a new global variable or constant
  addVariable: (name: string, type: string, value: string | number | boolean | undefined, filePath: string, isConstant: boolean) => Promise<void>;

  // Update a global constant value
  updateGlobalConstant: (name: string, value: string, filePath: string) => Promise<void>;

  // Delete a global variable or constant
  deleteVariable: (filePath: string, range: { startIndex: number, endIndex: number }) => Promise<void>;

  // Clear merged semantic model
  clearMergedModel: () => void;

  // Clear cached semantic models (free memory)
  clearCache: () => void;

  // Update a cached semantic model for a file
  updateFileModel: (filePath: string, model: SemanticModel) => void;

  // Register a newly created dialog in the project index
  addDialogToIndex: (metadata: DialogMetadata) => void;

  // UI actions
  setIngestedFilesOpen: (open: boolean) => void;
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
  parsedFiles: new Map(),
  mergedSemanticModel: createEmptySemanticModel(),
  selectedNpc: null,
  isLoading: false,
  loadError: null,
  isIngesting: false,
  abortIngestion: null,
  isIngestedFilesOpen: false,

  // Actions
  openProject: async (folderPath: string) => {
    set({ isLoading: true, loadError: null });

    try {
      // Ensure the path is allowed in the backend (especially for recent projects)
      await window.editorAPI.addAllowedPath(folderPath);

      // Build project index via IPC
      const rawIndex = await window.editorAPI.buildProjectIndex(folderPath);

      // Convert the plain object back to Map (IPC serialization loses Map type)
      const dialogsByNpc = new Map<string, DialogMetadata[]>();
      if (rawIndex.dialogsByNpc) {
        // If it's already a Map
        if (rawIndex.dialogsByNpc instanceof Map) {
          rawIndex.dialogsByNpc.forEach((value, key) => {
            dialogsByNpc.set(key, value);
          });
        } else {
          // If it was serialized as an object
          Object.entries(rawIndex.dialogsByNpc).forEach(([key, value]) => {
            dialogsByNpc.set(key, value as DialogMetadata[]);
          });
        }
      }

      // Extract project name from path
      const pathParts = folderPath.split(/[\\/]/);
      const projectName = pathParts[pathParts.length - 1];

      // Add to recent projects
      await window.editorAPI.addRecentProject(folderPath, projectName);

      set({
        projectPath: folderPath,
        projectName,
        npcList: rawIndex.npcs || [],
        dialogIndex: dialogsByNpc,
        allDialogFiles: rawIndex.allFiles || [],
        questFiles: rawIndex.questFiles || [],
        isLoading: false,
        parsedFiles: new Map(), // Clear any previous cache
        selectedNpc: null
      });

      // Start background ingestion
      get().startBackgroundIngestion();

    } catch (error) {
      set({
        isLoading: false,
        loadError: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  },

  startBackgroundIngestion: async () => {
    const { allDialogFiles, questFiles, abortIngestion } = get();
    
    // Cancel previous ingestion if running
    if (abortIngestion) {
      abortIngestion();
    }

    const controller = new AbortController();
    set({ isIngesting: true, abortIngestion: () => controller.abort() });

    // Prioritize quest files, then the rest
    const priorityFiles = new Set([...questFiles]);
    const remainingFiles = allDialogFiles.filter(f => !priorityFiles.has(f));
    const ingestionQueue = [...priorityFiles, ...remainingFiles];

    // Batch updates to avoid excessive re-renders
    const pendingUpdates = new Map<string, ParsedFileCache>();
    const flushUpdates = () => {
      if (pendingUpdates.size > 0) {
        set((state) => {
          const newCache = new Map(state.parsedFiles);
          pendingUpdates.forEach((value, key) => newCache.set(key, value));
          return { parsedFiles: newCache };
        });
        pendingUpdates.clear();
      }
    };
    
    const flushInterval = setInterval(flushUpdates, 500);

    // Process in background
    try {
      // Concurrency limit for parallel ingestion
      // Increased to 20 to utilize backend worker pool (max 8 workers)
      const CONCURRENCY_LIMIT = 20;
      
      let currentIndex = 0;
      const processNext = async (): Promise<void> => {
        if (controller.signal.aborted) return;
        
        while (currentIndex < ingestionQueue.length) {
          if (controller.signal.aborted) return;
          
          const filePath = ingestionQueue[currentIndex++];
          
          // Skip if already parsed (check both store and pending)
          if (get().parsedFiles.has(filePath) || pendingUpdates.has(filePath)) continue;

          try {
            // Parse the file directly to avoid state update in getSemanticModel
            const semanticModel = await window.editorAPI.parseDialogFile(filePath);

            // Inject file path into constants and variables for tracking
            if (semanticModel.constants) {
              Object.values(semanticModel.constants).forEach(c => { c.filePath = filePath; });
            }
            if (semanticModel.variables) {
              Object.values(semanticModel.variables).forEach(v => { v.filePath = filePath; });
            }

            // Add to batch
            pendingUpdates.set(filePath, {
              filePath,
              semanticModel,
              lastParsed: new Date()
            });

          } catch (e) {
            console.warn(`Background ingestion failed for ${filePath}:`, e);
            
            if (controller.signal.aborted) return;

            // Add error to batch
            pendingUpdates.set(filePath, {
               filePath,
               semanticModel: {
                 ...createEmptySemanticModel(),
                 hasErrors: true,
                 errors: [{
                    type: 'ingestion_error',
                    message: e instanceof Error ? e.message : String(e)
                 }]
               },
               lastParsed: new Date()
            });
          }
        }
      };

      // Start initial batch of workers
      const workers = Array(CONCURRENCY_LIMIT).fill(null).map(() => processNext());
      await Promise.all(workers);

    } finally {
      clearInterval(flushInterval);
      // Final flush
      flushUpdates();
      
      if (!controller.signal.aborted) {
        set({ isIngesting: false, abortIngestion: null });
      }
    }
  },

  closeProject: () => {
    // Abort any running ingestion
    const { abortIngestion } = get();
    if (abortIngestion) {
      abortIngestion();
    }

    set({
      projectPath: null,
      projectName: null,
      npcList: [],
      dialogIndex: new Map(),
      allDialogFiles: [],
      parsedFiles: new Map(),
      mergedSemanticModel: createEmptySemanticModel(),
      selectedNpc: null,
      loadError: null,
      isIngesting: false,
      abortIngestion: null
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
      if (model?.items) {
        Object.assign(mergedModel.items, model.items);
      }
    });

    set({ mergedSemanticModel: mergedModel });
  },

  loadQuestData: async () => {
    const { questFiles, getSemanticModel, mergeSemanticModels } = get();

    // Parse all quest files
    const models = await Promise.all(
        questFiles.map(filePath => getSemanticModel(filePath))
    );

    const currentModel = get().mergedSemanticModel;
    mergeSemanticModels([currentModel, ...models]);
  },

  getQuestUsage: (questName: string) => {
    const { parsedFiles } = get();
    const result = createEmptySemanticModel();
    const misVarName = getQuestMisVariableName(questName);
    const relevantFunctionKeys = new Set<string>();

    // Pass 1: Identify all relevant functions and add definitions
    for (const fileData of parsedFiles.values()) {
        const model = fileData.semanticModel;

        // Constants & Variables
        const topicKey = Object.keys(model.constants || {}).find((key) => isCaseInsensitiveMatch(key, questName));
        if (topicKey && model.constants) {
             result.constants = result.constants || {};
             result.constants[topicKey] = model.constants[topicKey];
        }
        const misKey = Object.keys(model.variables || {}).find((key) => isCaseInsensitiveMatch(key, misVarName));
        if (misKey && model.variables) {
             result.variables = result.variables || {};
             result.variables[misKey] = model.variables[misKey];
        }

        // Functions
        if (model.functions) {
             Object.values(model.functions).forEach(func => {
                 let isRelevant = false;

                 // Check Actions
                 if (func.actions) {
                     for (const action of func.actions) {
                         // Topic references
                         if ('topic' in action && isCaseInsensitiveMatch(action.topic, questName)) {
                             isRelevant = true;
                             break;
                         }
                         // Explicit MIS writers (writer-only quest handlers)
                         if (action.type === 'SetVariableAction' && isCaseInsensitiveMatch(action.variableName, misVarName)) {
                             isRelevant = true;
                             break;
                         }
                     }
                 }

                 // Check Conditions
                 if (!isRelevant && func.conditions) {
                     for (const cond of func.conditions) {
                         if ('variableName' in cond && isCaseInsensitiveMatch(cond.variableName, misVarName)) {
                             isRelevant = true;
                             break;
                         }
                     }
                 }

                 if (isRelevant) {
                     relevantFunctionKeys.add(getCanonicalQuestKey(func.name));
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

                if ((infoName && relevantFunctionKeys.has(getCanonicalQuestKey(infoName))) ||
                    (condName && relevantFunctionKeys.has(getCanonicalQuestKey(condName)))) {
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
      // Check if we need to create a variable
      const hasVariable = !!variableFilePath;

      if (hasVariable && topicFilePath === variableFilePath) {
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

        // Append variable if requested
        if (hasVariable) {
            const varContent = `\nvar int MIS_${internalName};\n`;
            let varFileContent = await window.editorAPI.readFile(variableFilePath);
            if (!varFileContent.endsWith('\n')) varFileContent += '\n';
            await window.editorAPI.writeFile(variableFilePath, varFileContent + varContent);
        }
      }

      // 2. Clear cache for modified files
      const { parsedFiles } = get();
      const newCache = new Map(parsedFiles);
      newCache.delete(topicFilePath);
      if (hasVariable) newCache.delete(variableFilePath);
      set({ parsedFiles: newCache });

      // 3. Re-load quest data (re-parse the modified files)
      const topicModel = await get().getSemanticModel(topicFilePath);
      const modelsToMerge = [get().mergedSemanticModel, topicModel];
      
      if (hasVariable && variableFilePath !== topicFilePath) {
          const variableModel = await get().getSemanticModel(variableFilePath);
          modelsToMerge.push(variableModel);
      }

      // Merge into current model
      get().mergeSemanticModels(modelsToMerge);

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

  updateGlobalConstant: async (name: string, value: string, filePath: string) => {
    const { getSemanticModel, mergeSemanticModels } = get();

    try {
      set({ isLoading: true });

      // Read current content
      const content = await window.editorAPI.readFile(filePath);

      // Find the constant definition using regex
      // Matches: const <type> <name> = <value>;
      const regex = new RegExp(`(const\\s+\\w+\\s+${name}\\s*=\\s*)([^;]+)(;)`);

      const match = content.match(regex);
      if (!match) {
          throw new Error(`Could not find constant definition for ${name} in ${filePath}`);
      }

      // Check type from existing constant to decide on quotes
      const constant = get().mergedSemanticModel.constants?.[name];
      const isString = constant?.type?.toLowerCase() === 'string';
      const newValue = isString ? `"${value}"` : value;

      const newContent = content.replace(regex, `$1${newValue}$3`);

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
       set({ isLoading: false, loadError: error instanceof Error ? error.message : 'Failed to update constant' });
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
    const { dialogIndex, parsedFiles, allDialogFiles } = get();

    // 1. Identify NPC-specific files
    const dialogMetadata = dialogIndex.get(npcId) || [];
    const npcFilePaths = new Set(dialogMetadata.map(m => m.filePath));

    // 2. Identify "Global" files (non-dialog files)
    // We consider any file that is NOT associated with ANY NPC in the index as a global file.
    // (e.g. Constants.d, Story_Globals.d, LOG_Entries.d)
    const allFilesWithDialogs = new Set<string>();
    for (const metadataList of dialogIndex.values()) {
        for (const meta of metadataList) {
            allFilesWithDialogs.add(meta.filePath);
        }
    }

    const globalFiles = allDialogFiles.filter(f => !allFilesWithDialogs.has(f));

    // 3. Merge Global + NPC files
    const filesToMerge = new Set([...globalFiles, ...npcFilePaths]);

    // 4. Get models (only if parsed)
    const semanticModels = Array.from(filesToMerge)
      .map(filePath => parsedFiles.get(filePath)?.semanticModel)
      .filter((model): model is SemanticModel => model !== undefined);

    // 5. Merge
    get().mergeSemanticModels(semanticModels);
  },

  clearMergedModel: () => {
    set({
      mergedSemanticModel: createEmptySemanticModel()
    });
  },

  clearCache: () => {
    set({ parsedFiles: new Map() });
  },

  updateFileModel: (filePath: string, model: SemanticModel) => {
    const { parsedFiles } = get();
    
    if (!(parsedFiles instanceof Map)) return;

    const newCache = new Map(parsedFiles);
    newCache.set(filePath, {
      filePath,
      semanticModel: model,
      lastParsed: new Date()
    });
    
    set({ parsedFiles: newCache });
  },

  addDialogToIndex: (metadata: DialogMetadata) => {
    set((state) => {
      const nextDialogIndex = new Map(state.dialogIndex);
      const existing = nextDialogIndex.get(metadata.npc) || [];

      const alreadyPresent = existing.some((entry) => entry.dialogName === metadata.dialogName);
      if (!alreadyPresent) {
        nextDialogIndex.set(metadata.npc, [...existing, metadata]);
      }

      const nextNpcList = state.npcList.includes(metadata.npc)
        ? state.npcList
        : [...state.npcList, metadata.npc].sort((a, b) => a.localeCompare(b));

      const nextAllDialogFiles = state.allDialogFiles.includes(metadata.filePath)
        ? state.allDialogFiles
        : [...state.allDialogFiles, metadata.filePath];

      return {
        dialogIndex: nextDialogIndex,
        npcList: nextNpcList,
        allDialogFiles: nextAllDialogFiles
      };
    });
  },

  setIngestedFilesOpen: (open: boolean) => {
    set({ isIngestedFilesOpen: open });
  }
}));
