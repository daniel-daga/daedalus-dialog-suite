import 'reflect-metadata';
import { Type, plainToInstance, ClassConstructor } from 'class-transformer';

// Semantic model classes and types for Daedalus dialog parsing

// Type definitions for tree-sitter nodes
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

export interface DialogProperties {
  [key: string]: string | number | boolean | DialogFunction;
}

// ===================================================================
// DIALOG ACTION CLASSES
// ===================================================================

/**
 * Interface for code generation options
 */
export interface CodeGenOptions {
  includeComments?: boolean;
}

/**
 * Interface for action code generation and display
 * All action classes implement this to generate their own code and display strings
 */
export interface CodeGeneratable {
  generateCode(options: CodeGenOptions): string;
  toDisplayString(): string;
  getTypeName(): string;
}

export class DialogLine implements CodeGeneratable {
  public readonly type = 'DialogLine';
  public speaker: string;
  public listener: string = 'other';
  public text: string;
  public id: string;

  constructor(speaker: string, text: string, id: string, listener: string = 'other') {
    this.speaker = speaker;
    this.text = text;
    this.id = id;
    this.listener = listener || 'other';
  }

  generateCode(options: CodeGenOptions): string {
    const comment = options.includeComments ? ` //${this.text}` : '';
    const listener = this.listener || 'other';
    return `AI_Output(${this.speaker}, ${listener}, "${this.id}");${comment}`;
  }

  toDisplayString(): string {
    return `[DialogLine: ${this.speaker} -> ${this.listener}: "${this.text}"]`;
  }

  getTypeName(): string {
    return 'DialogLine';
  }
}

export class CreateTopic implements CodeGeneratable {
  public readonly type = 'CreateTopic';
  public topic: string;
  public topicType: string | null;

  constructor(topic: string, topicType: string | null = null) {
    this.topic = topic;
    this.topicType = topicType;
  }

  generateCode(_options: CodeGenOptions): string {
    if (this.topicType) {
      return `Log_CreateTopic(${this.topic}, ${this.topicType});`;
    }
    return `Log_CreateTopic(${this.topic});`;
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
    return `B_LogEntry(${this.topic}, "${this.text}");`;
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
    return `Log_SetTopicStatus(${this.topic}, ${this.status});`;
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
    const code = this.action.trim();
    return code.endsWith(';') ? code : `${code};`;
  }

  toDisplayString(): string {
    return `[Action: ${this.action}]`;
  }

  getTypeName(): string {
    return 'Action';
  }
}

export class Choice implements CodeGeneratable {
  public readonly type = 'Choice';
  public dialogRef: string;
  public text: string;
  public targetFunction: string;

  constructor(dialogRef: string, text: string, targetFunction: string) {
    this.dialogRef = dialogRef;
    this.text = text;
    this.targetFunction = targetFunction;
  }

  generateCode(_options: CodeGenOptions): string {
    return `Info_AddChoice(${this.dialogRef}, "${this.text}", ${this.targetFunction});`;
  }

  toDisplayString(): string {
    return `[Choice: "${this.text}" -> ${this.targetFunction}]`;
  }

  getTypeName(): string {
    return 'Choice';
  }
}

export class CreateInventoryItems implements CodeGeneratable {
  public readonly type = 'CreateInventoryItems';
  public target: string;
  public item: string;
  public quantity: number;

  constructor(target: string, item: string, quantity: number) {
    this.target = target;
    this.item = item;
    this.quantity = quantity;
  }

  generateCode(_options: CodeGenOptions): string {
    return `CreateInvItems(${this.target}, ${this.item}, ${this.quantity});`;
  }

  toDisplayString(): string {
    return `[CreateItems: ${this.target} gets ${this.quantity}x ${this.item}]`;
  }

  getTypeName(): string {
    return 'CreateInventoryItems';
  }
}

export class GiveInventoryItems implements CodeGeneratable {
  public readonly type = 'GiveInventoryItems';
  public giver: string;
  public receiver: string;
  public item: string;
  public quantity: number;

  constructor(giver: string, receiver: string, item: string, quantity: number) {
    this.giver = giver;
    this.receiver = receiver;
    this.item = item;
    this.quantity = quantity;
  }

  generateCode(_options: CodeGenOptions): string {
    return `B_GiveInvItems(${this.giver}, ${this.receiver}, ${this.item}, ${this.quantity});`;
  }

  toDisplayString(): string {
    return `[GiveItems: ${this.giver} gives ${this.receiver} ${this.quantity}x ${this.item}]`;
  }

  getTypeName(): string {
    return 'GiveInventoryItems';
  }
}

export class AttackAction implements CodeGeneratable {
  public readonly type = 'AttackAction';
  public attacker: string;
  public target: string;
  public attackReason: string;
  public damage: number;

