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

export interface ProjectIndex {
  npcs: string[];
  dialogsByNpc: Map<string, DialogMetadata[]>;
  allFiles: string[];
  questFiles: string[];
}

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
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
  type: 'DialogLine';
  speaker: 'self' | 'other';
  text: string;
  id: string;
}

export interface ChoiceAction {
  type: 'Choice';
  dialogRef: string;
  text: string;
  targetFunction: string;
}

export interface LogEntryAction {
  type: 'LogEntry';
  topic: string;
  text: string;
}

export interface CreateTopicAction {
  type: 'CreateTopic';
  topic: string;
  topicType: string;
}

export interface LogSetTopicStatusAction {
  type: 'LogSetTopicStatus';
  topic: string;
  status: string;
}

export interface CreateInventoryItemsAction {
  type: 'CreateInventoryItems';
  target: string;
  item: string;
  quantity: number;
}

export interface GiveInventoryItemsAction {
  type: 'GiveInventoryItems';
  giver: string;
  receiver: string;
  item: string;
  quantity: number;
}

export interface AttackActionType {
  type: 'AttackAction';
  attacker: string;
  target: string;
  attackReason: string;
  damage: number;
}

export interface SetAttitudeActionType {
  type: 'SetAttitudeAction';
  target: string;
  attitude: string;
}

export interface ChapterTransitionAction {
  type: 'ChapterTransitionAction';
  chapter: number;
  world: string;
}

export interface ExchangeRoutineAction {
  type: 'ExchangeRoutineAction';
  target?: string;
  npc?: string;
  routine: string;
}

export interface SetVariableAction {
  type: 'SetVariableAction';
  variableName: string;
  operator: string;
  value: string | number | boolean;
}

export interface StopProcessInfosAction {
  type: 'StopProcessInfosAction';
  target: string;
}

export interface PlayAniAction {
  type: 'PlayAniAction';
  target: string;
  animationName: string;
}

export interface GivePlayerXPActionType {
  type: 'GivePlayerXPAction';
  xpAmount: string;
}

export interface PickpocketActionType {
  type: 'PickpocketAction';
  pickpocketMode: 'B_Beklauen' | 'C_Beklauen';
  minChance?: string;
  maxChance?: string;
}

export interface StartOtherRoutineActionType {
  type: 'StartOtherRoutineAction';
  routineFunctionName: 'B_StartOtherRoutine' | 'B_StartotherRoutine';
  routineNpc: string;
  routineName: string;
}

export interface TeachActionType {
  type: 'TeachAction';
  teachFunctionName: string;
  teachArgs: string[];
}

export interface GiveTradeInventoryActionType {
  type: 'GiveTradeInventoryAction';
  tradeTarget: string;
}

export interface RemoveInventoryItemsActionType {
  type: 'RemoveInventoryItemsAction';
  removeFunctionName: 'Npc_RemoveInvItems' | 'Npc_RemoveInvItem';
  removeNpc: string;
  removeItem: string;
  removeQuantity: string;
}

export interface InsertNpcActionType {
  type: 'InsertNpcAction';
  npcInstance: string;
  spawnPoint: string;
}

export interface Action {
  type: 'Action';
  action: string;
}

export interface CustomAction {
  type?: 'CustomAction'; // Fallback for legacy or untyped custom actions
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
  | SetVariableAction
  | StopProcessInfosAction
  | PlayAniAction
  | GivePlayerXPActionType
  | PickpocketActionType
  | StartOtherRoutineActionType
  | TeachActionType
  | GiveTradeInventoryActionType
  | RemoveInventoryItemsActionType
  | InsertNpcActionType
  | Action
  | CustomAction;

// ============================================================================
// Semantic Model Types - Conditions
// ============================================================================

export interface NpcKnowsInfoCondition {
  type: 'NpcKnowsInfoCondition';
  npc: string;
  dialogRef: string;
}

export interface VariableCondition {
  type: 'VariableCondition';
  variableName: string;
  negated: boolean;
  operator?: string;
  value?: string | number | boolean;
}

export interface NpcHasItemsCondition {
  type: 'NpcHasItemsCondition';
  npc: string;
  item: string;
  operator?: string;
  value?: string | number | boolean;
}

export interface NpcIsInStateCondition {
  type: 'NpcIsInStateCondition';
  npc: string;
  state: string;
  negated: boolean;
}

export interface NpcIsDeadCondition {
  type: 'NpcIsDeadCondition';
  npc: string;
  negated: boolean;
}

export interface NpcGetDistToWpCondition {
  type: 'NpcGetDistToWpCondition';
  npc: string;
  waypoint: string;
  operator?: string;
  value?: string | number | boolean;
}

export interface NpcGetTalentSkillCondition {
  type: 'NpcGetTalentSkillCondition';
  npc: string;
  talent: string;
  operator?: string;
  value?: string | number | boolean;
}

export interface Condition {
  type: 'Condition';
  condition: string;
}

export interface GenericCondition {
  type?: 'GenericCondition';
  condition: string;
}

export type DialogCondition =
  | NpcKnowsInfoCondition
  | VariableCondition
  | NpcHasItemsCondition
  | NpcIsInStateCondition
  | NpcIsDeadCondition
  | NpcGetDistToWpCondition
  | NpcGetTalentSkillCondition
  | Condition
  | GenericCondition;

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

export interface GlobalInstance {
  name: string;
  parent: string;
  displayName?: string;
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
  instances?: Record<string, GlobalInstance>;
  items?: Record<string, GlobalInstance>;
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
