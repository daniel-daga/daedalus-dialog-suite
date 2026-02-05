/**
 * Global type definitions for the renderer process
 *
 * Re-exports shared types and defines renderer-specific types like EditorAPI
 */

// Re-export all shared types
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
  CustomAction,
  DialogAction,
  NpcKnowsInfoCondition,
  VariableCondition,
  GenericCondition,
  DialogCondition,
  DialogFunction,
  DialogProperties,
  Dialog,
  ParseError,
  GlobalConstant,
  GlobalVariable,
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

// ============================================================================
// Editor API (renderer-specific)
// ============================================================================

export interface SaveOptions {
  skipValidation?: boolean;
  forceOnErrors?: boolean;
}

export interface EditorAPI {
  // Parser API - runs in main process (has access to native modules)
  parseSource: (sourceCode: string) => Promise<SemanticModel>;

  // Validation API - validates model before saving
  validateModel: (model: SemanticModel, settings: CodeGenerationSettings, options?: ValidationOptions) => Promise<ValidationResult>;

  // Code Generator API - runs in main process
  generateCode: (model: SemanticModel, settings: CodeGenerationSettings) => Promise<string>;
  saveFile: (filePath: string, model: SemanticModel, settings: CodeGenerationSettings, options?: SaveOptions) => Promise<SaveResult>;

  // File I/O API
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean }>;
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
}

declare global {
  interface Window {
    editorAPI: EditorAPI;
  }
}

export {};
