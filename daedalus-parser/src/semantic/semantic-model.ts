import 'reflect-metadata';
import { Type, plainToInstance, ClassConstructor } from 'class-transformer';

// Semantic model classes and types for Daedalus dialog parsing

// ===================================================================
// SHARED INTERFACES (re-exported for backward compatibility)
// ===================================================================

export type { CodeGenOptions, CodeGeneratable } from './semanticModelInterfaces';
import type { CodeGenOptions, CodeGeneratable } from './semanticModelInterfaces';

// ===================================================================
// DOMAIN ACTION CLASSES (imported + re-exported for backward compatibility)
// ===================================================================

import { DialogLine, Choice } from './dialogActions';
export { DialogLine, Choice } from './dialogActions';

import {
  CreateInventoryItems,
  GiveInventoryItems,
  GiveTradeInventoryAction,
  RemoveInventoryItemsAction,
} from './inventoryActions';
export {
  CreateInventoryItems,
  GiveInventoryItems,
  GiveTradeInventoryAction,
  RemoveInventoryItemsAction,
} from './inventoryActions';

import {
  AttackAction,
  ExchangeRoutineAction,
  HeroFollowsAction,
  InsertNpcAction,
  PickpocketAction,
  PlayAniAction,
  SetAttitudeAction,
  StartOtherRoutineAction,
  StopProcessInfosAction,
  TeachAction,
} from './npcActions';
export {
  AttackAction,
  ExchangeRoutineAction,
  HeroFollowsAction,
  InsertNpcAction,
  PickpocketAction,
  PlayAniAction,
  SetAttitudeAction,
  StartOtherRoutineAction,
  StopProcessInfosAction,
  TeachAction,
} from './npcActions';

// ===================================================================
// DOMAIN CONDITION CLASSES (imported + re-exported for backward compatibility)
// ===================================================================

import {
  Condition,
  NpcGetDistToWpCondition,
  NpcGetTalentSkillCondition,
  NpcHasItemsCondition,
  NpcIsDeadCondition,
  NpcIsInStateCondition,
  NpcKnowsInfoCondition,
  QuestStateCondition,
  VariableCondition,
} from './conditionTypes';
export {
  Condition,
  NpcGetDistToWpCondition,
  NpcGetTalentSkillCondition,
  NpcHasItemsCondition,
  NpcIsDeadCondition,
  NpcIsInStateCondition,
  NpcKnowsInfoCondition,
  QuestStateCondition,
  VariableCondition,
} from './conditionTypes';
export type { DialogCondition } from './conditionTypes';
import type { DialogCondition } from './conditionTypes';

// ===================================================================
// TYPE DEFINITIONS FOR TREE-SITTER NODES
// ===================================================================

export interface TreeSitterNode {
  type: string;
  text: string;
  children: TreeSitterNode[];
  namedChildren: TreeSitterNode[];
  childCount: number;
  parent: TreeSitterNode | null;
  startIndex: number;
  endIndex: number;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  nextSibling: TreeSitterNode | null;
  hasError: boolean;
  isMissing: boolean;
  childForFieldName(fieldName: string): TreeSitterNode | null;
  child(index: number): TreeSitterNode;
  walk(): TreeCursor;
}

export interface TreeCursor {
  nodeType: string;
  nodeText: string;
  nodeIsMissing: boolean;
  nodeIsNamed: boolean;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  currentNode: TreeSitterNode;

  reset(node: TreeSitterNode): void;
  delete(): void;
  gotoParent(): boolean;
  gotoFirstChild(): boolean;
  gotoFirstChildForIndex(index: number): boolean;
  gotoNextSibling(): boolean;
}

// ===================================================================
// SEMANTIC MODEL CLASSES
// ===================================================================

export class GlobalConstant {
  public name: string;
  public type: string;
  public value: string | number | boolean;
  public filePath?: string;
  public position?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  public range?: {
    startIndex: number;
    endIndex: number;
  };

  constructor(name: string, type: string, value: string | number | boolean) {
    this.name = name;
    this.type = type;
    this.value = value;
  }
}

