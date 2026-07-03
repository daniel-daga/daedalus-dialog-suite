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
import { getQuestUsage } from '../utils/questAnalyzer';
import { deserialiseIpcMap } from '../utils/ipcSerialisation';
import { escapeRegExp } from '../utils/pathAndIdentifierUtils';
import {
  buildCloseTopicLine,
  buildTopicDeclarationBlock,
  insertIntoCloseTopicsFunction,
  topicBaseName
} from '../utils/questLogFiles';

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
    npcs: {},
    animations: {},
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
  routineList: string[];
  dialogIndex: Map<string, DialogMetadata[]>; // NPC ID → dialogs
  allDialogFiles: string[];
  questFiles: string[];
  // Prototype names (normalized uppercase) whose parent chain reaches C_NPC
  npcPrototypes: string[];
  // Files whose metadata extraction failed during the index build (degraded but openable)
  metadataFailures: Array<{ filePath: string; error: string }>;

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

  // Register a Create Topic quest in the external log files (issue #114)
  registerTopicInLogFiles: (options: {
    topicName: string;
    title: string;
    chapterStart: number;
    chapterEnd: number;
    constantsFilePath: string;
    closeTopicsFilePath: string;
  }) => Promise<void>;

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

  // Register a newly created project file path
  addProjectFile: (filePath: string) => void;

  // UI actions
  setIngestedFilesOpen: (open: boolean) => void;
}

type ProjectStore = ProjectState & ProjectActions;

