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


/** One statically resolvable spawn: names are UPPERCASED, line is 1-based. */
export interface SpawnSite {
  instance: string;
  spawnPoint: string;
  filePath: string;
  functionName: string;
  line: number;
}

export interface ProjectIndex {
  npcs: string[];
  dialogsByNpc: Map<string, DialogMetadata[]>;
  allFiles: string[];
  questFiles: string[];
  routines: string[];
  /** Prototype names (normalized uppercase) whose parent chain reaches C_NPC */
  npcPrototypes: string[];
  /**
   * AI_Output voice ids across the project, keyed by UPPERCASED id (Daedalus is
   * case-insensitive); entries keep the original file/function locations.
   * Built at project load/reindex time — not refreshed on every save, so it can
   * be stale until the next reindex.
   */
  voiceIds: Record<string, Array<{ filePath: string; functionName: string }>>;
  /**
   * Waypoint name literals passed to one of the engine externals that take a
   * place name (`ENGINE_EXTERNAL_WAYPOINT_ARG_INDEX`, measured against the G2
   * MDK's Externals.d) or to a project-declared function taking a
   * `var string waypoint` parameter, keyed by UPPERCASED waypoint name;
   * entries keep the original file/function locations. Built at project
   * load/reindex time, same as voiceIds.
   */
  waypointSites: Record<string, Array<{ filePath: string; functionName: string }>>;
  /**
   * Static NPC/item spawns: every `Wld_InsertNpc`/`Wld_InsertItem` call whose
   * instance and spawn point are both literals. Dynamic sites are excluded
   * rather than guessed. Built at project load/reindex time, same as voiceIds.
   */
  spawnSites: SpawnSite[];
  /** Files whose metadata extraction failed (read/parse error, timeout, crash). */
  metadataFailures: Array<{ filePath: string; error: string }>;
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
  /** True when the source id argument was not a string literal. */
  idIsExpression?: boolean;
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
  quantity: number | string;
}

export interface GiveInventoryItemsAction {
  type: 'GiveInventoryItems';
  giver: string;
  receiver: string;
  item: string;
  quantity: number | string;
}

export interface AttackActionType {
  type: 'AttackAction';
  attacker: string;
  target: string;
  attackReason: string;
  damage: number | string;
}

export interface SetAttitudeActionType {
  type: 'SetAttitudeAction';
  target: string;
  attitude: string;
}

