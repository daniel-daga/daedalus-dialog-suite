/**
 * Global type definitions for the renderer process
 *
 * Re-exports shared types and defines renderer-specific types like EditorAPI
 */

export type {
  OpenWorldRequest,
  WorldSummary,
  WorldMeshPayload,
  InstancedPayload,
  DecodedTexture,
  VfsEntry,
  WaynetPayload,
  WorldOp,
} from '../../shared/worldTypes';

// Re-export all shared types
export type {
  UpdateMetadata,
  UpdateCheckResult,
  UpdaterSettings,
} from '../../shared/updater-types';

export type {
  DialogMetadata,
  ProjectIndex,
  CodeGenerationSettings,
  DialogLineAction,
  ChoiceAction,
  LogEntryAction,
  CreateTopicAction,
  LogSetTopicStatusAction,
  CreateInventoryItemsAction,
  GiveInventoryItemsAction,
  AttackActionType,
  SetAttitudeActionType,
  ChapterTransitionAction,
  ExchangeRoutineAction,
  SetRefuseTalkAction,
  ClearChoicesAction,
  GivePlayerXPActionType,
  PickpocketActionType,
  StartOtherRoutineActionType,
  TeachActionType,
  GiveTradeInventoryActionType,
  RemoveInventoryItemsActionType,
  InsertNpcActionType,
  ConditionalAction,
  CustomAction,
  CommentActionType,
  DialogAction,
  NpcKnowsInfoCondition,
  VariableCondition,
  NpcHasItemsCondition,
  NpcIsInStateCondition,
  NpcIsDeadCondition,
  NpcGetDistToWpCondition,
  NpcGetTalentSkillCondition,
  GenericCondition,
  DialogCondition,
  DialogFunction,
  DialogProperties,
  Dialog,
  ParseError,
  GlobalConstant,
  GlobalVariable,
  GlobalInstance,
  GlobalClass,
  GlobalPrototype,
  SemanticModel,
  FunctionTreeChild,
  FunctionTreeNode,
  ValidationErrorType,
  ValidationError,
  ValidationWarning,
  ValidationOptions,
  ValidationResult,
  SaveResult,
  RecentProject
} from '../../shared/types';

// Import types needed for EditorAPI definition
import type {
  SemanticModel,
  CodeGenerationSettings,
  ProjectIndex,
  ValidationResult,
  ValidationOptions,
  SaveResult,
  RecentProject
} from '../../shared/types';

import type { UpdateCheckResult } from '../../shared/updater-types';

// ============================================================================
// Editor API (renderer-specific)
// ============================================================================

export interface SaveOptions {
  skipValidation?: boolean;
  forceOnErrors?: boolean;
  // When true, bypass the main-process external-modification precondition
  // (E4 phase 2) and overwrite the file even if it changed on disk.
  overwriteExternal?: boolean;
  // Project-wide AI_Output voice ids (excluding the file being saved), keyed
  // by UPPERCASED id — same shape as ProjectIndex.voiceIds. Feeds the
  // duplicate-voice-id validation warnings.
  existingVoiceIds?: Record<string, Array<{ filePath: string; functionName: string }>>;
}

export interface EditorAPI {
  // Parser API - runs in main process (has access to native modules)
  parseSource: (sourceCode: string) => Promise<SemanticModel>;

  // Validation API - validates model before saving
  validateModel: (model: SemanticModel, settings: CodeGenerationSettings, options?: ValidationOptions) => Promise<ValidationResult>;

  // Code Generator API - runs in main process
  generateCode: (model: SemanticModel, settings: CodeGenerationSettings) => Promise<string>;
  generateDialogCode: (model: SemanticModel, dialogName: string, settings: CodeGenerationSettings) => Promise<string>;
  saveFile: (filePath: string, model: SemanticModel, settings: CodeGenerationSettings, options?: SaveOptions) => Promise<SaveResult>;