export class GlobalVariable {
  public name: string;
  public type: string;
  public filePath?: string;
  public position?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  public range?: {
    startIndex: number;
    endIndex: number;
  };

  constructor(name: string, type: string) {
    this.name = name;
    this.type = type;
  }
}

export class GlobalInstance {
  public name: string;
  public parent: string;
  public displayName?: string;
  public dailyRoutine?: string;
  public filePath?: string;
  public position?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  public range?: {
    startIndex: number;
    endIndex: number;
  };

  constructor(name: string, parent: string) {
    this.name = name;
    this.parent = parent;
  }
}

export interface DialogProperties {
  [key: string]: string | number | boolean | DialogFunction;
}

/**
 * Case-insensitive dialog property lookup. Daedalus identifiers — including
 * C_INFO property names like `condition`/`information` — are case-insensitive,
 * but `DialogProperties` preserves the source spelling as the key.
 */
export function getDialogProperty(
  properties: DialogProperties | undefined,
  name: string
): string | number | boolean | DialogFunction | undefined {
  if (!properties) return undefined;
  const target = name.toLowerCase();
  for (const key in properties) {
    if (key.toLowerCase() === target) {
      return properties[key];
    }
  }
  return undefined;
}

export interface PropertyFormatting {
  [key: string]: {
    beforeEquals: string;
    afterEquals: string;
  };
}

// ===================================================================
// DIALOG ACTION CLASSES (remaining — not split to domain files)
// ===================================================================

export class CreateTopic implements CodeGeneratable {
  public readonly type = 'CreateTopic';
  public topic: string;
  public topicType: string | null;

  constructor(topic: string, topicType: string | null = null) {
    this.topic = topic;
    this.topicType = topicType;
  }

  generateCode(_options: CodeGenOptions): string {
    const code = this.topicType
      ? `Log_CreateTopic (${this.topic}, ${this.topicType});`
      : `Log_CreateTopic (${this.topic});`;
    return `\n${code}\n`;
  }

  toDisplayString(): string {
    return `[CreateTopic: ${this.topic}${this.topicType ? `, ${this.topicType}` : ''}]`;
  }

  getTypeName(): string {
    return 'CreateTopic';
  }
}

export class LogEntry implements CodeGeneratable {
  public readonly type = 'LogEntry';
  public topic: string;
  public text: string;

  constructor(topic: string, text: string) {
    this.topic = topic;
    this.text = text;
  }

  generateCode(_options: CodeGenOptions): string {
    return `\nB_LogEntry (${this.topic}, "${this.text}");\n`;
  }

  toDisplayString(): string {
    return `[LogEntry: ${this.topic} -> "${this.text}"]`;
  }

  getTypeName(): string {
    return 'LogEntry';
  }
}

export class LogSetTopicStatus implements CodeGeneratable {
  public readonly type = 'LogSetTopicStatus';
  public topic: string;
  public status: string;

  constructor(topic: string, status: string) {
    this.topic = topic;
    this.status = status;
  }

  generateCode(_options: CodeGenOptions): string {
    return `Log_SetTopicStatus (${this.topic}, ${this.status});`;
  }

  toDisplayString(): string {
    return `[LogSetTopicStatus: ${this.topic} -> ${this.status}]`;
  }

  getTypeName(): string {
    return 'LogSetTopicStatus';
  }
}

export class Action implements CodeGeneratable {
  public readonly type = 'Action';
  public action: string;

  constructor(action: string) {
    this.action = action;
  }

  generateCode(_options: CodeGenOptions): string {
    const trimmed = this.action.trimEnd();
    return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
  }

  toDisplayString(): string {
    return `[Action: ${this.action}]`;
  }

  getTypeName(): string {
    return 'Action';
  }
}

export class ConditionalAction implements CodeGeneratable {
  public readonly type = 'ConditionalAction';
  public condition: string;
  public thenActions: DialogAction[];
  public elseActions: DialogAction[];

  constructor(condition: string, thenActions: DialogAction[] = [], elseActions: DialogAction[] = []) {
    this.condition = condition;
    this.thenActions = thenActions;
    this.elseActions = elseActions;
  }

