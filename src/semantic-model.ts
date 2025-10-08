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
  nextSibling: TreeSitterNode | null;
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

  constructor(name: string, returnType: string) {
    this.name = name;
    this.returnType = returnType;
    this.calls = [];
    this.actions = [];
  }
}

// ===================================================================
// DIALOG ACTION CLASSES
// ===================================================================

export class DialogLine {
  public speaker: string;
  public text: string;
  public id: string;

  constructor(speaker: string, text: string, id: string) {
    this.speaker = speaker;
    this.text = text;
    this.id = id;
  }
}

export class CreateTopic {
  public topic: string;
  public topicType: string | null;

  constructor(topic: string, topicType: string | null = null) {
    this.topic = topic;
    this.topicType = topicType;
  }
}

export class LogEntry {
  public topic: string;
  public text: string;

  constructor(topic: string, text: string) {
    this.topic = topic;
    this.text = text;
  }
}

export class LogSetTopicStatus {
  public topic: string;
  public status: string;

  constructor(topic: string, status: string) {
    this.topic = topic;
    this.status = status;
  }
}

export class Action {
  public action: string;

  constructor(action: string) {
    this.action = action;
  }
}

export class Choice {
  public dialogRef: string;
  public text: string;
  public targetFunction: string;

  constructor(dialogRef: string, text: string, targetFunction: string) {
    this.dialogRef = dialogRef;
    this.text = text;
    this.targetFunction = targetFunction;
  }
}

export class CreateInventoryItems {
  public target: string;
  public item: string;
  public quantity: number;

  constructor(target: string, item: string, quantity: number) {
    this.target = target;
    this.item = item;
    this.quantity = quantity;
  }
}

export class GiveInventoryItems {
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
}

export class AttackAction {
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
}

export class SetAttitudeAction {
  public target: string;
  public attitude: string;

  constructor(target: string, attitude: string) {
    this.target = target;
    this.attitude = attitude;
  }
}

export class ExchangeRoutineAction {
  public target: string;
  public routine: string;

  constructor(target: string, routine: string) {
    this.target = target;
    this.routine = routine;
  }
}

export class ChapterTransitionAction {
  public chapter: number;
  public world: string;

  constructor(chapter: number, world: string) {
    this.chapter = chapter;
    this.world = world;
  }
}

export type DialogAction = DialogLine | CreateTopic | LogEntry | LogSetTopicStatus | Action | Choice | CreateInventoryItems | GiveInventoryItems | AttackAction | SetAttitudeAction | ExchangeRoutineAction | ChapterTransitionAction;

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

export interface SemanticModel {
  dialogs: { [key: string]: Dialog };
  functions: { [key: string]: DialogFunction };
}