export const useProjectStore = create<ProjectStore>((set, get) => {
  /** Remove a single file from the parsed-files cache. */
  const invalidateCacheForFile = (filePath: string) => {
    set((state) => {
      const newCache = new Map(state.parsedFiles);
      newCache.delete(filePath);
      return { parsedFiles: newCache };
    });
  };

  /**
   * Read a quest file, apply a transformation, write it back, invalidate the
   * cache, and return the freshly-parsed semantic model.  Centralises the
   * read → modify → write → invalidate → re-parse sequence shared by
   * createQuest, addVariable, updateGlobalConstant, and deleteVariable.
   */
  const mutateQuestFile = async (
    filePath: string,
    mutatorFn: (currentContent: string) => Promise<string> | string
  ): Promise<SemanticModel> => {
    const content = await window.editorAPI.readFile(filePath);
    const newContent = await mutatorFn(content);
    // The main process arms file-watcher self-write suppression after the
    // actual write succeeds.
    await window.editorAPI.writeFile(filePath, newContent);
    invalidateCacheForFile(filePath);
    return get().getSemanticModel(filePath);
  };

  /**
   * Fold freshly-parsed quest file models into the merged model. Constants
   * and variables previously contributed by these files are dropped first so
   * that deletions are reflected (merging is otherwise purely additive).
   */
  const mergeUpdatedQuestFileModels = (
    updates: Array<{ filePath: string; model: SemanticModel }>
  ) => {
    const merged = get().mergedSemanticModel;
    const updatedPaths = new Set(updates.map((u) => u.filePath));
    const dropFromUpdatedFiles = <T extends { filePath?: string }>(
      entries: { [name: string]: T } | undefined
    ): { [name: string]: T } => Object.fromEntries(
      Object.entries(entries || {}).filter(
        ([, entry]) => !entry.filePath || !updatedPaths.has(entry.filePath)
      )
    );

    const base: SemanticModel = {
      ...merged,
      constants: dropFromUpdatedFiles(merged.constants),
      variables: dropFromUpdatedFiles(merged.variables),
    };
    get().mergeSemanticModels([base, ...updates.map((u) => u.model)]);
  };

  return {
  // Initial state
  projectPath: null,
  projectName: null,
  npcList: [],
  routineList: [],
  dialogIndex: new Map(),
  allDialogFiles: [],
  questFiles: [],
  npcPrototypes: [],
  metadataFailures: [],
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
      const dialogsByNpc = deserialiseIpcMap<string, DialogMetadata[]>(rawIndex.dialogsByNpc);

      // Extract project name from path
      const pathParts = folderPath.split(/[\\/]/);
      const projectName = pathParts[pathParts.length - 1];

      // Add to recent projects
      await window.editorAPI.addRecentProject(folderPath, projectName);

      set({
        projectPath: folderPath,
        projectName,
        npcList: rawIndex.npcs || [],
        routineList: rawIndex.routines || [],
        dialogIndex: dialogsByNpc,
        allDialogFiles: rawIndex.allFiles || [],
        questFiles: rawIndex.questFiles || [],
        npcPrototypes: rawIndex.npcPrototypes || [],
        metadataFailures: rawIndex.metadataFailures || [],
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
    
    // 500 ms: coarse batch window — avoids per-file state updates during bulk ingestion
    // while still providing progressive loading feedback in the UI
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
      routineList: [],
      dialogIndex: new Map(),
      allDialogFiles: [],
      npcPrototypes: [],
      metadataFailures: [],
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
        Object.assign(mergedModel.constants!, model.constants);
      }
      if (model?.variables) {
        Object.assign(mergedModel.variables!, model.variables);
      }
      if (model?.instances) {
        Object.assign(mergedModel.instances!, model.instances);
      }
      if (model?.items) {
        Object.assign(mergedModel.items!, model.items);
      }
      if (model?.npcs) {
        Object.assign(mergedModel.npcs!, model.npcs);
      }
      if (model?.animations) {
        Object.assign(mergedModel.animations!, model.animations);
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

  getQuestUsage: (questName: string) => getQuestUsage(get().parsedFiles, questName),

  createQuest: async (title: string, internalName: string, topicFilePath: string, variableFilePath: string) => {

    try {
      set({ isLoading: true });

      const hasVariable = !!variableFilePath;

      if (hasVariable && topicFilePath === variableFilePath) {
        // Both declarations go into the same file
        const questBlock = `\n// Quest: ${title}\nconst string TOPIC_${internalName} = "${title}";\nvar int MIS_${internalName};\n`;
        const combinedModel = await mutateQuestFile(topicFilePath, (c) => {
          if (!c.endsWith('\n')) c += '\n';
          return c + questBlock;
        });
        mergeUpdatedQuestFileModels([{ filePath: topicFilePath, model: combinedModel }]);
      } else {
        const constLine = `\nconst string TOPIC_${internalName} = "${title}";\n`;
        const topicModel = await mutateQuestFile(topicFilePath, (c) => {
          if (!c.endsWith('\n')) c += '\n';
          return c + constLine;
        });
        const updates = [{ filePath: topicFilePath, model: topicModel }];

        if (hasVariable) {
          const varLine = `\nvar int MIS_${internalName};\n`;
          const variableModel = await mutateQuestFile(variableFilePath, (c) => {
            if (!c.endsWith('\n')) c += '\n';
            return c + varLine;
          });
          updates.push({ filePath: variableFilePath, model: variableModel });
        }

        mergeUpdatedQuestFileModels(updates);
      }

      set({ isLoading: false });

    } catch (error) {
      set({ isLoading: false, loadError: error instanceof Error ? error.message : 'Failed to create quest' });
      throw error; // Re-throw so UI can handle it
    }
  },

  registerTopicInLogFiles: async (options) => {
    const { topicName, title, chapterStart, chapterEnd, constantsFilePath, closeTopicsFilePath } = options;
    const base = topicBaseName(topicName);

    try {
      set({ isLoading: true });

      const closeTopicLine = buildCloseTopicLine(topicName, chapterStart, chapterEnd);

      // Validate the close-topics insert before any write: a bad target
      // (wrong path, no B_CloseTopics function) must not leave the quest
      // half-registered with only the declarations appended — the duplicate
      // guard below would then block every retry.
      insertIntoCloseTopicsFunction(
        await window.editorAPI.readFile(closeTopicsFilePath),
        closeTopicLine
      );

      const constantsModel = await mutateQuestFile(constantsFilePath, (c) => {
        // Guard against duplicate declarations before writing; anchored on
        // the declaration itself so commented-out lines or mere usages of
        // the constant don't count.
        if (new RegExp(`^\\s*const\\s+string\\s+TOPIC_${escapeRegExp(base)}\\b`, 'im').test(c)) {
          throw new Error(`TOPIC_${base} is already declared in ${constantsFilePath}`);
        }
        if (!c.endsWith('\n')) c += '\n';
        return c + buildTopicDeclarationBlock(topicName, title);
      });
      const closeTopicsModel = await mutateQuestFile(closeTopicsFilePath, (c) =>
        insertIntoCloseTopicsFunction(c, closeTopicLine)
      );

      mergeUpdatedQuestFileModels([
        { filePath: constantsFilePath, model: constantsModel },
        { filePath: closeTopicsFilePath, model: closeTopicsModel }
      ]);

      set({ isLoading: false });
    } catch (error) {
      set({ isLoading: false, loadError: error instanceof Error ? error.message : 'Failed to register topic' });
      throw error;
    }
  },

  addVariable: async (name: string, type: string, value: string | number | boolean | undefined, filePath: string, isConstant: boolean) => {

    try {
      set({ isLoading: true });

      let varLine: string;
      if (isConstant) {
        let valueStr = String(value);
        if (type === 'string') valueStr = `"${value}"`;
        varLine = `\nconst ${type} ${name} = ${valueStr};\n`;
      } else {
        varLine = `\nvar ${type} ${name};\n`;
      }

      const updatedModel = await mutateQuestFile(filePath, (c) => {
        if (!c.endsWith('\n')) c += '\n';
        return c + varLine;
      });

      mergeUpdatedQuestFileModels([{ filePath, model: updatedModel }]);
      set({ isLoading: false });

    } catch (error) {
       set({ isLoading: false, loadError: error instanceof Error ? error.message : 'Failed to add variable' });
       throw error;
    }
  },

  updateGlobalConstant: async (name: string, value: string, filePath: string) => {

    try {
      set({ isLoading: true });

      // Check type from existing constant to decide on quotes
      const constant = get().mergedSemanticModel.constants?.[name];
      const isString = constant?.type?.toLowerCase() === 'string';
      const newValue = isString ? `"${value}"` : value;

      // Matches: const <type> <name> = <value>;
      // Quoted string values are matched as a whole so semicolons inside them
      // don't terminate the value early.
      const regex = new RegExp(`(const\\s+\\w+\\s+${name}\\s*=\\s*)("[^"]*"|[^;]+)(;)`);

      const updatedModel = await mutateQuestFile(filePath, (content) => {
        const match = content.match(regex);
        if (!match) {
          throw new Error(`Could not find constant definition for ${name} in ${filePath}`);
        }
        return content.replace(regex, `$1${newValue}$3`);
      });

      mergeUpdatedQuestFileModels([{ filePath, model: updatedModel }]);
      set({ isLoading: false });

    } catch (error) {
       set({ isLoading: false, loadError: error instanceof Error ? error.message : 'Failed to update constant' });
       throw error;
    }
  },

  deleteVariable: async (filePath: string, range: { startIndex: number, endIndex: number }) => {

    try {
      set({ isLoading: true });

      const updatedModel = await mutateQuestFile(filePath, (content) => {
        // Also consume a following newline to avoid leaving a blank line
        let end = range.endIndex;
        if (content[end] === '\n') end++;
        else if (content[end] === '\r' && content[end + 1] === '\n') end += 2;
        return content.slice(0, range.startIndex) + content.slice(end);
      });

      mergeUpdatedQuestFileModels([{ filePath, model: updatedModel }]);
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
    const { parsedFiles, dialogIndex } = get();

    if (!(parsedFiles instanceof Map)) return;

    const newCache = new Map(parsedFiles);
    newCache.set(filePath, {
      filePath,
      semanticModel: model,
      lastParsed: new Date()
    });

    // The dialog index only depends on each dialog's name + owning NPC. Action
    // and condition edits (the common keystroke case) leave that set unchanged,
    // so rebuilding the whole index every edit is pure O(project) waste. Only
    // rebuild when the file's (dialogName, npc) set actually changed.
    const nextFileEntries = Object.entries(model.dialogs || {}).map(([dialogName, dialog]) => ({
      dialogName,
      npc: (dialog.properties?.npc as string) || 'Unknown NPC',
      filePath
    }));
    const prevFileEntries: Array<{ dialogName: string; npc: string }> = [];
    for (const dialogs of dialogIndex.values()) {
      for (const d of dialogs) {
        if (d.filePath === filePath) prevFileEntries.push({ dialogName: d.dialogName, npc: d.npc });
      }
    }
    const entryKey = (e: { dialogName: string; npc: string }) => `${e.npc} ${e.dialogName}`;
    const prevKeys = new Set(prevFileEntries.map(entryKey));
    const nextKeys = new Set(nextFileEntries.map(entryKey));
    const dialogSetChanged =
      prevKeys.size !== nextKeys.size || [...nextKeys].some((k) => !prevKeys.has(k));

    let newDialogIndex = dialogIndex;
    if (dialogSetChanged) {
      newDialogIndex = new Map(dialogIndex);
      for (const [npc, dialogs] of newDialogIndex.entries()) {
        const filtered = dialogs.filter(d => d.filePath !== filePath);
        if (filtered.length !== dialogs.length) {
          if (filtered.length === 0) newDialogIndex.delete(npc);
          else newDialogIndex.set(npc, filtered);
        }
      }
      for (const entry of nextFileEntries) {
        const existing = newDialogIndex.get(entry.npc) || [];
        newDialogIndex.set(entry.npc, [...existing, entry]);
      }
    }

    set(dialogSetChanged
      ? { parsedFiles: newCache, dialogIndex: newDialogIndex }
      : { parsedFiles: newCache });

    // Re-merge the semantic model for the currently selected NPC so that
    // description changes, renames, and deletes are reflected immediately.
    // Skip the (full) re-merge when the changed file does not participate in
    // the selected NPC's merged model — i.e. it is neither one of that NPC's
    // dialog files nor a global (dialog-less) file. This avoids rebuilding the
    // merged model on background file-watcher updates to unrelated NPC files.
    const { selectedNpc } = get();
    if (selectedNpc) {
      const selectedNpcFiles = new Set(
        (newDialogIndex.get(selectedNpc) || []).map(d => d.filePath)
      );
      const filesWithDialogs = new Set<string>();
      for (const dialogs of newDialogIndex.values()) {
        for (const d of dialogs) filesWithDialogs.add(d.filePath);
      }
      const isGlobalFile = !filesWithDialogs.has(filePath);
      if (selectedNpcFiles.has(filePath) || isGlobalFile) {
        get().loadAndMergeNpcModels(selectedNpc);
      }
    }
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

  addProjectFile: (filePath: string) => {
    set((state) => {
      if (state.allDialogFiles.includes(filePath)) {
        return state;
      }

      return {
        allDialogFiles: [...state.allDialogFiles, filePath]
      };
    });
  },

  setIngestedFilesOpen: (open: boolean) => {
    set({ isIngestedFilesOpen: open });
  }
  }; // end return
});
