/**
 * NPC action classes.
 *
 * Contains action types that operate on NPCs: combat, attitudes, routines,
 * animations, pickpocketing, teaching, and world-insertion.
 */

import type { CodeGenOptions, CodeGeneratable } from './semanticModelInterfaces';

export class AttackAction implements CodeGeneratable {
  public readonly type = 'AttackAction';
  public attacker: string;
  public target: string;
  public attackReason: string;
  public damage: number | string;

  constructor(attacker: string, target: string, attackReason: string, damage: number | string) {
    this.attacker = attacker;
    this.target = target;
    this.attackReason = attackReason;
    this.damage = damage;
  }

  generateCode(_options: CodeGenOptions): string {
    return `B_Attack (${this.attacker}, ${this.target}, ${this.attackReason}, ${this.damage});`;
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
    return `B_SetAttitude (${this.target}, ${this.attitude});`;
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
  /** True when the source routine argument was not a string literal. */
  public routineIsExpression?: boolean;

  constructor(target: string, routine: string, routineIsExpression?: boolean) {
    this.target = target;
    this.routine = routine;
    if (routineIsExpression !== undefined) {
      this.routineIsExpression = routineIsExpression;
    }
  }

  generateCode(_options: CodeGenOptions): string {
    const routine = this.routineIsExpression ? this.routine : `"${this.routine}"`;
    return `Npc_ExchangeRoutine (${this.target}, ${routine});`;
  }

  toDisplayString(): string {
    return `[ExchangeRoutine: ${this.target} -> "${this.routine}"]`;
  }

  getTypeName(): string {
    return 'ExchangeRoutineAction';
  }
}

export class StopProcessInfosAction implements CodeGeneratable {
  public readonly type = 'StopProcessInfosAction';
  public target: string;

  constructor(target: string = 'self') {
    this.target = target;
  }

  generateCode(_options: CodeGenOptions): string {
    return `AI_StopProcessInfos (${this.target});`;
  }

  toDisplayString(): string {
    return `[StopProcessInfos: ${this.target}]`;
  }

  getTypeName(): string {
    return 'StopProcessInfosAction';
  }
}

export class SetRefuseTalkAction implements CodeGeneratable {
  public readonly type = 'SetRefuseTalkAction';
  public target: string;
  public seconds: number | string;

  constructor(target: string = 'self', seconds: number | string = 300) {
    this.target = target;
    this.seconds = seconds;
  }

  generateCode(_options: CodeGenOptions): string {
    return `Npc_SetRefuseTalk (${this.target}, ${this.seconds});`;
  }

  toDisplayString(): string {
    return `[SetRefuseTalk: ${this.target} for ${this.seconds}s]`;
  }

  getTypeName(): string {
    return 'SetRefuseTalkAction';
  }
}

export class PlayAniAction implements CodeGeneratable {
  public readonly type = 'PlayAniAction';
  public target: string;
  public animationName: string;
  /** True when the source animation argument was not a string literal. */
  public animationNameIsExpression?: boolean;

  constructor(target: string, animationName: string, animationNameIsExpression?: boolean) {
    this.target = target;
    this.animationName = animationName;
    if (animationNameIsExpression !== undefined) {
      this.animationNameIsExpression = animationNameIsExpression;
    }
  }

  generateCode(_options: CodeGenOptions): string {
    const animationName = this.animationNameIsExpression ? this.animationName : `"${this.animationName}"`;
    return `AI_PlayAni (${this.target}, ${animationName});`;
  }

  toDisplayString(): string {
    return `[PlayAni: ${this.target} -> "${this.animationName}"]`;
  }

  getTypeName(): string {
    return 'PlayAniAction';
  }
}

export class PickpocketAction implements CodeGeneratable {
  public readonly type = 'PickpocketAction';
  public pickpocketMode: 'B_Beklauen' | 'C_Beklauen';
  /** Original source casing of the call (e.g. `b_beklauen`) for fidelity. */
  public sourceFunctionName?: string;
  /** Raw source arguments, emitted verbatim when present. */
  public pickpocketArgs?: string[];
  public minChance?: string;
  public maxChance?: string;

  constructor(
    mode: 'B_Beklauen' | 'C_Beklauen',
    minChance?: string,
    maxChance?: string,
    sourceFunctionName?: string,
    pickpocketArgs?: string[]
  ) {
    this.pickpocketMode = mode;
    if (minChance !== undefined) {
      this.minChance = minChance;
    }
    if (maxChance !== undefined) {
      this.maxChance = maxChance;
    }
    if (sourceFunctionName !== undefined) {
      this.sourceFunctionName = sourceFunctionName;
    }
    if (pickpocketArgs !== undefined) {
      this.pickpocketArgs = pickpocketArgs;
    }
  }