  constructor(attacker: string, target: string, attackReason: string, damage: number) {
    this.attacker = attacker;
    this.target = target;
    this.attackReason = attackReason;
    this.damage = damage;
  }

  generateCode(_options: CodeGenOptions): string {
    return `B_Attack(${this.attacker}, ${this.target}, ${this.attackReason}, ${this.damage});`;
  }

  toDisplayString(): string {
    return `[Attack: ${this.attacker} attacks ${this.target} (${this.attackReason}, dmg:${this.damage})]`;
  }

  getTypeName(): string {
    return 'AttackAction';
  }
}

export class SetAttitudeAction implements CodeGeneratable {
  public readonly type = 'SetAttitudeAction';
  public target: string;
  public attitude: string;

  constructor(target: string, attitude: string) {
    this.target = target;
    this.attitude = attitude;
  }

  generateCode(_options: CodeGenOptions): string {
    return `B_SetAttitude(${this.target}, ${this.attitude});`;
  }

  toDisplayString(): string {
    return `[SetAttitude: ${this.target} -> ${this.attitude}]`;
  }

  getTypeName(): string {
    return 'SetAttitudeAction';
  }
}

export class ExchangeRoutineAction implements CodeGeneratable {
  public readonly type = 'ExchangeRoutineAction';
  public target: string;
  public routine: string;

  constructor(target: string, routine: string) {
    this.target = target;
    this.routine = routine;
  }

  generateCode(_options: CodeGenOptions): string {
    return `Npc_ExchangeRoutine(${this.target}, "${this.routine}");`;
  }

  toDisplayString(): string {
    return `[ExchangeRoutine: ${this.target} -> "${this.routine}"]`;
  }