  generateCode(options: CodeGenOptions): string {
    const indentUnit = options.indentUnit || '\t';
    const lines: string[] = [];

    lines.push(`if (${this.condition.trim()})`);
    lines.push('{');
    lines.push(...this.renderBranch(this.thenActions, indentUnit, options));

    if (this.elseActions.length > 0) {
      lines.push('}');
      lines.push('else');
      lines.push('{');
      lines.push(...this.renderBranch(this.elseActions, indentUnit, options));
      lines.push('};');
    } else {
      lines.push('};');
    }

    return lines.join('\n');
  }

  toDisplayString(): string {
    return `[ConditionalAction: if (${this.condition})]`;
  }

  getTypeName(): string {
    return 'ConditionalAction';
  }

  private renderBranch(actions: DialogAction[], indentUnit: string, options: CodeGenOptions): string[] {
    const lines: string[] = [];

    for (const action of actions) {
      const actionCode = (action as CodeGeneratable).generateCode({
        ...options,
        indentUnit
      });
      const actionLines = actionCode.split('\n');
      actionLines.forEach((line) => {
        if (line.trim()) {
          lines.push(`${indentUnit}${line}`);
        } else {
          lines.push('');
        }
      });
    }

    return lines;
  }
}

export class ChapterTransitionAction implements CodeGeneratable {
  public readonly type = 'ChapterTransitionAction';
  public chapter: number;
  public world: string;

  constructor(chapter: number, world: string) {
    this.chapter = chapter;
    this.world = world;
  }

  generateCode(_options: CodeGenOptions): string {
    return `B_Kapitelwechsel (${this.chapter}, ${this.world});`;
  }

  toDisplayString(): string {
    return `[ChapterTransition: Chapter ${this.chapter} in ${this.world}]`;
  }

  getTypeName(): string {
    return 'ChapterTransitionAction';
  }
}

export class SetVariableAction implements CodeGeneratable {
  public readonly type = 'SetVariableAction';
  public variableName: string;
  public operator: string;
  public value: string | number | boolean;

  constructor(variableName: string, operator: string, value: string | number | boolean) {
    this.variableName = variableName;
    this.operator = operator;
    this.value = value;
  }

  generateCode(_options: CodeGenOptions): string {
    return `${this.variableName} ${this.operator} ${this.value};`;
  }

  toDisplayString(): string {
    return `[SetVariable: ${this.variableName} ${this.operator} ${this.value}]`;
  }

  getTypeName(): string {
    return 'SetVariableAction';
  }
}

export class GivePlayerXPAction implements CodeGeneratable {
  public readonly type = 'GivePlayerXPAction';
  public xpAmount: string;

  constructor(xpAmount: string) {
    this.xpAmount = xpAmount;
  }

  generateCode(_options: CodeGenOptions): string {
    return `B_GivePlayerXP (${this.xpAmount});`;
  }

  toDisplayString(): string {
    return `[GivePlayerXP: ${this.xpAmount}]`;
  }

  getTypeName(): string {
    return 'GivePlayerXPAction';
  }
}

// ===================================================================
// ACTION UNION TYPE + DISCRIMINATOR + DESERIALIZER
// ===================================================================

export type DialogAction =
  | DialogLine
  | CreateTopic
  | LogEntry
  | LogSetTopicStatus
  | Action
  | ConditionalAction
  | Choice
  | CreateInventoryItems
  | GiveInventoryItems
  | AttackAction
  | SetAttitudeAction
  | ExchangeRoutineAction
  | ChapterTransitionAction
  | SetVariableAction
  | StopProcessInfosAction
  | PlayAniAction
  | GivePlayerXPAction
  | PickpocketAction
  | StartOtherRoutineAction
  | TeachAction
  | GiveTradeInventoryAction
  | RemoveInventoryItemsAction
  | InsertNpcAction
  | HeroFollowsAction;

/**
 * Discriminator table shape used by class-transformer's polymorphic @Type() decorator.
 * Both ACTION_DISCRIMINATOR and CONDITION_DISCRIMINATOR follow this same structure;
 * the shared type makes the pattern explicit and lets TypeScript catch typos.
 */
interface DiscriminatorConfig {
  property: 'type';
  subTypes: Array<{ value: ClassConstructor<object>; name: string }>;
}

