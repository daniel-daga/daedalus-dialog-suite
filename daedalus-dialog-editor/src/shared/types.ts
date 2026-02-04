/**
 * Shared type definitions used by both main and renderer processes
 */

// ============================================================================
// Project Types
// ============================================================================

export interface DialogMetadata {
  dialogName: string;
  npc: string;
  filePath: string;
}

export interface GlobalSymbol {
  name: string;
  type: string;
  value?: string | number | boolean;
  filePath: string;
}

export interface ProjectIndex {
  npcs: string[];
  dialogsByNpc: Map<string, DialogMetadata[]>;
  allFiles: string[];
  questFiles: string[];
  symbols: Map<string, GlobalSymbol>;
  questReferences: Map<string, string[]>;
}

// ============================================================================
// Code Generation Settings
// ============================================================================

export interface CodeGenerationSettings {
  indentChar: '\t' | ' ';
  includeComments: boolean;
  sectionHeaders: boolean;
  uppercaseKeywords: boolean;
}

// ============================================================================
// Semantic Model Types - Actions
// ============================================================================

export interface DialogLineAction {
  speaker: 'self' | 'other';
  text: string;
  id: string;
}

export interface ChoiceAction {
  dialogRef: string;
  text: string;
  targetFunction: string;
}

export interface LogEntryAction {
  topic: string;
  text: string;
}

export interface CreateTopicAction {
  topic: string;
  topicType: string;
}

export interface LogSetTopicStatusAction {
  topic: string;
  status: string;
}

export interface CreateInventoryItemsAction {
  target: string;
  item: string;
  quantity: number;
}

export interface GiveInventoryItemsAction {
  giver: string;
  receiver: string;
  item: string;
  quantity: number;
}

export interface AttackActionType {
  attacker: string;
  target: string;
  attackReason: string;
  damage: number;
}

export interface SetAttitudeActionType {
  target: string;
  attitude: string;
}

export interface ChapterTransitionAction {
  chapter: number;
  world: string;
}

export interface ExchangeRoutineAction {
  target?: string;
  npc?: string;
  routine: string;
}

export interface CustomAction {
  action: string;
}

/**
 * Union type for all possible dialog actions
 */
export type DialogAction =
  | DialogLineAction
  | ChoiceAction
  | LogEntryAction
  | CreateTopicAction
  | LogSetTopicStatusAction
  | CreateInventoryItemsAction
  | GiveInventoryItemsAction
  | AttackActionType
  | SetAttitudeActionType
  | ChapterTransitionAction
  | ExchangeRoutineAction
  | CustomAction;

// ============================================================================
// Semantic Model Types - Conditions
// ============================================================================

export interface NpcKnowsInfoCondition {
  npc: string;
  dialogRef: string;
}

export interface VariableCondition {
  variableName: string;
  negated: boolean;
  operator?: string;
  value?: string | number | boolean;
}

export interface GenericCondition {
  condition: string;
}

export type DialogCondition = NpcKnowsInfoCondition | VariableCondition | GenericCondition;

// ============================================================================
// Semantic Model Types - Functions and Dialogs
// ============================================================================

export interface DialogFunction {
  name: string;
  returnType: 'VOID' | 'INT' | 'STRING';
  actions: DialogAction[];
  conditions: DialogCondition[];
  calls: string[];
}

export interface DialogProperties {
  npc?: string;
  nr?: number;
  condition?: string | DialogFunction;
  information?: string | DialogFunction;
  description?: string;
  important?: boolean;
  permanent?: boolean;
  trade?: boolean;
}

export interface Dialog {
  name: string;
  parent: string;
  properties: DialogProperties;
}

export interface ParseError {
  type: string;
  message: string;
  position?: { row: number; column: number };
  text?: string;
}

export interface GlobalConstant {
  name: string;
  type: string;
  value: string | number | boolean;
  filePath?: string;
  position?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  range?: {
    startIndex: number;
    endIndex: number;
  };
}

export interface GlobalVariable {
  name: string;
  type: string;
  filePath?: string;
  position?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  range?: {
    startIndex: number;
    endIndex: number;
  };
}

export interface SemanticModel {
  dialogs: Record<string, Dialog>;
  functions: Record<string, DialogFunction>;
  constants?: Record<string, GlobalConstant>;
  variables?: Record<string, GlobalVariable>;
  instances?: Record<string, unknown>;
  hasErrors: boolean;
  errors: ParseError[];
}

// ============================================================================
// Function Tree Types (for dialog navigation)
// ============================================================================

export interface FunctionTreeChild {
  text: string;
  targetFunction: string;
  subtree: FunctionTreeNode | null;
  isShared: boolean;
}

export interface FunctionTreeNode {
  name: string;
  function: DialogFunction;
  children: FunctionTreeChild[];
}

// ============================================================================
// Validation Types
// ============================================================================

export type ValidationErrorType =
  | 'syntax_error'
  | 'duplicate_dialog'
  | 'missing_function'
  | 'missing_required_property'
  | 'circular_dependency';

export interface ValidationError {
  type: ValidationErrorType;
  message: string;
  dialogName?: string;
  functionName?: string;
  position?: { row: number; column: number };
}

export interface ValidationWarning {
  type: string;
  message: string;
  dialogName?: string;
  functionName?: string;
}

export interface ValidationOptions {
  existingDialogs?: string[];
  skipSyntaxValidation?: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  generatedCode?: string;
}

export interface SaveResult {
  success: boolean;
  encoding?: string;
  validationResult?: ValidationResult;
}
