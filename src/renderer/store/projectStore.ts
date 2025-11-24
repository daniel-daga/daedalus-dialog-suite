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
import type { DialogMetadata, ProjectIndex } from '../types/global';

interface ParsedFileCache {
  filePath: string;
  semanticModel: any;
  lastParsed: Date;
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
  mergedSemanticModel: any;

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
  getSemanticModel: (filePath: string) => Promise<any>;

  // Merge multiple semantic models into one
  mergeSemanticModels: (models: any[]) => void;

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
  mergedSemanticModel: {
    dialogs: {},
    functions: {},
    constants: {},
    instances: {},
    hasErrors: false,
    errors: []
  },
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

      console.log(`Project loaded: ${projectName}`);
      console.log(`Found ${rawIndex.npcs?.length || 0} NPCs`);
      console.log(`Found ${rawIndex.allFiles?.length || 0} .d files`);
    } catch (error) {
      console.error('Error loading project:', error);
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
      mergedSemanticModel: {
        dialogs: {},
        functions: {},
        constants: {},
        instances: {},
        hasErrors: false,
        errors: []
      },
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
      console.log(`Using cached semantic model for ${filePath}`);
      return cached.semanticModel;
    }

    // Parse file via IPC
    console.log(`Parsing file: ${filePath}`);
    const semanticModel = await window.editorAPI.parseDialogFile(filePath);
    console.log(`[projectStore] Parsed model has ${Object.keys(semanticModel?.dialogs || {}).length} dialogs, ${Object.keys(semanticModel?.functions || {}).length} functions`);

    // Cache the result
    const newCache = new Map(parsedFiles);
    newCache.set(filePath, {
      filePath,
      semanticModel,
      lastParsed: new Date()
    });

    set({ parsedFiles: newCache });

    return semanticModel;
  },

  mergeSemanticModels: (models: any[]) => {
    const mergedModel = {
      dialogs: {},
      functions: {},
      constants: {},
      instances: {},
      hasErrors: false,
      errors: []
    };

    const modelsWithErrors = models.filter(model => model?.hasErrors);
    if (modelsWithErrors.length > 0) {
      mergedModel.hasErrors = true;
      mergedModel.errors = modelsWithErrors.flatMap(model => model.errors || []);
    }

    // Merge all models, skipping those with errors
    models.forEach(model => {
      // Skip models with errors to avoid corrupting the merged model
      if (model?.hasErrors) {
        console.warn('[projectStore] Skipping model with errors during merge');
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

    console.log(`[projectStore] Merged ${models.length} models: ${Object.keys(mergedModel.dialogs).length} dialogs, ${Object.keys(mergedModel.functions).length} functions`);

    set({ mergedSemanticModel: mergedModel });
  },

  loadAndMergeNpcModels: (npcId: string) => {
    const { dialogIndex, parsedFiles } = get();

    // Get dialog metadata for this NPC
    const dialogMetadata = dialogIndex.get(npcId) || [];

    // Extract unique file paths
    const uniqueFilePaths = [...new Set(dialogMetadata.map(m => m.filePath))];

    console.log(`[projectStore] Loading models for NPC ${npcId} from ${uniqueFilePaths.length} files`);

    // Get semantic models from cache
    const semanticModels = uniqueFilePaths
      .map(filePath => parsedFiles.get(filePath)?.semanticModel)
      .filter(model => model !== undefined);

    console.log(`[projectStore] Found ${semanticModels.length} cached models`);

    // Merge the models
    get().mergeSemanticModels(semanticModels);
  },

  clearMergedModel: () => {
    set({
      mergedSemanticModel: {
        dialogs: {},
        functions: {},
        constants: {},
        instances: {},
        hasErrors: false,
        errors: []
      }
    });
  },

  clearCache: () => {
    set({ parsedFiles: new Map() });
    console.log('Cleared parsed files cache');
  }
}));