const ACTION_DISCRIMINATOR: DiscriminatorConfig = {
  property: 'type',
  subTypes: [
    { value: DialogLine, name: 'DialogLine' },
    { value: CreateTopic, name: 'CreateTopic' },
    { value: LogEntry, name: 'LogEntry' },
    { value: LogSetTopicStatus, name: 'LogSetTopicStatus' },
    { value: Action, name: 'Action' },
    { value: ConditionalAction, name: 'ConditionalAction' },
    { value: Choice, name: 'Choice' },
    { value: CreateInventoryItems, name: 'CreateInventoryItems' },
    { value: GiveInventoryItems, name: 'GiveInventoryItems' },
    { value: AttackAction, name: 'AttackAction' },
    { value: SetAttitudeAction, name: 'SetAttitudeAction' },
    { value: ExchangeRoutineAction, name: 'ExchangeRoutineAction' },
    { value: ChapterTransitionAction, name: 'ChapterTransitionAction' },
    { value: SetVariableAction, name: 'SetVariableAction' },
    { value: StopProcessInfosAction, name: 'StopProcessInfosAction' },
    { value: PlayAniAction, name: 'PlayAniAction' },
    { value: GivePlayerXPAction, name: 'GivePlayerXPAction' },
    { value: PickpocketAction, name: 'PickpocketAction' },
    { value: StartOtherRoutineAction, name: 'StartOtherRoutineAction' },
    { value: TeachAction, name: 'TeachAction' },
    { value: GiveTradeInventoryAction, name: 'GiveTradeInventoryAction' },
    { value: RemoveInventoryItemsAction, name: 'RemoveInventoryItemsAction' },
    { value: InsertNpcAction, name: 'InsertNpcAction' },
    { value: HeroFollowsAction, name: 'HeroFollowsAction' },
  ],
};

// Helper to ensure action has a type (legacy support for serialised JSON without 'type' fields).
//
// IMPORTANT: The if-else order below is fragile — several action classes share overlapping
// property names. More-specific checks (unique discriminating properties) must appear
// before less-specific ones to avoid misclassification:
//   - 'CreateTopic'  (topic + topicType) before 'LogEntry' (topic + text): both have 'topic'
//   - 'CreateInventoryItems' (target + item + quantity, no giver) before 'GiveInventoryItems'
//   - 'PlayAniAction' (target + animationName) before 'StopProcessInfosAction' (only target)
//   - 'StartOtherRoutineAction' (routineFunctionName + routineNpc + routineName) before
//     'ExchangeRoutineAction' (routine)
//
// When adding a new action type, insert its check in the correct position relative to
// any existing checks that share property names.
function ensureActionType(json: any): void {
  if (!json.type) {
    if ('speaker' in json && 'text' in json && 'id' in json) json.type = 'DialogLine';
    else if ('topic' in json && 'topicType' in json) json.type = 'CreateTopic';
    else if ('topic' in json && 'text' in json) json.type = 'LogEntry';
    else if ('topic' in json && 'status' in json) json.type = 'LogSetTopicStatus';
    else if ('condition' in json && 'thenActions' in json && 'elseActions' in json) json.type = 'ConditionalAction';
    else if ('dialogRef' in json && 'targetFunction' in json) json.type = 'Choice';
    else if ('target' in json && 'item' in json && 'quantity' in json && !('giver' in json)) json.type = 'CreateInventoryItems';
    else if ('giver' in json && 'receiver' in json) json.type = 'GiveInventoryItems';
    else if ('attacker' in json && 'attackReason' in json) json.type = 'AttackAction';
    else if ('attitude' in json) json.type = 'SetAttitudeAction';
    else if ('routine' in json) json.type = 'ExchangeRoutineAction';
    else if ('chapter' in json && 'world' in json) json.type = 'ChapterTransitionAction';
    else if ('variableName' in json && 'operator' in json && 'value' in json) json.type = 'SetVariableAction';
    else if ('target' in json && 'animationName' in json) json.type = 'PlayAniAction';
    else if ('target' in json && Object.keys(json).length === 1) json.type = 'StopProcessInfosAction';
    else if ('xpAmount' in json) json.type = 'GivePlayerXPAction';
    else if ('pickpocketMode' in json) json.type = 'PickpocketAction';
    else if ('routineFunctionName' in json && 'routineNpc' in json && 'routineName' in json) json.type = 'StartOtherRoutineAction';
    else if ('teachFunctionName' in json && 'teachArgs' in json) json.type = 'TeachAction';
    else if ('tradeTarget' in json) json.type = 'GiveTradeInventoryAction';
    else if ('removeFunctionName' in json && 'removeNpc' in json && 'removeItem' in json) json.type = 'RemoveInventoryItemsAction';
    else if ('npcInstance' in json && 'spawnPoint' in json) json.type = 'InsertNpcAction';
    else if ('guideRoutine' in json) json.type = 'HeroFollowsAction';
    else if ('action' in json) json.type = 'Action';
  }

  if (Array.isArray(json.thenActions)) {
    json.thenActions.forEach((action: any) => ensureActionType(action));
  }
  if (Array.isArray(json.elseActions)) {
    json.elseActions.forEach((action: any) => ensureActionType(action));
  }
}