export interface ChapterTransitionAction {
  type: 'ChapterTransitionAction';
  chapter: number | string;
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

export interface SetRefuseTalkAction {
  type: 'SetRefuseTalkAction';
  target: string;
  seconds: number | string;
}

export interface ClearChoicesAction {
  type: 'ClearChoicesAction';
  dialog: string;
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
  /** Absent for the 2-arg `Npc_RemoveInvItem` engine form. */
  removeQuantity?: string;
}

export interface InsertNpcActionType {
  type: 'InsertNpcAction';
  npcInstance: string;
  spawnPoint: string;
}

export interface HeroFollowsActionType {
  type: 'HeroFollowsAction';
  guideRoutine: string;
}

export interface Action {
  type: 'Action';
  action: string;
}

/**
 * A standalone comment inside a function or condition body, preserved in
 * source position (mirrors the parser's `CommentAction`). Read-only in the
 * editor UI; regenerates verbatim with no trailing `;`.
 */
export interface CommentActionType {
  type: 'CommentAction';
  text: string;
}

export interface CustomAction {
  type?: 'CustomAction'; // Fallback for legacy or untyped custom actions
  action: string;
}

export interface ConditionalAction {
  type: 'ConditionalAction';
  condition: string;
  thenActions: DialogAction[];
  elseActions: DialogAction[];
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
  | SetRefuseTalkAction
  | ClearChoicesAction
  | GivePlayerXPActionType
  | PickpocketActionType
  | StartOtherRoutineActionType
  | TeachActionType
  | GiveTradeInventoryActionType
  | RemoveInventoryItemsActionType
  | InsertNpcActionType
  | HeroFollowsActionType
  | ConditionalAction
  | Action
  | CommentActionType
  | CustomAction;

// ============================================================================
// Semantic Model Types - Conditions
// ============================================================================

export interface NpcKnowsInfoCondition {
  type: 'NpcKnowsInfoCondition';
  npc: string;
  dialogRef: string;
  /** `!Npc_KnowsInfo(...)` — the "has not heard this yet" chain gate. */
  negated?: boolean;
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

export interface QuestStateCondition {
  type: 'QuestStateCondition';
  questVariable: string;
  state: 'LOG_RUNNING' | 'LOG_SUCCESS' | 'LOG_FAILED' | 'LOG_OBSOLETE';
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
  | GenericCondition
  | QuestStateCondition;

// ============================================================================
// Semantic Model Types - Functions and Dialogs
// ============================================================================

export interface FunctionParameter {
  keyword?: string;
  type: string;
  name: string;
}

export interface ParsedArg {
  raw: string;
  value: string;
  isString: boolean;
}

export interface FunctionCallSite {
  functionName: string;
  args: ParsedArg[];
  position: { startLine: number; startColumn: number; endLine: number; endColumn: number };
}

export interface DialogFunction {
  name: string;
  returnType: 'VOID' | 'INT' | 'STRING';
  filePath?: string;
  parameters?: FunctionParameter[];
  actions: DialogAction[];
  conditions: DialogCondition[];
  conditionOperator?: 'AND' | 'OR';
  calls: string[];
  /** Every call_expression in this function's body, args and 1-based position. */
  callSites?: FunctionCallSite[];
}

/**
 * A dialog property value referencing a C_INFO function: either the bare
 * function name or the linked `DialogFunction` object (mirrors the parser's
 * `DialogFunctionRef`).
 */
export type DialogFunctionRef = string | DialogFunction;

export interface DialogProperties {
  npc?: string;
  nr?: number;
  condition?: DialogFunctionRef;
  information?: DialogFunctionRef;
  description?: string;
  important?: boolean;
  permanent?: boolean;
  trade?: boolean;
}

export interface Dialog {
  name: string;
  parent: string;
  properties: DialogProperties;
  /** Standalone comments preceding a C_INFO property, keyed by property name. */
  propertyLeadingComments?: { [key: string]: string[] };
  /** Same-line trailing comment after a C_INFO property, keyed by property name. */
  propertyTrailingComments?: { [key: string]: string };
  /** Standalone comments after the last property, before the closing `};`. */
  trailingBodyComments?: string[];
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
  sourceText?: string;
  leadingComments?: string[];
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
  sourceText?: string;
  leadingComments?: string[];
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
  dailyRoutine?: string;
  sourceText?: string;
  leadingComments?: string[];
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

export interface GlobalClass {
  name: string;
  sourceText?: string;
  leadingComments?: string[];
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

export interface GlobalPrototype {
  name: string;
  parent: string;
  sourceText?: string;
  leadingComments?: string[];
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
  declarationOrder?: Array<{ type: 'dialog' | 'function' | 'constant' | 'variable' | 'instance' | 'class' | 'prototype'; name: string }>;
  constants?: Record<string, GlobalConstant>;
  variables?: Record<string, GlobalVariable>;
  instances?: Record<string, GlobalInstance>;
  classes?: Record<string, GlobalClass>;
  prototypes?: Record<string, GlobalPrototype>;
  /** File-trailing comments (after the last declaration, at EOF). */
  trailingComments?: string[];
  items?: Record<string, GlobalInstance>;
  npcs?: Record<string, GlobalInstance>;
  animations?: Record<string, GlobalInstance>;
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
  | 'circular_dependency'
  | 'duplicate_voice_id'
  | 'malformed_voice_id';

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
  /**
   * Project-wide AI_Output voice ids (excluding the file being validated),
   * keyed by UPPERCASED id — same shape as ProjectIndex.voiceIds.
   */
  existingVoiceIds?: Record<string, Array<{ filePath: string; functionName: string }>>;
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
