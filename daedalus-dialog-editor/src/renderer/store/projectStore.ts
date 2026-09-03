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
import type { RoutineSite, SpawnSite } from '../../shared/types';
import type { GothicProjectFileV1, ProjectConfigWarning } from '../../shared/projectConfigTypes';
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
  scriptsRoot: string | null;
  projectName: string | null;
  projectFilePath: string | null;
  projectConfig: GothicProjectFileV1 | null;
  resolvedAssetSources: string[];
  /** The project's resolved GMBT project folder, or null when none is
   *  configured or it does not resolve — what enables the World bar's quick
   *  test (level-editor.md §16.29). */
  gmbtProjectDir: string | null;
  /** Asset folders the detected GMBT project declares that the list does not
   *  have yet — the Asset sources dialog's one-click add (§16.31). */
  gmbtAssetSources: string[];
  /** The machine's Gothic installation, mounted under every project (§9). */
  gothicInstallPath: string | null;
  projectWarnings: ProjectConfigWarning[];

  // Project index (lightweight)
  npcList: string[];
  routineList: string[];
  dialogIndex: Map<string, DialogMetadata[]>; // NPC ID → dialogs
  allDialogFiles: string[];
  questFiles: string[];
  // Prototype names (normalized uppercase) whose parent chain reaches C_NPC
  npcPrototypes: string[];
  // AI_Output voice ids across the project, keyed by UPPERCASED id (built at
  // project load/reindex time — can be stale until the next reindex)
  voiceIdIndex: Record<string, Array<{ filePath: string; functionName: string }>>;
  // Waypoint name literals across the project, keyed by UPPERCASED name (built
  // at project load/reindex time, same lifecycle as voiceIdIndex)
  waypointSiteIndex: Record<string, Array<{ filePath: string; functionName: string }>>;
  // Static NPC/item spawn sites across the project, same lifecycle as
  // waypointSiteIndex; dynamic sites are excluded rather than guessed
  spawnSiteIndex: SpawnSite[];
  // Every TA-family routine entry across the project, keyed by routine function
  // rather than by NPC, with routineNpcIndex carrying which NPC runs which.
  // Same lifecycle as spawnSiteIndex.
  routineSiteIndex: RoutineSite[];
  routineNpcIndex: Record<string, string>;
  // The routine variants quest state swaps in, keyed by UPPERCASED NPC. Read by
  // the World surface's State lens; same lifecycle as routineSiteIndex.
  routineStateIndex: Record<string, { id: number; states: Record<string, string> }>;
  // Files whose metadata extraction failed during the index build (degraded but openable)
  metadataFailures: Array<{ filePath: string; error: string }>;

  // Cached parsed files (full semantic models)
  parsedFiles: Map<string, ParsedFileCache>;

  // Monotonic counter bumped whenever `parsedFiles` is replaced. Consumers that
  // only need a coarse "the parsed models changed" signal can subscribe to this
  // instead of the map identity (which churns per file during ingestion).
  parseGeneration: number;

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
  /** Writes the Asset sources dialog: the ordered list, and the GMBT project
   *  folder beside it (null clears it, omitted leaves it). */
  saveAssetSources: (assetSources: string[], gmbtProjectDir?: string | null) => Promise<void>;
  /** Choose or clear the machine's Gothic installation (§9). Main re-resolves
   *  the active project against it and this adopts what comes back. */
  changeGothicInstall: (choose: boolean) => Promise<void>;
  dismissProjectWarning: (resolvedPath: string) => void;

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

  // Batch variant: apply many file models with a single parsedFiles clone,
  // dialogIndex scan, parseGeneration bump, and (conditional) re-merge
  updateFileModels: (updates: Array<{ filePath: string; model: SemanticModel }>) => void;

  // Register a newly created dialog in the project index
  addDialogToIndex: (metadata: DialogMetadata) => void;
  // A spawn the World surface just wrote (level-editor.md §16.19, slice 16 E):
  // the index is built at project load and never refreshed by a file update.
  addSpawnSite: (site: SpawnSite) => void;

  // Register a newly created project file path
  addProjectFile: (filePath: string) => void;

  // UI actions
  setIngestedFilesOpen: (open: boolean) => void;
}