// Helper to deserialize any action
export function deserializeAction(json: any): DialogAction | any {
  ensureActionType(json);

  if (json.type) {
    const subType = ACTION_DISCRIMINATOR.subTypes.find(s => s.name === json.type);
    if (subType) {
      const instance = plainToInstance(subType.value as ClassConstructor<any>, json);
      if (instance instanceof ConditionalAction) {
        instance.thenActions = Array.isArray(json.thenActions)
          ? json.thenActions.map((action: any) => deserializeAction(action))
          : [];
        instance.elseActions = Array.isArray(json.elseActions)
          ? json.elseActions.map((action: any) => deserializeAction(action))
          : [];
      }
      return instance;
    }
    // Unknown type: warn instead of silently returning raw JSON, which would let
    // type-unsafe data propagate undetected. Add the missing type to
    // ACTION_DISCRIMINATOR.subTypes to suppress this warning.
    console.warn(`[deserializeAction] Unrecognised action type "${json.type}" — returning raw JSON. Add it to ACTION_DISCRIMINATOR.subTypes.`);
  }

  return json;
}

// ===================================================================
// CONDITION DISCRIMINATOR + DESERIALIZER
// ===================================================================

const CONDITION_DISCRIMINATOR: DiscriminatorConfig = {
  property: 'type',
  subTypes: [
    { value: NpcKnowsInfoCondition, name: 'NpcKnowsInfoCondition' },
    { value: NpcHasItemsCondition, name: 'NpcHasItemsCondition' },
    { value: NpcIsInStateCondition, name: 'NpcIsInStateCondition' },
    { value: NpcIsDeadCondition, name: 'NpcIsDeadCondition' },
    { value: NpcGetDistToWpCondition, name: 'NpcGetDistToWpCondition' },
    { value: NpcGetTalentSkillCondition, name: 'NpcGetTalentSkillCondition' },
    { value: Condition, name: 'Condition' },
    { value: VariableCondition, name: 'VariableCondition' },
    { value: QuestStateCondition, name: 'QuestStateCondition' },
  ],
};

// Helper to ensure condition has a type (legacy support)
function ensureConditionType(json: any): void {
  if (!json.type) {
    if ('npc' in json && 'dialogRef' in json) json.type = 'NpcKnowsInfoCondition';
    else if ('npc' in json && 'item' in json) json.type = 'NpcHasItemsCondition';
    else if ('npc' in json && 'state' in json) json.type = 'NpcIsInStateCondition';
    else if ('npc' in json && !('dialogRef' in json) && !('item' in json) && !('state' in json) && !('waypoint' in json) && !('talent' in json)) json.type = 'NpcIsDeadCondition';
    else if ('npc' in json && 'waypoint' in json) json.type = 'NpcGetDistToWpCondition';
    else if ('npc' in json && 'talent' in json) json.type = 'NpcGetTalentSkillCondition';
    else if ('questVariable' in json) json.type = 'QuestStateCondition';
    else if ('variableName' in json) json.type = 'VariableCondition';
    else if ('condition' in json) json.type = 'Condition';
  }
}

