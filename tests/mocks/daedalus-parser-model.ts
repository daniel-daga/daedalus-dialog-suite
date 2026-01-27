export class Dialog {
  constructor(public name: string, public parent: string | null) {
    this.properties = {};
  }
  public properties: Record<string, any>;
}

export class DialogFunction {
  constructor(public name: string, public returnType: string) {
    this.calls = [];
    this.actions = [];
    this.conditions = [];
  }
  public calls: any[];
  public actions: any[];
  public conditions: any[];
}

export class DialogLine {
  constructor(public speaker: string, public text: string, public id: string) {}
}

export class CreateTopic { constructor(public topic: any, public topicType: any) {} }
export class LogEntry { constructor(public topic: any, public text: any) {} }
export class LogSetTopicStatus { constructor(public topic: any, public status: any) {} }
export class Action { constructor(public action: any) {} }
export class Choice { constructor(public dialogRef: any, public text: any, public targetFunction: any) {} }
export class CreateInventoryItems { constructor(public target: any, public item: any, public quantity: any) {} }
export class GiveInventoryItems { constructor(public giver: any, public receiver: any, public item: any, public quantity: any) {} }
export class AttackAction { constructor(public attacker: any, public target: any, public attackReason: any, public damage: any) {} }
export class SetAttitudeAction { constructor(public target: any, public attitude: any) {} }
export class ExchangeRoutineAction { constructor(public target: any, public routine: any) {} }
export class ChapterTransitionAction { constructor(public chapter: any, public world: any) {} }
export class NpcKnowsInfoCondition { constructor(public npc: any, public dialogRef: any) {} }
export class VariableCondition { constructor(public variableName: any, public negated: any) {} }
export class Condition { constructor(public condition: any) {} }

export type SemanticModel = {
  dialogs: Record<string, Dialog>;
  functions: Record<string, DialogFunction>;
};

export type DialogCondition = NpcKnowsInfoCondition | VariableCondition | Condition;