type ProjectStore = ProjectState & ProjectActions;

// Categories merged by mergeSemanticModels (mirrors the historical set — does
// not include classes/prototypes/declarationOrder/trailingComments).
const MERGE_CATEGORY_KEYS = [
  'dialogs',
  'functions',
  'constants',
  'variables',
  'instances',
  'items',
  'npcs',
  'animations'
] as const;

type MergeCategoryKey = typeof MERGE_CATEGORY_KEYS[number];
type CategoryMap = Record<string, unknown>;

// Upper bound on cached parsed models (P0: parsedFiles previously grew without
// bound — only closeProject ever shrank it). Merged-model contributors are
// pinned (global dialog-less files, the selected NPC's files, quest files);
// everything else is evicted least-recently-touched first. Evicted files
// self-heal: NPC selection re-parses its files via getSemanticModel before
// merging. On projects larger than the cap, whole-corpus consumers (Problems
// panel, quest usage) see at most this many files.
export const PARSED_FILES_CAP = 512;

export const useProjectStore = create<ProjectStore>((set, get) => {
  // In-flight parse dedup: concurrent getSemanticModel calls for the same path
  // share one IPC parse. Entries settle-remove themselves and are dropped by
  // invalidateCacheForFile/clearCache/closeProject so a stale parse is never
  // handed to a post-mutation caller.
  const inFlight = new Map<string, Promise<SemanticModel>>();
  // Changes whenever the active project session is replaced. Async descriptor
  // writes use this token so a late response cannot resurrect a closed or
  // superseded project.
  let projectSession = 0;

  // Staleness stamps for the cache write at the end of getSemanticModel (2026-07
  // finding 4.1). The write happens after an await, so between the parse
  // starting and it resolving the entry may have been invalidated, the project
  // closed, or the editor's own (possibly unsaved) model pushed in by
  // storeSync. Any of those makes the parse's result older than what the cache
  // now holds, so it must be dropped rather than written back. The caller still
  // gets the model it asked for — only the shared cache is protected.
  let stampCounter = 0;
  const fileStamps = new Map<string, number>();
  let allFilesStamp = 0;
  const stampOf = (filePath: string) => Math.max(fileStamps.get(filePath) ?? 0, allFilesStamp);
  const stampFile = (filePath: string) => { fileStamps.set(filePath, ++stampCounter); };
  const stampAllFiles = () => { allFilesStamp = ++stampCounter; fileStamps.clear(); };

  // Category-stable merge cache. For each category we remember the ordered list
  // of input map references from the last merge plus the merged object we
  // produced. An unchanged signature (same length + all refs ===) means the
  // inputs are identical, so the previous merged category object is reused
  // verbatim — this is what keeps per-category selectors from recomputing on
  // unrelated edits. MUST be reset on closeProject/clearCache (see
  // resetMergeCache) or a reopened project could reuse stale category objects.
  let mergeCache: Partial<Record<MergeCategoryKey, { signature: CategoryMap[]; merged: CategoryMap }>> = {};
  const resetMergeCache = () => {
    mergeCache = {};
  };

  // N2: the set of files that contribute dialogs is O(project) to build (it
  // iterates the whole dialogIndex). It only changes when dialogIndex is
  // replaced, so memoize it per dialogIndex identity; the cheap per-call filter
  // against allDialogFiles stays live so newly-added global files still count.
  const filesWithDialogsCache = new WeakMap<Map<string, DialogMetadata[]>, Set<string>>();
  const getFilesWithDialogs = (dialogIndex: Map<string, DialogMetadata[]>): Set<string> => {
    const cached = filesWithDialogsCache.get(dialogIndex);
    if (cached) return cached;
    const filesWithDialogs = new Set<string>();
    for (const metadataList of dialogIndex.values()) {
      for (const meta of metadataList) filesWithDialogs.add(meta.filePath);
    }
    filesWithDialogsCache.set(dialogIndex, filesWithDialogs);
    return filesWithDialogs;
  };

  // Recency bookkeeping for the PARSED_FILES_CAP eviction. Kept outside the
  // store so read-touches (getSemanticModel cache hits) do not churn state.
  let parsedFileRecencyTick = 0;
  const parsedFileRecency = new Map<string, number>();
  const touchParsedFile = (filePath: string) => {
    parsedFileRecency.set(filePath, ++parsedFileRecencyTick);
  };
  const resetParsedFileRecency = () => {
    parsedFileRecency.clear();
  };

  /**
   * Evict least-recently-touched unpinned entries from `cache` (mutating it)
   * until it fits PARSED_FILES_CAP. Pinned: quest files, global (dialog-less)
   * project files, and the selected NPC's dialog files — the merged-model
   * contributors that loadAndMergeNpcModels/loadQuestData read from the cache.
   */
  const enforceParsedFilesCap = (
    cache: Map<string, ParsedFileCache>,
    state: Pick<ProjectState, 'allDialogFiles' | 'questFiles' | 'selectedNpc'>,
    dialogIndex: Map<string, DialogMetadata[]>
  ): Map<string, ParsedFileCache> => {
    if (cache.size <= PARSED_FILES_CAP) return cache;
    const pinned = new Set<string>(state.questFiles);
    const filesWithDialogs = getFilesWithDialogs(dialogIndex);
    for (const filePath of state.allDialogFiles) {
      if (!filesWithDialogs.has(filePath)) pinned.add(filePath);
    }
    if (state.selectedNpc) {
      for (const meta of dialogIndex.get(state.selectedNpc) || []) pinned.add(meta.filePath);
    }
    const evictable = Array.from(cache.keys())
      .filter((filePath) => !pinned.has(filePath))
      .sort((a, b) => (parsedFileRecency.get(a) ?? 0) - (parsedFileRecency.get(b) ?? 0));
    for (const filePath of evictable) {
      if (cache.size <= PARSED_FILES_CAP) break;
      cache.delete(filePath);
      parsedFileRecency.delete(filePath);
    }
    return cache;
  };

  /** Remove a single file from the parsed-files cache. */
  const invalidateCacheForFile = (filePath: string) => {
    inFlight.delete(filePath);
    stampFile(filePath);
    parsedFileRecency.delete(filePath);
    set((state) => {
      const newCache = new Map(state.parsedFiles);
      newCache.delete(filePath);
      return { parsedFiles: newCache, parseGeneration: state.parseGeneration + 1 };
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
    // Never write content the parser cannot read. A malformed mutation (e.g. a
    // constant with an empty value → `const int X = ;`) would otherwise corrupt
    // the file on disk and blank the editor with a syntax error. Validate first
    // and surface the failure to the caller instead.
    const parsed = await window.editorAPI.parseSource(newContent);
    if (parsed.hasErrors) {
      const detail = parsed.errors?.[0]?.message;
      throw new Error(
        `This change would introduce a syntax error into ${filePath}${detail ? ` (${detail})` : ''}, so it was not saved.`
      );
    }
    // The main process arms file-watcher self-write suppression after the
    // actual write succeeds.
    await window.editorAPI.writeFile(filePath, newContent);
    invalidateCacheForFile(filePath);
    return get().getSemanticModel(filePath);
  };

  // The merged model carries an AGGREGATE hasErrors flag summarising its inputs.
  // When it is re-fed as a base into another merge it must be cleared first:
  // mergeSemanticModels drops any input flagged hasErrors, so leaving it set
  // would discard the entire (still valid) accumulated model — blanking the
  // view. The flag is re-derived from the real file models in the new merge.
  const withoutAggregateErrors = (model: SemanticModel): SemanticModel => ({
    ...model,
    hasErrors: false,
    errors: []
  });

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
      ...withoutAggregateErrors(merged),
      constants: dropFromUpdatedFiles(merged.constants),
      variables: dropFromUpdatedFiles(merged.variables),
    };
    get().mergeSemanticModels([base, ...updates.map((u) => u.model)]);
  };

  return {
  // Initial state
  projectPath: null,
  scriptsRoot: null,
  projectName: null,
  projectFilePath: null,
  projectConfig: null,
  resolvedAssetSources: [],
  gmbtProjectDir: null,
  gmbtAssetSources: [],
  gothicInstallPath: null,
  projectWarnings: [],
  npcList: [],
  routineList: [],
  dialogIndex: new Map(),
  allDialogFiles: [],
  questFiles: [],
  npcPrototypes: [],
  voiceIdIndex: {},
  waypointSiteIndex: {},
  spawnSiteIndex: [],
  routineSiteIndex: [],
  routineNpcIndex: {},
  routineStateIndex: {},
  metadataFailures: [],
  parsedFiles: new Map(),
  parseGeneration: 0,
  mergedSemanticModel: createEmptySemanticModel(),
  selectedNpc: null,
  isLoading: false,
  loadError: null,
  isIngesting: false,
  abortIngestion: null,
  isIngestedFilesOpen: false,

  // Actions
  openProject: async (folderPath: string) => {
    projectSession += 1;
    set({ isLoading: true, loadError: null });

    try {
      // Ensure the path is allowed in the backend (especially for recent projects)
      await window.editorAPI.addAllowedPath(folderPath);

      // Load (or migrate) the project descriptor before indexing. The
      // descriptor owns the normalized scripts root used by the indexer.
      const descriptor = await window.editorAPI.loadProjectConfig(folderPath);

      // Build project index via IPC
      const rawIndex = await window.editorAPI.buildProjectIndex(descriptor.scriptsRoot);

      // Convert the plain object back to Map (IPC serialization loses Map type)
      const dialogsByNpc = deserialiseIpcMap<string, DialogMetadata[]>(rawIndex.dialogsByNpc);

      // Extract project name from path
      const pathParts = descriptor.projectRoot.split(/[\\/]/);
      const projectName = pathParts[pathParts.length - 1];

      // Recent projects are persisted main-side inside project:openFolderDialog;
      // the renderer no longer whitelists or records recents (security item 1.1).

      resetParsedFileRecency();
      set({
        projectPath: descriptor.projectRoot,
        scriptsRoot: descriptor.scriptsRoot,
        projectName,
        projectFilePath: descriptor.projectFilePath,
        projectConfig: descriptor.config,
        resolvedAssetSources: descriptor.resolvedAssetSources,
        gmbtProjectDir: descriptor.gmbtProjectDir,
        gmbtAssetSources: descriptor.gmbtAssetSources,
        gothicInstallPath: descriptor.gothicInstallPath,
        projectWarnings: descriptor.warnings,
        npcList: rawIndex.npcs || [],
        routineList: rawIndex.routines || [],
        dialogIndex: dialogsByNpc,
        allDialogFiles: rawIndex.allFiles || [],
        questFiles: rawIndex.questFiles || [],
        npcPrototypes: rawIndex.npcPrototypes || [],
        voiceIdIndex: rawIndex.voiceIds || {},
        waypointSiteIndex: rawIndex.waypointSites || {},
        spawnSiteIndex: rawIndex.spawnSites || [],
        routineSiteIndex: rawIndex.routineSites || [],
        routineNpcIndex: rawIndex.routinesByNpc || {},
        routineStateIndex: rawIndex.routineStatesByNpc || {},
        metadataFailures: rawIndex.metadataFailures || [],
        isLoading: false,
        parsedFiles: new Map(), // Clear any previous cache
        parseGeneration: get().parseGeneration + 1,
        selectedNpc: null
      });

      // Start background ingestion
      get().startBackgroundIngestion();

    } catch (error) {
      set({
        isLoading: false,
        loadError: error instanceof Error ? error.message : 'Unknown error'
      });
      // Nothing renders `loadError`; the caller's catch is what shows the user
      // a message, so the failure has to leave this function (2026-07 2.1).
      throw error;
    }
  },

  saveAssetSources: async (assetSources: string[], gmbtProjectDir?: string | null) => {
    const projectFilePath = get().projectFilePath;
    const projectRoot = get().projectPath;
    const projectConfig = get().projectConfig;
    const sessionAtStart = projectSession;
    if (!projectFilePath) {
      throw new Error('No project is open');
    }

    try {
      const descriptor = await window.editorAPI.saveProjectAssetSources(
        projectFilePath, assetSources, gmbtProjectDir,
      );
      if (
        projectSession !== sessionAtStart ||
        get().projectFilePath !== projectFilePath ||
        get().projectPath !== projectRoot ||
        get().projectConfig !== projectConfig
      ) {
        return;
      }
      set({
        projectPath: descriptor.projectRoot,
        scriptsRoot: descriptor.scriptsRoot,
        projectFilePath: descriptor.projectFilePath,
        projectConfig: descriptor.config,
        resolvedAssetSources: descriptor.resolvedAssetSources,
        gmbtProjectDir: descriptor.gmbtProjectDir,
        gmbtAssetSources: descriptor.gmbtAssetSources,
        gothicInstallPath: descriptor.gothicInstallPath,
        projectWarnings: descriptor.warnings,
        loadError: null
      });
    } catch (error) {
      set({ loadError: error instanceof Error ? error.message : 'Failed to save asset sources' });
      throw error;
    }
  },

  changeGothicInstall: async (choose: boolean) => {
    const projectFilePath = get().projectFilePath;
    const sessionAtStart = projectSession;
    const descriptor = choose
      ? await window.editorAPI.selectGothicInstall()
      : await window.editorAPI.clearGothicInstall();
    // Null is a cancelled picker, or no project loaded — neither is a change.
    if (descriptor === null) return;
    if (projectSession !== sessionAtStart || get().projectFilePath !== projectFilePath) return;
    set({
      projectConfig: descriptor.config,
      resolvedAssetSources: descriptor.resolvedAssetSources,
      gmbtProjectDir: descriptor.gmbtProjectDir,
      gmbtAssetSources: descriptor.gmbtAssetSources,
      gothicInstallPath: descriptor.gothicInstallPath,
      projectWarnings: descriptor.warnings,
      loadError: null,
    });
  },

  dismissProjectWarning: (resolvedPath: string) => {
    set((state) => ({
      projectWarnings: state.projectWarnings.filter((warning) => warning.resolvedPath !== resolvedPath)
    }));
  },

  startBackgroundIngestion: async () => {
    const { allDialogFiles, questFiles, abortIngestion } = get();
    
    // Cancel previous ingestion if running
    if (abortIngestion) {
      abortIngestion();
    }

    const controller = new AbortController();
    // Capture the project this run belongs to. A late flush (interval or the
    // finally block) must never write into a successor project's cache.
    const ingestionProjectPath = get().projectPath;
    set({ isIngesting: true, abortIngestion: () => controller.abort() });

    // Prioritize quest files, then the rest
    const priorityFiles = new Set([...questFiles]);
    const remainingFiles = allDialogFiles.filter(f => !priorityFiles.has(f));
    const ingestionQueue = [...priorityFiles, ...remainingFiles];

    // Batch updates to avoid excessive re-renders
    const pendingUpdates = new Map<string, ParsedFileCache>();
    const flushUpdates = () => {
      // Discard the batch if this run was aborted or the project has since been
      // swapped out — stale entries must not bleed into the new project.
      if (controller.signal.aborted || get().projectPath !== ingestionProjectPath) {
        pendingUpdates.clear();
        return;
      }
      if (pendingUpdates.size > 0) {
        set((state) => {
          const newCache = new Map(state.parsedFiles);
          pendingUpdates.forEach((value, key) => {
            newCache.set(key, value);
            touchParsedFile(key);
          });
          enforceParsedFilesCap(newCache, state, state.dialogIndex);
          return { parsedFiles: newCache, parseGeneration: state.parseGeneration + 1 };
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

            // Bail if the run was aborted while the parse was in flight — the
            // result belongs to a project that is no longer current.
            if (controller.signal.aborted) return;

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
    projectSession += 1;
    // Abort any running ingestion
    const { abortIngestion } = get();
    if (abortIngestion) {
      abortIngestion();
    }

    inFlight.clear();
    stampAllFiles();
    resetMergeCache();
    resetParsedFileRecency();

    set({
      projectPath: null,
      scriptsRoot: null,
      projectName: null,
      projectFilePath: null,
      projectConfig: null,
      resolvedAssetSources: [],
  gmbtProjectDir: null,
  gmbtAssetSources: [],
  gothicInstallPath: null,
      projectWarnings: [],
      npcList: [],
      routineList: [],
      dialogIndex: new Map(),
      allDialogFiles: [],
      questFiles: [],
      npcPrototypes: [],
      voiceIdIndex: {},
      waypointSiteIndex: {},
      spawnSiteIndex: [],
      routineSiteIndex: [],
      routineNpcIndex: {},
      routineStateIndex: {},
      metadataFailures: [],
      parsedFiles: new Map(),
      parseGeneration: get().parseGeneration + 1,
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
      touchParsedFile(filePath);
      return cached.semanticModel;
    }

    // Coalesce concurrent callers onto a single in-flight parse.
    const existing = inFlight.get(filePath);
    if (existing) {
      return existing;
    }

    const stampAtStart = stampOf(filePath);
    const parsePromise = (async () => {
      // Parse file via IPC
      const semanticModel = await window.editorAPI.parseDialogFile(filePath);

      // Inject file path into constants and variables for tracking
      if (semanticModel.constants) {
        Object.values(semanticModel.constants).forEach(c => { c.filePath = filePath; });
      }
      if (semanticModel.variables) {
        Object.values(semanticModel.variables).forEach(v => { v.filePath = filePath; });
      }

      // Cache the result — unless this parse went stale while it was in flight
      // (invalidated, project closed, or superseded by the editor's own model).
      if (stampOf(filePath) !== stampAtStart) {
        return semanticModel;
      }

      set((state) => {
        const newCache = new Map(state.parsedFiles);
        newCache.set(filePath, {
          filePath,
          semanticModel,
          lastParsed: new Date()
        });
        touchParsedFile(filePath);
        enforceParsedFilesCap(newCache, state, state.dialogIndex);
        return { parsedFiles: newCache, parseGeneration: state.parseGeneration + 1 };
      });

      return semanticModel;
    })();

    inFlight.set(filePath, parsePromise);
    try {
      return await parsePromise;
    } finally {
      // Only clear our own entry: invalidation mid-flight may have already
      // dropped it and registered a newer parse we must not evict.
      if (inFlight.get(filePath) === parsePromise) {
        inFlight.delete(filePath);
      }
    }
  },

  mergeSemanticModels: (models: SemanticModel[]) => {
    const mergedModel: SemanticModel = createEmptySemanticModel();

    const modelsWithErrors = models.filter(model => model?.hasErrors);
    if (modelsWithErrors.length > 0) {
      mergedModel.hasErrors = true;
      mergedModel.errors = modelsWithErrors.flatMap(model => model.errors || []);
    }

    // Contributing models, in order (error models are skipped as before).
    const contributing = models.filter(
      (model): model is SemanticModel => !!model && !model.hasErrors
    );
    const mergedRecord = mergedModel as unknown as Record<MergeCategoryKey, CategoryMap>;

    // Category-stable merge: rebuild only categories whose input signature
    // changed; reuse the previous merged object otherwise (see mergeCache).
    MERGE_CATEGORY_KEYS.forEach(key => {
      const inputs: CategoryMap[] = [];
      for (const model of contributing) {
        const category = (model as unknown as Record<MergeCategoryKey, CategoryMap | undefined>)[key];
        if (category) inputs.push(category);
      }

      const prev = mergeCache[key];
      const signatureMatches =
        prev !== undefined &&
        prev.signature.length === inputs.length &&
        prev.signature.every((ref, i) => ref === inputs[i]);

      if (signatureMatches) {
        mergedRecord[key] = prev!.merged;
      } else {
        const mergedCategory = mergedRecord[key];
        for (const category of inputs) {
          Object.assign(mergedCategory, category);
        }
        mergeCache[key] = { signature: inputs, merged: mergedCategory };
      }
    });

    // No-op merge identity: when every merged category is referentially identical
    // to the one already in the store (all signatures hit the cache) and the
    // aggregate error state is unchanged, preserve the previous top-level object
    // so whole-model subscribers do not wake on a merge that changed nothing.
    // Comparing against the current store model (rather than a tracked closure
    // ref) keeps this correct across clearMergedModel, which replaces the model
    // without touching the cache.
    const previous = get().mergedSemanticModel;
    const previousRecord = previous as unknown as Record<MergeCategoryKey, CategoryMap>;
    const categoriesUnchanged = MERGE_CATEGORY_KEYS.every(key => mergedRecord[key] === previousRecord[key]);
    const errorsUnchanged =
      !!previous.hasErrors === !!mergedModel.hasErrors &&
      (previous.errors?.length ?? 0) === (mergedModel.errors?.length ?? 0);

    if (categoriesUnchanged && errorsUnchanged) {
      return;
    }

    set({ mergedSemanticModel: mergedModel });
  },

  loadQuestData: async () => {
    const { questFiles, getSemanticModel, mergeSemanticModels } = get();

    // Parse all quest files
    const models = await Promise.all(
        questFiles.map(filePath => getSemanticModel(filePath))
    );

    const currentModel = get().mergedSemanticModel;
    mergeSemanticModels([withoutAggregateErrors(currentModel), ...models]);
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
    const allFilesWithDialogs = getFilesWithDialogs(dialogIndex);

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
    inFlight.clear();
    stampAllFiles();
    resetMergeCache();
    resetParsedFileRecency();
    set((state) => ({ parsedFiles: new Map(), parseGeneration: state.parseGeneration + 1 }));
  },

  updateFileModel: (filePath: string, model: SemanticModel) => {
    get().updateFileModels([{ filePath, model }]);
  },

  updateFileModels: (updates: Array<{ filePath: string; model: SemanticModel }>) => {
    if (updates.length === 0) return;
    const { parsedFiles, dialogIndex } = get();

    if (!(parsedFiles instanceof Map)) return;

    const newCache = new Map(parsedFiles);
    for (const { filePath, model } of updates) {
      newCache.set(filePath, {
        filePath,
        semanticModel: model,
        lastParsed: new Date()
      });
      touchParsedFile(filePath);
      // This model — the editor's, unsaved edits included — now owns the entry:
      // a disk parse still in flight for the same file must not replace it.
      stampFile(filePath);
    }

    // The dialog index only depends on each dialog's name + owning NPC. Action
    // and condition edits (the common keystroke case) leave that set unchanged,
    // so rebuilding the whole index every update is pure O(project) waste. Only
    // rebuild — once per batch — for the files whose (dialogName, npc) set
    // actually changed.
    const entryKey = (e: { dialogName: string; npc: string }) => `${e.npc}\u0000${e.dialogName}`;
    const nextEntriesByFile = new Map<string, DialogMetadata[]>();
    for (const { filePath, model } of updates) {
      nextEntriesByFile.set(filePath, Object.entries(model.dialogs || {}).map(([dialogName, dialog]) => ({
        dialogName,
        npc: (dialog.properties?.npc as string) || 'Unknown NPC',
        filePath
      })));
    }
    const prevKeysByFile = new Map<string, Set<string>>();
    for (const filePath of nextEntriesByFile.keys()) {
      prevKeysByFile.set(filePath, new Set());
    }
    for (const dialogs of dialogIndex.values()) {
      for (const d of dialogs) {
        prevKeysByFile.get(d.filePath)?.add(entryKey(d));
      }
    }
    const changedFiles = new Set<string>();
    for (const [filePath, nextEntries] of nextEntriesByFile) {
      const prevKeys = prevKeysByFile.get(filePath)!;
      const nextKeys = new Set(nextEntries.map(entryKey));
      if (prevKeys.size !== nextKeys.size || [...nextKeys].some((k) => !prevKeys.has(k))) {
        changedFiles.add(filePath);
      }
    }

    const dialogSetChanged = changedFiles.size > 0;
    let newDialogIndex = dialogIndex;
    if (dialogSetChanged) {
      newDialogIndex = new Map(dialogIndex);
      // NPC lists cloned (or freshly filtered) in this batch — safe to push into.
      const rebuiltNpcs = new Set<string>();
      for (const [npc, dialogs] of newDialogIndex.entries()) {
        const filtered = dialogs.filter(d => !changedFiles.has(d.filePath));
        if (filtered.length !== dialogs.length) {
          if (filtered.length === 0) newDialogIndex.delete(npc);
          else newDialogIndex.set(npc, filtered);
          rebuiltNpcs.add(npc);
        }
      }
      for (const filePath of changedFiles) {
        for (const entry of nextEntriesByFile.get(filePath)!) {
          if (!rebuiltNpcs.has(entry.npc) || !newDialogIndex.has(entry.npc)) {
            newDialogIndex.set(entry.npc, [...(newDialogIndex.get(entry.npc) || [])]);
            rebuiltNpcs.add(entry.npc);
          }
          newDialogIndex.get(entry.npc)!.push(entry);
        }
      }
    }

    enforceParsedFilesCap(newCache, get(), newDialogIndex);

    set((state) => (dialogSetChanged
      ? { parsedFiles: newCache, dialogIndex: newDialogIndex, parseGeneration: state.parseGeneration + 1 }
      : { parsedFiles: newCache, parseGeneration: state.parseGeneration + 1 }));

    // Re-merge the semantic model for the currently selected NPC so that
    // description changes, renames, and deletes are reflected immediately —
    // once for the whole batch. Skip the (full) re-merge when no updated file
    // participates in the selected NPC's merged model — i.e. none is one of
    // that NPC's dialog files or a global (dialog-less) file. This avoids
    // rebuilding the merged model on background file-watcher updates to
    // unrelated NPC files.
    const { selectedNpc } = get();
    if (selectedNpc) {
      const selectedNpcFiles = new Set(
        (newDialogIndex.get(selectedNpc) || []).map(d => d.filePath)
      );
      const filesWithDialogs = getFilesWithDialogs(newDialogIndex);
      const relevant = updates.some(
        ({ filePath }) => selectedNpcFiles.has(filePath) || !filesWithDialogs.has(filePath)
      );
      if (relevant) {
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

  addSpawnSite: (site: SpawnSite) => {
    set((state) => ({ spawnSiteIndex: [...state.spawnSiteIndex, site] }));
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