// Helper to deserialize any condition
export function deserializeCondition(json: any): DialogCondition {
  ensureConditionType(json);

  if (json.type) {
    const subType = CONDITION_DISCRIMINATOR.subTypes.find(s => s.name === json.type);
    if (subType) {
      return plainToInstance(subType.value as ClassConstructor<any>, json);
    }
  }

  // Fallback
  return new Condition('');
}

// ===================================================================
// DIALOG FUNCTION CLASS
// ===================================================================

export class DialogFunction {
  public name: string;
  public returnType: string;
  public keyword?: string;
  public spaceBeforeParen?: boolean;
  public leadingComments?: string[];
  public hasExplicitBodyContent?: boolean;
  public calls: string[];

  @Type(() => Object, {
    discriminator: ACTION_DISCRIMINATOR,
  })
  public actions: DialogAction[];

  @Type(() => Object, {
    discriminator: CONDITION_DISCRIMINATOR,
  })
  public conditions: DialogCondition[];

  public conditionOperator: 'AND' | 'OR';

  constructor(name: string, returnType: string) {
    this.name = name;
    this.returnType = returnType;
    this.leadingComments = [];
    this.calls = [];
    this.actions = [];
    this.conditions = [];
    this.conditionOperator = 'AND';
  }
}


// ===================================================================
// DIALOG CLASS
// ===================================================================

/**
 * Resolves raw property values to live `DialogFunction` instances where the
 * value is a function reference (either a DialogFunction-shaped object or a
 * bare name string).  Plain non-function values are passed through unchanged.
 *
 * Extracted from `Dialog.fromJSON` to separate the function-reference linking
 * concern from property transformation and scalar validation.
 */
function linkPropertiesToFunctions(
  dialogName: string,
  rawProperties: Record<string, any>,
  functionsMap: { [key: string]: DialogFunction },
): DialogProperties {
  const linked: DialogProperties = {};
  for (const key in rawProperties) {
    const value = rawProperties[key];
    if (typeof value === 'object' && value !== null && 'name' in value && 'returnType' in value) {
      // Property holds a serialised DialogFunction shape — resolve to the live instance.
      const linkedFunc = functionsMap[value.name];
      if (!linkedFunc) {
        console.warn(`Function '${value.name}' referenced in dialog '${dialogName}' but not found in model`);
        linked[key] = value.name;
      } else {
        linked[key] = linkedFunc;
      }
    } else if (typeof value === 'string' && functionsMap[value]) {
      // Property was already normalised to just the function name string.
      linked[key] = functionsMap[value];
    } else {
      linked[key] = value;
    }
  }
  return linked;
}

export class Dialog {
  public name: string;
  public parent: string | null;
  public keyword?: string;
  public spaceBeforeParen?: boolean;
  public leadingComments?: string[];
  public properties: DialogProperties;
  public propertyFormatting?: PropertyFormatting;
  public propertyExpressionKeys?: string[];
  public actions: DialogAction[];

  constructor(name: string, parent: string | null) {
    this.name = name;
    this.parent = parent;
    this.leadingComments = [];
    this.properties = {};
    this.propertyFormatting = {};
    this.propertyExpressionKeys = [];
    this.actions = [];
  }

  static fromJSON(json: any, functionsMap: { [key: string]: DialogFunction }): Dialog {
    // --- property transformation: copy optional scalar fields ---
    const dialog = new Dialog(json.name, json.parent);
    if (typeof json.keyword === 'string') {
      dialog.keyword = json.keyword;
    }
    if (typeof json.spaceBeforeParen === 'boolean') {
      dialog.spaceBeforeParen = json.spaceBeforeParen;
    }
    if (Array.isArray(json.leadingComments)) {
      dialog.leadingComments = json.leadingComments;
    }
    if (json.propertyFormatting && typeof json.propertyFormatting === 'object') {
      dialog.propertyFormatting = json.propertyFormatting;
    }
    if (Array.isArray(json.propertyExpressionKeys)) {
      dialog.propertyExpressionKeys = json.propertyExpressionKeys;
    }

    // --- function-reference linking: resolve property values to live DialogFunction instances ---
    dialog.properties = linkPropertiesToFunctions(json.name, json.properties ?? {}, functionsMap);

    return dialog;
  }
}