  getTypeName(): string {
    return 'ExchangeRoutineAction';
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
    return `B_Kapitelwechsel(${this.chapter}, ${this.world});`;
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

export class StopProcessInfosAction implements CodeGeneratable {
  public readonly type = 'StopProcessInfosAction';
  public target: string;

  constructor(target: string = 'self') {
    this.target = target;
  }

  generateCode(_options: CodeGenOptions): string {
    return `AI_StopProcessInfos(${this.target});`;
  }

  toDisplayString(): string {
    return `[StopProcessInfos: ${this.target}]`;
  }

  getTypeName(): string {
    return 'StopProcessInfosAction';
  }
}

export class PlayAniAction implements CodeGeneratable {
  public readonly type = 'PlayAniAction';
  public target: string;
  public animationName: string;

  constructor(target: string, animationName: string) {
    this.target = target;
    this.animationName = animationName;
  }

  generateCode(_options: CodeGenOptions): string {
    return `AI_PlayAni(${this.target}, "${this.animationName}");`;
  }

  toDisplayString(): string {
    return `[PlayAni: ${this.target} -> "${this.animationName}"]`;
  }

  getTypeName(): string {
    return 'PlayAniAction';
  }
}

export type DialogAction = DialogLine | CreateTopic | LogEntry | LogSetTopicStatus | Action | Choice | CreateInventoryItems | GiveInventoryItems | AttackAction | SetAttitudeAction | ExchangeRoutineAction | ChapterTransitionAction | SetVariableAction | StopProcessInfosAction | PlayAniAction;

const ACTION_DISCRIMINATOR = {
  property: 'type',
  subTypes: [
    { value: DialogLine, name: 'DialogLine' },
    { value: CreateTopic, name: 'CreateTopic' },
    { value: LogEntry, name: 'LogEntry' },
    { value: LogSetTopicStatus, name: 'LogSetTopicStatus' },
    { value: Action, name: 'Action' },
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
  ],
};

// Helper to ensure action has a type (legacy support)
function ensureActionType(json: any): void {
  if (!json.type) {
    if ('speaker' in json && 'text' in json && 'id' in json) json.type = 'DialogLine';
    else if ('topic' in json && 'topicType' in json) json.type = 'CreateTopic';
    else if ('topic' in json && 'text' in json) json.type = 'LogEntry';
    else if ('topic' in json && 'status' in json) json.type = 'LogSetTopicStatus';
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
    else if ('action' in json) json.type = 'Action';
  }
}

// Helper to deserialize any action
export function deserializeAction(json: any): DialogAction | any {
  ensureActionType(json);

  if (json.type) {
    const subType = ACTION_DISCRIMINATOR.subTypes.find(s => s.name === json.type);
    if (subType) {
      return plainToInstance(subType.value as ClassConstructor<any>, json);
    }
  }

  return json;
}

// ===================================================================
// DIALOG CONDITION CLASSES
// ===================================================================

/**
 * Represents a condition that checks if the player knows a specific dialog
 */
export class NpcKnowsInfoCondition implements CodeGeneratable {
  public readonly type = 'NpcKnowsInfoCondition';
  public npc: string;
  public dialogRef: string;

  constructor(npc: string, dialogRef: string) {
    this.npc = npc;
    this.dialogRef = dialogRef;
  }

  generateCode(_options: CodeGenOptions): string {
    return `Npc_KnowsInfo(${this.npc}, ${this.dialogRef})`;
  }

  toDisplayString(): string {
    return `[NpcKnowsInfo: ${this.npc} knows ${this.dialogRef}]`;
  }

  getTypeName(): string {
    return 'NpcKnowsInfoCondition';
  }
}

/**
 * Generic condition for any other condition expression
 */
export class Condition implements CodeGeneratable {
  public readonly type = 'Condition';
  public condition: string;

  constructor(condition: string) {
    this.condition = condition;
  }

  generateCode(_options: CodeGenOptions): string {
    return this.condition.trim();
  }

  toDisplayString(): string {
    return `[Condition: ${this.condition}]`;
  }

  getTypeName(): string {
    return 'Condition';
  }
}

/**
 * Represents a variable reference condition (e.g., EntscheidungVergessenTaken)
 * or negated variable (e.g., !EntscheidungBuddlerMapTaken)
 */
export class VariableCondition implements CodeGeneratable {
  public readonly type = 'VariableCondition';
  public variableName: string;
  public negated: boolean;
  public operator?: string;
  public value?: string | number | boolean;

  constructor(variableName: string, negated: boolean = false, operator?: string, value?: string | number | boolean) {
    this.variableName = variableName;
    this.negated = negated;
    if (operator !== undefined) {
      this.operator = operator;
    }
    if (value !== undefined) {
      this.value = value;
    }
  }

  generateCode(_options: CodeGenOptions): string {
    if (this.operator && this.value !== undefined) {
      return `${this.variableName} ${this.operator} ${this.value}`;
    }
    return this.negated ? `!${this.variableName}` : this.variableName;
  }

  toDisplayString(): string {
    if (this.operator && this.value !== undefined) {
      return `[Variable: ${this.variableName} ${this.operator} ${this.value}]`;
    }
    return this.negated ? `[Not: ${this.variableName}]` : `[Variable: ${this.variableName}]`;
  }

  getTypeName(): string {
    return 'VariableCondition';
  }
}

export type DialogCondition = NpcKnowsInfoCondition | Condition | VariableCondition;

const CONDITION_DISCRIMINATOR = {
  property: 'type',
  subTypes: [
    { value: NpcKnowsInfoCondition, name: 'NpcKnowsInfoCondition' },
    { value: Condition, name: 'Condition' },
    { value: VariableCondition, name: 'VariableCondition' },
  ],
};

// Helper to ensure condition has a type (legacy support)
function ensureConditionType(json: any): void {
  if (!json.type) {
    if ('npc' in json && 'dialogRef' in json) json.type = 'NpcKnowsInfoCondition';
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
  public calls: string[];

  @Type(() => Object, {
    discriminator: ACTION_DISCRIMINATOR,
  })
  public actions: DialogAction[];

  @Type(() => Object, {
    discriminator: CONDITION_DISCRIMINATOR,
  })
  public conditions: DialogCondition[];

  constructor(name: string, returnType: string) {
    this.name = name;
    this.returnType = returnType;
    this.calls = [];
    this.actions = [];
    this.conditions = [];
  }
}


// ===================================================================
// DIALOG CLASS
// ===================================================================

export class Dialog {
  public name: string;
  public parent: string | null;
  public properties: DialogProperties;
  public actions: DialogAction[];

  constructor(name: string, parent: string | null) {
    this.name = name;
    this.parent = parent;
    this.properties = {};
    this.actions = [];
  }

  static fromJSON(json: any, functionsMap: { [key: string]: DialogFunction }): Dialog {
    const dialog = new Dialog(json.name, json.parent);

    // Reconstruct properties, linking to DialogFunction instances
    for (const key in json.properties) {
      const value = json.properties[key];

      // Check if this property references a function
      if (typeof value === 'object' && value !== null && 'name' in value && 'returnType' in value) {
        // Link to the reconstructed function from the map
        const linkedFunc = functionsMap[value.name];
        if (!linkedFunc) {
          console.warn(`Function '${value.name}' referenced in dialog '${json.name}' but not found in model`);
          // Preserve as function name string instead of assigning undefined
          // Or if we want to match the previous logic exactly, we keep it as is if it's already a DialogFunction-like object
          // But since we are reconstructing, we really want the reference to the object in functionsMap
          dialog.properties[key] = value.name; 
        } else {
          dialog.properties[key] = linkedFunc;
        }
      } else if (typeof value === 'string' && functionsMap[value]) {
        // Handle case where it was normalized to just a string name
        dialog.properties[key] = functionsMap[value];
      } else {
        dialog.properties[key] = value;
      }
    }

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

  return model;
}
