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
  closeWorld: () => Promise<void>;

  // Updater API
  checkForUpdate: () => Promise<UpdateCheckResult>;
  downloadUpdate: (url: string) => Promise<string>;
  installUpdate: (installerPath: string) => Promise<void>;
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
