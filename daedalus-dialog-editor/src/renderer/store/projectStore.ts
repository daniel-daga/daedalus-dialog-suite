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
import type { DialogMetadata, SemanticModel } from '../types/global';

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

  // Create a new quest
  createQuest: (title: string, internalName: string, topicFilePath: string, variableFilePath: string) => Promise<void>;

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
  parsedFiles: new Map(),
  mergedSemanticModel: createEmptySemanticModel(),
  selectedNpc: null,
  isLoading: false,
  loadError: null,
  isIngesting: false,
  abortIngestion: null,

  // Actions
  openProject: async (folderPath: string) => {
    set({ isLoading: true, loadError: null });

    try {
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
    const { allDialogFiles, questFiles, getSemanticModel, abortIngestion } = get();
    
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

    // Process in background
    try {
      // We use a small concurrency limit to not block the IPC/Worker too much
      // Since getSemanticModel awaits the IPC call, we can just loop
      // But we want to check the abort signal
      
      for (const filePath of ingestionQueue) {
        if (controller.signal.aborted) break;

        // Skip if already parsed
        if (get().parsedFiles.has(filePath)) continue;

        try {
          // Parse the file
          await getSemanticModel(filePath);
          
          // Small delay to yield to UI/other tasks
          await new Promise(resolve => setTimeout(resolve, 5));
        } catch (e) {
          console.warn(`Background ingestion failed for ${filePath}:`, e);
          
          // Mark as parsed with error so it doesn't stay "Pending"
          set((state) => {
             const newCache = new Map(state.parsedFiles);
             newCache.set(filePath, {
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
             return { parsedFiles: newCache };
          });
        }
      }
    } finally {
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
    });

    set({ mergedSemanticModel: mergedModel });
  },

  loadQuestData: async () => {
    const { questFiles, getSemanticModel, mergeSemanticModels, mergedSemanticModel } = get();

    // Parse all quest files
    const models = await Promise.all(
        questFiles.map(filePath => getSemanticModel(filePath))
    );

    // If we already have a merged model, we should merge into it, not replace it
    // But mergeSemanticModels replaces it.
    // So we should take the current merged model and merge the new ones into it?
    // Actually, mergeSemanticModels takes an array of models and creates a NEW merged model.
    // So if we only pass quest models, we lose the previously loaded NPC models.

    // Better approach: Since `mergedSemanticModel` is currently "current NPC view",
    // maybe we should just append the quest data to it?
    // OR, we assume that when looking at Quests, we want a global view.

    // If we are in Quest Mode, we might want to load EVERYTHING related to quests.
    // That includes quest definitions (LOG_Constants) AND functions that use them (which might be in dialog files).
    // This is tricky. Dialog files are loaded by NPC selection.

    // Ideally, for the Quest Editor, we want a "Global Project Model" which is distinct from "Current NPC Model".
    // But for now, let's just merge quest files into the current merged model.
    // However, if we switch NPCs, `loadAndMergeNpcModels` will be called and overwrite `mergedSemanticModel`.
    // So we need to ensure quest data persists or is re-merged.

    // Since `mergedSemanticModel` is transient based on selection, maybe we should keep `questModels` separate?
    // For simplicity, let's merge into `mergedSemanticModel` but we need to be careful about overwriting.

    // A simple hack: Pass current merged model as one of the models to merge?
    // No, `mergedSemanticModel` is a result, not a source with source file tracking.

    // Let's rely on `loadAndMergeNpcModels` to be called when NPC is selected.
    // When Quest View is active, we might not have an NPC selected.
    // If we just want to show the list of quests, we need quest files parsed.

    // Let's update mergeSemanticModels to NOT clear everything if we don't want to?
    // No, `mergeSemanticModels` creates a fresh object.

    // For now, let's just load the quest files and merge them.
    // If the user selects an NPC later, it will overwrite.
    // This implies Quest Editor should probably trigger this load every time it's focused,
    // OR we should maintain a `globalQuestModel` in the store.

    // But let's stick to the plan: merge into mergedSemanticModel.
    // If an NPC is selected, we might lose this data unless we also merge it there.
    // We can modify `loadAndMergeNpcModels` to also include quest files?
    // That seems safer.

    // But `loadQuestData` is explicit.
    // Let's make `loadQuestData` merge quest files with whatever is currently in `mergedSemanticModel`?
    // The `mergeSemanticModels` function takes `SemanticModel[]`.
    // We can't easily decompose `mergedSemanticModel` back to its sources.

    // Re-architecture choice:
    // 1. Always load quest files when loading NPC models.
    // 2. OR `mergedSemanticModel` accumulates.

    // Let's go with 1. It ensures consistency.
    // But `loadAndMergeNpcModels` is for *Npc*.

    // Let's make `loadQuestData` explicit. When called, it merges quest files.
    // But what about the existing data?
    // We can merge [currentMergedModel, ...questModels].

    // Check `mergeSemanticModels` implementation again.
    // It creates a NEW empty model and merges into it.
    // So passing `mergedSemanticModel` as one of the inputs works!

    const currentModel = get().mergedSemanticModel;
    mergeSemanticModels([currentModel, ...models]);
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
      // Note: This assumes adding new symbols doesn't conflict with existing ones in a way that requires full re-merge
      get().mergeSemanticModels([get().mergedSemanticModel, topicModel, variableModel]);

      set({ isLoading: false });

    } catch (error) {
      set({ isLoading: false, loadError: error instanceof Error ? error.message : 'Failed to create quest' });
      throw error; // Re-throw so UI can handle it
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
