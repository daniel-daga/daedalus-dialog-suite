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
      if (model?.instances) {
        Object.assign(mergedModel.instances, model.instances);
      }
    });

    set({ mergedSemanticModel: mergedModel });
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
