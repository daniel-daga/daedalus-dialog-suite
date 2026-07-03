/**
 * Global type definitions for the renderer process
 *
 * Re-exports shared types and defines renderer-specific types like EditorAPI
 */

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
  addRecentProject: (projectPath: string, projectName: string) => Promise<void>;

  // File Watcher API
  startFileWatcher: (projectPath: string) => Promise<void>;
  stopFileWatcher: () => Promise<void>;
  notifySelfWrite: (filePath: string) => Promise<void>;
  onFileChanged: (callback: (event: FileChangeEvent) => void) => () => void;

  // App info
  getAppVersion: () => Promise<string>;

  // Window close guard (E1). Main intercepts the window `close`, sends
  // `app:closeRequested`, and waits for the renderer to acknowledge and decide.
  onCloseRequested: (callback: () => void) => () => void;
  ackCloseRequest: () => void;
  approveClose: () => void;
  cancelClose: () => void;

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
