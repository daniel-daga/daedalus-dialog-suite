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

  clearCache: () => {
    set({ parsedFiles: new Map() });
    console.log('Cleared parsed files cache');
  }
}));