  generateCode(_options: CodeGenOptions): string {
    // Emit the original source casing when known so a case-drifted call
    // (e.g. `b_beklauen`) roundtrips; fall back to the canonical mode name.
    const name = this.sourceFunctionName ?? this.pickpocketMode;

    if (this.pickpocketArgs !== undefined) {
      return `${name} (${this.pickpocketArgs.join(', ')});`;
    }

    if (this.pickpocketMode === 'B_Beklauen') {
      return `${name} ();`;
    }

    const min = this.minChance || '0';
    const max = this.maxChance || min;
    return `${name} (${min}, ${max});`;
  }

  toDisplayString(): string {
    if (this.pickpocketMode === 'B_Beklauen') {
      return '[Pickpocket: execute]';
    }
    return `[Pickpocket: check ${this.minChance || '0'}-${this.maxChance || this.minChance || '0'}]`;
  }

  getTypeName(): string {
    return 'PickpocketAction';
  }
}

export class StartOtherRoutineAction implements CodeGeneratable {
  public readonly type = 'StartOtherRoutineAction';
  public routineFunctionName: 'B_StartOtherRoutine' | 'B_StartotherRoutine';
  public routineNpc: string;
  public routineName: string;
  /** True when the source routine-name argument was not a string literal. */
  public routineNameIsExpression?: boolean;

  constructor(
    routineFunctionName: 'B_StartOtherRoutine' | 'B_StartotherRoutine',
    routineNpc: string,
    routineName: string,
    routineNameIsExpression?: boolean
  ) {
    this.routineFunctionName = routineFunctionName;
    this.routineNpc = routineNpc;
    this.routineName = routineName;
    if (routineNameIsExpression !== undefined) {
      this.routineNameIsExpression = routineNameIsExpression;
    }
  }

  generateCode(_options: CodeGenOptions): string {
    const routineName = this.routineNameIsExpression ? this.routineName : `"${this.routineName}"`;
    return `${this.routineFunctionName} (${this.routineNpc}, ${routineName});`;
  }

  toDisplayString(): string {
    return `[StartOtherRoutine: ${this.routineNpc} -> "${this.routineName}"]`;
  }

  getTypeName(): string {
    return 'StartOtherRoutineAction';
  }
}

export class TeachAction implements CodeGeneratable {
  public readonly type = 'TeachAction';
  public teachFunctionName: string;
  public teachArgs: string[];

  constructor(teachFunctionName: string, teachArgs: string[]) {
    this.teachFunctionName = teachFunctionName;
    this.teachArgs = teachArgs;
  }

  generateCode(_options: CodeGenOptions): string {
    return `${this.teachFunctionName} (${this.teachArgs.join(', ')});`;
  }

  toDisplayString(): string {
    return `[Teach: ${this.teachFunctionName} (${this.teachArgs.join(', ')})]`;
  }

  getTypeName(): string {
    return 'TeachAction';
  }
}

export class InsertNpcAction implements CodeGeneratable {
  public readonly type = 'InsertNpcAction';
  public npcInstance: string;
  public spawnPoint: string;
  /** True when the source spawn-point argument was not a string literal. */
  public spawnPointIsExpression?: boolean;

  constructor(npcInstance: string, spawnPoint: string, spawnPointIsExpression?: boolean) {
    this.npcInstance = npcInstance;
    this.spawnPoint = spawnPoint;
    if (spawnPointIsExpression !== undefined) {
      this.spawnPointIsExpression = spawnPointIsExpression;
    }
  }

  generateCode(_options: CodeGenOptions): string {
    const spawnPoint = this.spawnPointIsExpression ? this.spawnPoint : `"${this.spawnPoint}"`;
    return `Wld_InsertNpc (${this.npcInstance}, ${spawnPoint});`;
  }

  toDisplayString(): string {
    return `[InsertNpc: ${this.npcInstance} @ "${this.spawnPoint}"]`;
  }

  getTypeName(): string {
    return 'InsertNpcAction';
  }
}

export class HeroFollowsAction implements CodeGeneratable {
  public readonly type = 'HeroFollowsAction';
  public guideRoutine: string;
  /** True when the guide-routine argument should be emitted without quotes. */
  public guideRoutineIsExpression?: boolean;

  constructor(guideRoutine: string = '', guideRoutineIsExpression?: boolean) {
    this.guideRoutine = guideRoutine;
    if (guideRoutineIsExpression !== undefined) {
      this.guideRoutineIsExpression = guideRoutineIsExpression;
    }
  }

  generateCode(_options: CodeGenOptions): string {
    const guideRoutine = this.guideRoutineIsExpression ? this.guideRoutine : `"${this.guideRoutine}"`;
    return [
      `AI_StopProcessInfos (self);`,
      `self.aivar[AIV_PARTYMEMBER] = TRUE;`,
      `Npc_ExchangeRoutine (self, ${guideRoutine});`
    ].join('\n');
  }

  toDisplayString(): string {
    return `[HeroFollows: routine="${this.guideRoutine}"]`;
  }

  getTypeName(): string {
    return 'HeroFollowsAction';
  }
}