  // File I/O API
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string, options?: { overwriteExternal?: boolean }) => Promise<{ success: boolean }>;
  openFileDialog: () => Promise<string | null>;
  saveFileDialog: () => Promise<string | null>;

  // Project API
  openProjectFolderDialog: () => Promise<string | null>;
  buildProjectIndex: (folderPath: string) => Promise<ProjectIndex>;
  parseDialogFile: (filePath: string) => Promise<SemanticModel>;
  addAllowedPath: (folderPath: string) => Promise<void>;

  // Settings API
  getRecentProjects: () => Promise<RecentProject[]>;

  // File Watcher API
  startFileWatcher: (projectPath: string) => Promise<void>;
  stopFileWatcher: () => Promise<void>;
  onFileChanged: (callback: (event: FileChangeEvent) => void) => () => void;

  // App info
  getAppVersion: () => Promise<string>;

  // Crash logging (fix-08 §5). The renderer forwards window.onerror /
  // unhandledrejection here; main validates and appends to the local log file.
  logRendererError: (payload: { message: string; stack?: string }) => Promise<void>;
  getLogPath: () => Promise<string>;
  showLogFile: () => Promise<void>;

  // Window close guard (E1). Main intercepts the window `close`, sends
  // `app:closeRequested`, and waits for the renderer to acknowledge and decide.
  onCloseRequested: (callback: () => void) => () => void;
  ackCloseRequest: () => void;
  approveClose: () => void;
  cancelClose: () => void;

  // World API (level-editor.md §7). The world stays in the main process; what
  // crosses is the lightweight VOB index plus geometry and texture buffers.
  openWorldDialog: () => Promise<string | null>;
  selectGothicInstall: () => Promise<string | null>;
  getGothicInstall: () => Promise<string | null>;
  openWorld: (request: OpenWorldRequest) => Promise<WorldSummary>;
  getWorldMesh: () => Promise<WorldMeshPayload>;
  getWorldVisuals: () => Promise<InstancedPayload>;
  getWorldTexture: (name: string, maxSize: number) => Promise<DecodedTexture | null>;
  /** One level of the mounted VFS; null for a missing path and for a file. */
  listWorldAssets: (path: string) => Promise<VfsEntry[] | null>;
  getWorldWaynet: () => Promise<WaynetPayload>;
  /** The bounds of a visual a VOB is being *given*, for the box a swap refits —
   *  the one bounds not already in the renderer, because a visual the world does
   *  not use has no instance. Null for a name that does not resolve. */
  getVisualBounds: (name: string) => Promise<number[] | null>;
  /** The per-class fields of one VOB, by its native index path — the `from` side
   *  of a class-property edit and what the grid shows. Asked for every time: the
   *  columnar index interns a class name and carries no per-class data. */
  getVobProps: (path: string) => Promise<Record<string, unknown>>;
  /** The VOB enumeration again, after a structural edit changed it. A flat index
   *  is a position in a depth-first traversal, so an added VOB changes how many
   *  there are and the columnar projection cannot be patched. */
  refreshWorldIndex: () => Promise<WorldSummary>;
  /** Apply an edit. One call is one undo entry, so a multi-select drag is one
   *  batch and not one call per VOB. */
  applyWorldOps: (ops: WorldOp[]) => Promise<void>;
  /** The ops that were applied, so the renderer's projection can follow them —
   *  null when there was nothing left to undo/redo. */
  undoWorldEdit: () => Promise<WorldOp[] | null>;
  redoWorldEdit: () => Promise<WorldOp[] | null>;
  /** Ask for a save target. Null when the dialog was cancelled. The renderer
   *  never names its own: the target is chosen in a main-process dialog, which
   *  is also what puts it on the path whitelist. */
  saveWorldDialog: (suggested: string) => Promise<string | null>;
  /** Write the world. Rejects with the binding's own message for a world that
   *  was not loaded from a `zCArchiverBinSafe` archive. */
  saveWorld: (targetPath: string) => Promise<void>;
  closeWorld: () => Promise<void>;

  // Updater API
  checkForUpdate: () => Promise<UpdateCheckResult>;
  downloadUpdate: (url: string) => Promise<string>;
  installUpdate: (installerPath: string) => Promise<void>;
  dismissUpdateVersion: (version: string) => Promise<void>;
  onDownloadProgress: (callback: (percent: number) => void) => () => void;
}

export interface FileChangeEvent {
  type: 'change' | 'add' | 'unlink';
  filePath: string;
}

declare global {
  interface Window {
    editorAPI: EditorAPI;
  }
}

export {};
