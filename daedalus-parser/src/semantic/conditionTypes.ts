/**
 * Dialog condition classes and the DialogCondition union type.
 *
 * Each condition class implements CodeGeneratable so it can produce its own
 * Daedalus expression string.  The DialogCondition union covers every
 * structured condition the parser can emit.
 */

import type { CodeGenOptions, CodeGeneratable } from './semanticModelInterfaces';

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
 * Represents an Npc_HasItems condition, optionally with a comparison.
 */
export class NpcHasItemsCondition implements CodeGeneratable {
  public readonly type = 'NpcHasItemsCondition';
  public npc: string;
  public item: string;
  public operator?: string;
  public value?: string | number | boolean;

  constructor(npc: string, item: string, operator?: string, value?: string | number | boolean) {
    this.npc = npc;
    this.item = item;
    if (operator !== undefined) {
      this.operator = operator;
    }
    if (value !== undefined) {
      this.value = value;
    }
  }

  generateCode(_options: CodeGenOptions): string {
    const call = `Npc_HasItems(${this.npc}, ${this.item})`;
    if (this.operator && this.value !== undefined) {
      return `${call} ${this.operator} ${this.value}`;
    }
    return call;
  }

  toDisplayString(): string {
    if (this.operator && this.value !== undefined) {
      return `[NpcHasItems: ${this.npc}, ${this.item} ${this.operator} ${this.value}]`;
    }
    return `[NpcHasItems: ${this.npc}, ${this.item}]`;
  }

  getTypeName(): string {
    return 'NpcHasItemsCondition';
  }
}

/**
 * Represents an Npc_IsInState condition, optionally negated.
 */
export class NpcIsInStateCondition implements CodeGeneratable {
  public readonly type = 'NpcIsInStateCondition';
  public npc: string;
  public state: string;
  public negated: boolean;

  constructor(npc: string, state: string, negated: boolean = false) {
    this.npc = npc;
    this.state = state;
    this.negated = negated;
  }

  generateCode(_options: CodeGenOptions): string {
    const call = `Npc_IsInState(${this.npc}, ${this.state})`;
    return this.negated ? `!${call}` : call;
  }

  toDisplayString(): string {
    return this.negated
      ? `[Not NpcIsInState: ${this.npc}, ${this.state}]`
      : `[NpcIsInState: ${this.npc}, ${this.state}]`;
  }

  getTypeName(): string {
    return 'NpcIsInStateCondition';
  }
}

/**
 * Represents an Npc_IsDead condition, optionally negated.
 */
export class NpcIsDeadCondition implements CodeGeneratable {
  public readonly type = 'NpcIsDeadCondition';
  public npc: string;
  public negated: boolean;

  constructor(npc: string, negated: boolean = false) {
    this.npc = npc;
    this.negated = negated;
  }

  generateCode(_options: CodeGenOptions): string {
    const call = `Npc_IsDead(${this.npc})`;
    return this.negated ? `!${call}` : call;
  }

  toDisplayString(): string {
    return this.negated
      ? `[Not NpcIsDead: ${this.npc}]`
      : `[NpcIsDead: ${this.npc}]`;
  }

  getTypeName(): string {
    return 'NpcIsDeadCondition';
  }
}

/**
 * Represents an Npc_GetDistToWP comparison condition.
 */
export class NpcGetDistToWpCondition implements CodeGeneratable {
  public readonly type = 'NpcGetDistToWpCondition';
  public npc: string;
  public waypoint: string;
  public operator?: string;
  public value?: string | number | boolean;

  constructor(npc: string, waypoint: string, operator?: string, value?: string | number | boolean) {
    this.npc = npc;
    this.waypoint = waypoint;
    if (operator !== undefined) {
      this.operator = operator;
    }
    if (value !== undefined) {
      this.value = value;
    }
  }

  generateCode(_options: CodeGenOptions): string {
    const call = `Npc_GetDistToWP(${this.npc}, ${this.waypoint})`;
    if (this.operator && this.value !== undefined) {
      return `${call} ${this.operator} ${this.value}`;
    }
    return call;
  }

  toDisplayString(): string {
    if (this.operator && this.value !== undefined) {
      return `[NpcGetDistToWP: ${this.npc}, ${this.waypoint} ${this.operator} ${this.value}]`;
    }
    return `[NpcGetDistToWP: ${this.npc}, ${this.waypoint}]`;
  }

  getTypeName(): string {
    return 'NpcGetDistToWpCondition';
  }
}

/**
 * Represents an Npc_GetTalentSkill condition, optionally with a comparison.
 */
export class NpcGetTalentSkillCondition implements CodeGeneratable {
  public readonly type = 'NpcGetTalentSkillCondition';
  public npc: string;
  public talent: string;
  public operator?: string;
  public value?: string | number | boolean;

  constructor(npc: string, talent: string, operator?: string, value?: string | number | boolean) {
    this.npc = npc;
    this.talent = talent;
    if (operator !== undefined) {
      this.operator = operator;
    }
    if (value !== undefined) {
      this.value = value;
    }
  }

  generateCode(_options: CodeGenOptions): string {
    const call = `Npc_GetTalentSkill(${this.npc}, ${this.talent})`;
    if (this.operator && this.value !== undefined) {
      return `${call} ${this.operator} ${this.value}`;
    }
    return call;
  }

  toDisplayString(): string {
    if (this.operator && this.value !== undefined) {
      return `[NpcGetTalentSkill: ${this.npc}, ${this.talent} ${this.operator} ${this.value}]`;
    }
    return `[NpcGetTalentSkill: ${this.npc}, ${this.talent}]`;
  }

  getTypeName(): string {
    return 'NpcGetTalentSkillCondition';
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

/**
 * Represents a quest state condition: checks if a quest MIS variable equals a given log state.
 * Generates: MIS_QuestName == LOG_RUNNING  (the if-wrapper is added by the code generator)
 */
export class QuestStateCondition implements CodeGeneratable {
  public readonly type = 'QuestStateCondition';
  public questVariable: string;
  public state: string;

  constructor(questVariable: string, state: string) {
    this.questVariable = questVariable;
    this.state = state;
  }

  generateCode(_options: CodeGenOptions): string {
    return `${this.questVariable} == ${this.state}`;
  }

  toDisplayString(): string {
    return `[QuestState: ${this.questVariable} == ${this.state}]`;
  }

  getTypeName(): string {
    return 'QuestStateCondition';
  }
}

export type DialogCondition =
  | NpcKnowsInfoCondition
  | NpcHasItemsCondition
  | NpcIsInStateCondition
  | NpcIsDeadCondition
  | NpcGetDistToWpCondition
  | NpcGetTalentSkillCondition
  | Condition
  | VariableCondition
  | QuestStateCondition;
