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

interface ParsedFileCache {
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

  // Merge multiple semantic models into one
  mergeSemanticModels: (models: SemanticModel[]) => void;

  // Load and merge semantic models for a specific NPC
  loadAndMergeNpcModels: (npcId: string) => void;

  // Load and merge quest data (global constants/vars)
  loadQuestData: () => Promise<void>;

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
