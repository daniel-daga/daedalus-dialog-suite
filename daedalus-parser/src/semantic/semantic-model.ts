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

export class GlobalConstant {
  public name: string;
  public type: string;
  public value: string | number | boolean;

  constructor(name: string, type: string, value: string | number | boolean) {
    this.name = name;
    this.type = type;
    this.value = value;
  }

  static fromJSON(json: any): GlobalConstant {
    return new GlobalConstant(json.name, json.type, json.value);
  }
}

export class GlobalVariable {
  public name: string;
  public type: string;

  constructor(name: string, type: string) {
    this.name = name;
    this.type = type;
  }

  static fromJSON(json: any): GlobalVariable {
    return new GlobalVariable(json.name, json.type);
  }
}

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

  static fromJSON(json: any): DialogFunction {
    const func = new DialogFunction(json.name, json.returnType);
    func.calls = json.calls || [];
    func.actions = (json.actions || []).map((action: any) => deserializeAction(action));
    func.conditions = (json.conditions || []).map((condition: any) => deserializeCondition(condition));
    return func;
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

  static fromJSON(json: any): DialogLine {
    return new DialogLine(json.speaker, json.text, json.id);
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

  static fromJSON(json: any): CreateTopic {
    return new CreateTopic(json.topic, json.topicType);
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

  static fromJSON(json: any): LogEntry {
    return new LogEntry(json.topic, json.text);
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

  static fromJSON(json: any): LogSetTopicStatus {
    return new LogSetTopicStatus(json.topic, json.status);
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

  static fromJSON(json: any): Action {
    return new Action(json.action);
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

  static fromJSON(json: any): Choice {
    return new Choice(json.dialogRef, json.text, json.targetFunction);
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

  static fromJSON(json: any): CreateInventoryItems {
    return new CreateInventoryItems(json.target, json.item, json.quantity);
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

  static fromJSON(json: any): GiveInventoryItems {
    return new GiveInventoryItems(json.giver, json.receiver, json.item, json.quantity);
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

  static fromJSON(json: any): AttackAction {
    return new AttackAction(json.attacker, json.target, json.attackReason, json.damage);
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

  static fromJSON(json: any): SetAttitudeAction {
    return new SetAttitudeAction(json.target, json.attitude);
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

  static fromJSON(json: any): ExchangeRoutineAction {
    return new ExchangeRoutineAction(json.target, json.routine);
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

  static fromJSON(json: any): ChapterTransitionAction {
    return new ChapterTransitionAction(json.chapter, json.world);
  }
}

export type DialogAction = DialogLine | CreateTopic | LogEntry | LogSetTopicStatus | Action | Choice | CreateInventoryItems | GiveInventoryItems | AttackAction | SetAttitudeAction | ExchangeRoutineAction | ChapterTransitionAction;

// Helper to deserialize any action
export function deserializeAction(json: any): DialogAction | any {
  if ('speaker' in json && 'text' in json && 'id' in json) {
    return DialogLine.fromJSON(json);
  } else if ('topic' in json && 'topicType' in json) {
    return CreateTopic.fromJSON(json);
  } else if ('topic' in json && 'text' in json) {
    return LogEntry.fromJSON(json);
  } else if ('topic' in json && 'status' in json) {
    return LogSetTopicStatus.fromJSON(json);
  } else if ('dialogRef' in json && 'targetFunction' in json) {
    return Choice.fromJSON(json);
  } else if ('target' in json && 'item' in json && 'quantity' in json && !('giver' in json)) {
    return CreateInventoryItems.fromJSON(json);
  } else if ('giver' in json && 'receiver' in json) {
    return GiveInventoryItems.fromJSON(json);
  } else if ('attacker' in json && 'attackReason' in json) {
    return AttackAction.fromJSON(json);
  } else if ('attitude' in json) {
    return SetAttitudeAction.fromJSON(json);
  } else if ('routine' in json) {
    return ExchangeRoutineAction.fromJSON(json);
  } else if ('chapter' in json && 'world' in json) {
    return ChapterTransitionAction.fromJSON(json);
  } else if ('action' in json) {
    return Action.fromJSON(json);
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

  static fromJSON(json: any): NpcKnowsInfoCondition {
    return new NpcKnowsInfoCondition(json.npc, json.dialogRef);
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

  static fromJSON(json: any): Condition {
    return new Condition(json.condition);
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

  static fromJSON(json: any): VariableCondition {
    return new VariableCondition(json.variableName, json.negated || false);
  }
}

export type DialogCondition = NpcKnowsInfoCondition | Condition | VariableCondition;

// Helper to deserialize any condition
export function deserializeCondition(json: any): DialogCondition {
  if ('npc' in json && 'dialogRef' in json) {
    return NpcKnowsInfoCondition.fromJSON(json);
  } else if ('variableName' in json) {
    return VariableCondition.fromJSON(json);
  } else if ('condition' in json) {
    return Condition.fromJSON(json);
  }
  // Fallback
  return new Condition('');
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
    constants: {},
    variables: {},
    errors: json.errors,
    hasErrors: json.hasErrors
  };

  // 1. Reconstruct functions first
  for (const funcName in json.functions) {
    model.functions[funcName] = DialogFunction.fromJSON(json.functions[funcName]);
  }

  // 2. Reconstruct dialogs and link to functions
  for (const dialogName in json.dialogs) {
    model.dialogs[dialogName] = Dialog.fromJSON(json.dialogs[dialogName], model.functions);
  }

  // 3. Reconstruct constants
  if (json.constants) {
    for (const key in json.constants) {
      model.constants![key] = GlobalConstant.fromJSON(json.constants[key]);
    }
  }

  // 4. Reconstruct variables
  if (json.variables) {
    for (const key in json.variables) {
      model.variables![key] = GlobalVariable.fromJSON(json.variables[key]);
    }
  }

  return model;
}