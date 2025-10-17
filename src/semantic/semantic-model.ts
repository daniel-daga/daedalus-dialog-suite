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
}

// ===================================================================
// SEMANTIC MODEL CLASSES
// ===================================================================

export interface DialogProperties {
  [key: string]: string | number | boolean | DialogFunction;
}

export class DialogFunction {
  public name: string;
  public returnType: string;
  public calls: string[];
  public actions: DialogAction[];
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
  public speaker: string;
  public text: string;
  public id: string;

  constructor(speaker: string, text: string, id: string) {
    this.speaker = speaker;
    this.text = text;
    this.id = id;
  }

  generateCode(options: CodeGenOptions): string {
    const comment = options.includeComments ? ` //${this.text}` : '';
    return `AI_Output(${this.speaker}, other, "${this.id}");${comment}`;
  }

  toDisplayString(): string {
    return `[DialogLine: ${this.speaker} -> "${this.text}"]`;
  }

  getTypeName(): string {
    return 'DialogLine';
  }
}

export class CreateTopic implements CodeGeneratable {
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

export type DialogAction = DialogLine | CreateTopic | LogEntry | LogSetTopicStatus | Action | Choice | CreateInventoryItems | GiveInventoryItems | AttackAction | SetAttitudeAction | ExchangeRoutineAction | ChapterTransitionAction;

// ===================================================================
// DIALOG CONDITION CLASSES
// ===================================================================

/**
 * Represents a condition that checks if the player knows a specific dialog
 */
export class NpcKnowsInfoCondition implements CodeGeneratable {
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
  public variableName: string;
  public negated: boolean;

  constructor(variableName: string, negated: boolean = false) {
    this.variableName = variableName;
    this.negated = negated;
  }

  generateCode(_options: CodeGenOptions): string {
    return this.negated ? `!${this.variableName}` : this.variableName;
  }

  toDisplayString(): string {
    return this.negated ? `[Not: ${this.variableName}]` : `[Variable: ${this.variableName}]`;
  }

  getTypeName(): string {
    return 'VariableCondition';
  }
}

export type DialogCondition = NpcKnowsInfoCondition | Condition | VariableCondition;

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
  errors?: SyntaxError[];
  hasErrors?: boolean;
}