// ===================================================================
// SEMANTIC MODEL INTERFACE
// ===================================================================

export interface SyntaxError {
  type: 'syntax_error' | 'missing_token';
  message: string;
  position: {
    row: number;
    column: number;
  };
  text: string;
}

export interface SemanticModel {
  dialogs: { [key: string]: Dialog };
  functions: { [key: string]: DialogFunction };
  declarationOrder?: Array<{ type: 'dialog' | 'function'; name: string }>;
  constants?: { [key: string]: GlobalConstant };
  variables?: { [key: string]: GlobalVariable };
  instances?: { [key: string]: GlobalInstance };
  items?: { [key: string]: GlobalInstance };
  npcs?: { [key: string]: GlobalInstance };
  animations?: { [key: string]: GlobalInstance };
  errors?: SyntaxError[];
  hasErrors?: boolean;
}

// Helper to deserialize full semantic model
export function deserializeSemanticModel(json: any): SemanticModel {
  const model: SemanticModel = {
    dialogs: {},
    functions: {},
    declarationOrder: json.declarationOrder || [],
    constants: {},
    variables: {},
    instances: {},
    items: {},
    npcs: {},
    animations: {},
    errors: json.errors,
    hasErrors: json.hasErrors
  };

  // 1. Reconstruct functions first
  for (const funcName in json.functions) {
    const funcJson = json.functions[funcName];

    // Ensure types are present in actions and conditions for class-transformer
    if (funcJson.actions) {
        funcJson.actions.forEach((a: any) => ensureActionType(a));
    }
    if (funcJson.conditions) {
        funcJson.conditions.forEach((c: any) => ensureConditionType(c));
    }

    model.functions[funcName] = plainToInstance(DialogFunction as ClassConstructor<any>, funcJson);
    model.functions[funcName].actions = (model.functions[funcName].actions || []).map((action: any) => deserializeAction(action));
    model.functions[funcName].calls = funcJson.calls || [];
  }

  // 2. Reconstruct dialogs and link to functions
  for (const dialogName in json.dialogs) {
    model.dialogs[dialogName] = Dialog.fromJSON(json.dialogs[dialogName], model.functions);
  }

  // 3. Reconstruct constants
  if (json.constants) {
    for (const key in json.constants) {
      model.constants![key] = plainToInstance(GlobalConstant as ClassConstructor<any>, json.constants[key]);
    }
  }

  // 4. Reconstruct variables
  if (json.variables) {
    for (const key in json.variables) {
      model.variables![key] = plainToInstance(GlobalVariable as ClassConstructor<any>, json.variables[key]);
    }
  }

  // 5. Reconstruct instances
  if (json.instances) {
    for (const key in json.instances) {
      model.instances![key] = plainToInstance(GlobalInstance as ClassConstructor<any>, json.instances[key]);
    }
  }

  // 6. Reconstruct items
  if (json.items) {
    for (const key in json.items) {
      model.items![key] = plainToInstance(GlobalInstance as ClassConstructor<any>, json.items[key]);
    }
  }

  // 7. Reconstruct npcs
  if (json.npcs) {
    for (const key in json.npcs) {
      model.npcs![key] = plainToInstance(GlobalInstance as ClassConstructor<any>, json.npcs[key]);
    }
  }

  // 8. Reconstruct animations
  if (json.animations) {
    for (const key in json.animations) {
      model.animations![key] = plainToInstance(GlobalInstance as ClassConstructor<any>, json.animations[key]);
    }
  }

  // Backward compatibility: derive categorized maps from instances when missing
  for (const key in model.instances) {
    const instance = model.instances[key];
    const parentType = instance.parent.toUpperCase();

    if (!json.items && parentType === 'C_ITEM') {
      model.items![key] = instance;
    }

    if (!json.npcs && parentType === 'C_NPC') {
      model.npcs![key] = instance;
    }

    if (!json.animations && parentType === 'C_MDS') {
      model.animations![key] = instance;
    }
  }

  return model;
}
