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
  public damage: number;

  constructor(attacker: string, target: string, attackReason: string, damage: number) {
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

  constructor(target: string, routine: string) {
    this.target = target;
    this.routine = routine;
  }

  generateCode(_options: CodeGenOptions): string {
    return `Npc_ExchangeRoutine (${this.target}, "${this.routine}");`;
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

export class PlayAniAction implements CodeGeneratable {
  public readonly type = 'PlayAniAction';
  public target: string;
  public animationName: string;

  constructor(target: string, animationName: string) {
    this.target = target;
    this.animationName = animationName;
  }

  generateCode(_options: CodeGenOptions): string {
    return `AI_PlayAni (${this.target}, "${this.animationName}");`;
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
  public minChance?: string;
  public maxChance?: string;

  constructor(mode: 'B_Beklauen' | 'C_Beklauen', minChance?: string, maxChance?: string) {
    this.pickpocketMode = mode;
    if (minChance !== undefined) {
      this.minChance = minChance;
    }
    if (maxChance !== undefined) {
      this.maxChance = maxChance;
    }
  }

  generateCode(_options: CodeGenOptions): string {
    if (this.pickpocketMode === 'B_Beklauen') {
      return 'B_Beklauen ();';
    }

    const min = this.minChance || '0';
    const max = this.maxChance || min;
    return `C_Beklauen (${min}, ${max});`;
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

  constructor(
    routineFunctionName: 'B_StartOtherRoutine' | 'B_StartotherRoutine',
    routineNpc: string,
    routineName: string
  ) {
    this.routineFunctionName = routineFunctionName;
    this.routineNpc = routineNpc;
    this.routineName = routineName;
  }

  generateCode(_options: CodeGenOptions): string {
    return `${this.routineFunctionName} (${this.routineNpc}, "${this.routineName}");`;
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

  constructor(npcInstance: string, spawnPoint: string) {
    this.npcInstance = npcInstance;
    this.spawnPoint = spawnPoint;
  }

  generateCode(_options: CodeGenOptions): string {
    return `Wld_InsertNpc (${this.npcInstance}, "${this.spawnPoint}");`;
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

  constructor(guideRoutine: string = '') {
    this.guideRoutine = guideRoutine;
  }

  generateCode(_options: CodeGenOptions): string {
    return [
      `AI_StopProcessInfos (self);`,
      `self.aivar[AIV_PARTYMEMBER] = TRUE;`,
      `Npc_ExchangeRoutine (self, "${this.guideRoutine}");`
    ].join('\n');
  }

  toDisplayString(): string {
    return `[HeroFollows: routine="${this.guideRoutine}"]`;
  }

  getTypeName(): string {
    return 'HeroFollowsAction';
  }
}
