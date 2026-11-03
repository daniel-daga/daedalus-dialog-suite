/**
 * Named sub-stages (#325, docs/plans/quest-authoring.md phase 4): an
 * author-named flag or counter inside a running quest.
 *
 * A stage is a script-backed `STAGE_<QuestBase>_<Name>` int declared beside the
 * quest's `MIS_`, written by an ordinary `SetVariableAction`. That is the whole
 * point of the shape: the inventory is a prefix scan of the declared globals, so
 * a stage written in a file the editor never opened is still recognised, with no
 * index and no sidecar.
 */
import type { DialogAction, DialogCondition, SemanticModel } from '../../types/global';
import { getQuestMisVariableName, isCaseInsensitiveMatch } from '../../utils/questIdentity';
import { questNameFromTitle } from '../../utils/questLogFiles';
import { walkActionsWithPath, type QuestDiaryPath } from './questDiary';
import { getDialogContextForFunction, getFunctionFilePath } from './questGraphSharedHelpers';

export type QuestStageKind = 'flag' | 'counter';
export type QuestStageWriteKind = 'reached' | 'reset' | 'counts';
export type QuestStageReadKind = 'reached' | 'not_reached' | 'at_least';

/** A declared stage. */
export interface QuestStage {
  variable: string;
  /** The quest's `MIS_` base: `STAGE_VerloreneSchafe_Sheep` → `VerloreneSchafe`. */
  questBase: string;
  /** The quest's diary title, or its base name when `TOPIC_` is not declared. */
  questTitle: string;
  /** The stage's own name: `Sheep`. */
  name: string;
}

/** Where a stage is written or read, so the page can jump there. */
export interface QuestStageSite {
  functionName: string;
  filePath?: string;
  dialogName?: string;
  npc?: string;
}

export interface QuestStageWrite extends QuestStageSite {
  kind: QuestStageWriteKind;
  /** Where the line sits in the function's actions, through if/else branches. */
  path: QuestDiaryPath;
}

/** A stage read as the card shows it: quest, stage, and the form. */
export interface QuestStageRead {
  variable: string;
  kind: QuestStageReadKind;
  /** The N of an `at_least` read. */
  target?: number;
}

export interface QuestStageItem extends QuestStage {
  kind: QuestStageKind;
  writes: QuestStageWrite[];
  reads: QuestStageSite[];
  /** Largest N of a `>= N` / `== N` check of the stage, or null when nothing compares it. */
  target: number | null;
}

const STAGE_PREFIX = /^stage_/i;
const STAGE_NAME = /^stage_./i;
/** `STAGE_` alone: the Set Stage card before it is given a stage. */
export const STAGE_PLACEHOLDER = /^stage_?$/i;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const variableNames = (variables: Record<string, unknown> | undefined) => Object.keys(variables ?? {});

/** The identifier a stage title gets: "Talked to Greg" → `STAGE_X_TalkedToGreg`. */
export function stageVariableName(questBase: string, title: string): string {
  return `STAGE_${questBase}_${questNameFromTitle(title)}`;
}

function questTitleOf(constants: Record<string, { value?: unknown }> | undefined, questBase: string): string {
  const entry = Object.entries(constants ?? {}).find(([name]) => isCaseInsensitiveMatch(name, `TOPIC_${questBase}`));
  const value = entry?.[1]?.value;
  return typeof value === 'string' && value ? value : questBase;
}

/**
 * A stage's quest is the longest prefix that the project declares a `MIS_` for,
 * so `STAGE_A_B_C` under `MIS_A_B` belongs to quest `A_B`, stage `C`.
 */
function splitStage(variable: string, variables: Record<string, unknown> | undefined): { questBase: string; name: string } {
  const parts = variable.replace(STAGE_PREFIX, '').split('_');
  for (let take = parts.length - 1; take >= 1; take--) {
    const questBase = parts.slice(0, take).join('_');
    if (variableNames(variables).some((name) => isCaseInsensitiveMatch(name, `MIS_${questBase}`))) {
      return { questBase, name: parts.slice(take).join('_') };
    }
  }
  // A stage on a quest with no `MIS_`: the first segment is the base it was meant for.
  return { questBase: parts[0], name: parts.slice(1).join('_') };
}

/** Every `STAGE_` variable the project declares. */
export function declaredStages(
  model: Pick<SemanticModel, 'variables' | 'constants'>
): QuestStage[] {
  return variableNames(model.variables)
    .filter((name) => STAGE_PREFIX.test(name))
    .map((variable) => {
      const { questBase, name } = splitStage(variable, model.variables);
      return { variable, questBase, questTitle: questTitleOf(model.constants, questBase), name };
    });
}

/** The declared stage `variable` names, or null when nothing declares it. */
export function findDeclaredStage(
  model: Pick<SemanticModel, 'variables' | 'constants'>,
  variable: string
): QuestStage | null {
  return declaredStages(model).find((stage) => isCaseInsensitiveMatch(stage.variable, variable)) ?? null;
}

/** The declared global `variable` would collide with, or null. */
export function stageNameCollision(model: SemanticModel, variable: string): string | null {
  const declared = [
    ...variableNames(model.variables),
    ...Object.keys(model.constants ?? {}),
    ...Object.keys(model.instances ?? {})
  ];
  return declared.find((name) => isCaseInsensitiveMatch(name, variable)) ?? null;
}

/**
 * The write that reaches, resets (a flag) or counts up a stage. Daedalus has no
 * compound assignment, so a counter is `X = X + 1`.
 */
export function buildStageWrite(variable: string, kind: QuestStageWriteKind): DialogAction {
  const value = kind === 'counts' ? `${variable} + 1` : kind === 'reset' ? 'FALSE' : 'TRUE';
  return { type: 'SetVariableAction', variableName: variable, operator: '=', value } as DialogAction;
}

/**
 * The stage write `action` is, or null when it is an ordinary Set Variable.
 * Only a `STAGE_`-shaped name is a stage; `STAGE_` alone is the Set Stage card
 * before a stage is picked. Whether the stage is *declared* is the caller's
 * question — the variable list is the project's, not this module's.
 */
export function recognizeStageWrite(action: DialogAction): { variable: string; kind: QuestStageWriteKind } | null {
  const a = action as unknown as Record<string, unknown>;
  if (a.type !== 'SetVariableAction' || a.operator !== '=') return null;
  const variable = String(a.variableName ?? '').trim();
  if (!STAGE_NAME.test(variable) && !STAGE_PLACEHOLDER.test(variable)) return null;
  const value = String(a.value ?? '').trim();
  if (/^true$/i.test(value)) return { variable, kind: 'reached' };
  if (/^false$/i.test(value)) return { variable, kind: 'reset' };
  // The parser hands `STAGE_X = STAGE_X + 1` back as text, so this reads what
  // was written without parsing an expression.
  if (new RegExp(`^${escapeRegExp(variable)}\\s*\\+\\s*\\d+$`, 'i').test(value)) return { variable, kind: 'counts' };
  return null;
}

/** The write as Daedalus, for the card's "show script" view. */
export function stageWriteScript(action: DialogAction): string {
  const a = action as unknown as Record<string, unknown>;
  return `${a.variableName} ${a.operator} ${a.value};`;
}

const isBoolean = (value: unknown, text: string) => new RegExp(`^${text}$`, 'i').test(String(value ?? '').trim());

/**
 * The stage read `condition` is, or null when it is anything else. Only a
 * declared stage counts, so a `STAGE_` name nobody declares stays a plain
 * variable check — and only the three forms the card writes back, because
 * rewriting a check it cannot express would change what the script says.
 */
export function recognizeStageRead(condition: DialogCondition, stages: QuestStage[]): QuestStageRead | null {
  const c = condition as unknown as Record<string, unknown>;
  if (c.type !== 'VariableCondition' || c.negated) return null;
  const variable = String(c.variableName ?? '').trim();
  // `STAGE_` alone is the Stage card before a stage is picked, as on the write side.
  if (!STAGE_PLACEHOLDER.test(variable) && !stages.some((stage) => isCaseInsensitiveMatch(stage.variable, variable))) {
    return null;
  }
  if (c.operator === '==') {
    if (isBoolean(c.value, 'true')) return { variable, kind: 'reached' };
    if (isBoolean(c.value, 'false')) return { variable, kind: 'not_reached' };
    return null;
  }
  if (c.operator !== '>=') return null;
  const value = String(c.value ?? '').trim();
  return /^\d+$/.test(value) ? { variable, kind: 'at_least', target: Number(value) } : null;
}

/**
 * The condition that checks a stage read. "Not reached" is `== FALSE` because
 * an unset int is 0, matching "not started" on the quest state card.
 */
export function buildStageRead(variable: string, kind: QuestStageReadKind, target = 1): DialogCondition {
  const [operator, value] = kind === 'at_least'
    ? ['>=', target]
    : ['==', kind === 'reached' ? 'TRUE' : 'FALSE'];
  return { type: 'VariableCondition', variableName: variable, negated: false, operator, value } as DialogCondition;
}

/** The read as Daedalus, for the card's "show script" view. */
export function stageReadScript({ variable, kind, target }: QuestStageRead): string {
  const c = buildStageRead(variable || 'STAGE_?', kind, target) as unknown as Record<string, unknown>;
  return `${c.variableName} ${c.operator} ${c.value}`;
}

/**
 * The quest page's Stages section: its declared stages, what writes each with
 * where it is so it can be jumped to, what reads each the same way, and — for a
 * counter — the target its `>= N` / `== N` checks give it.
 */
export function buildQuestStages(model: SemanticModel, questName: string): QuestStageItem[] {
  const questBase = getQuestMisVariableName(questName).replace(/^mis_/i, '');
  const belongs = new RegExp(`^STAGE_${escapeRegExp(questBase)}_`, 'i');

  const writes = new Map<string, QuestStageWrite[]>();
  const reads = new Map<string, QuestStageSite[]>();
  const targets = new Map<string, number>();

  for (const func of Object.values(model.functions ?? {})) {
    const context = getDialogContextForFunction(func.name, model);
    const filePath = getFunctionFilePath(func);
    const site = {
      functionName: func.name,
      ...(filePath ? { filePath } : {}),
      ...(context.dialogName ? { dialogName: context.dialogName, npc: context.npc } : {})
    };

    walkActionsWithPath(func.actions, (action, path) => {
      const write = recognizeStageWrite(action);
      if (!write?.variable || !belongs.test(write.variable)) return;
      const key = write.variable.toLowerCase();
      writes.set(key, [...(writes.get(key) ?? []), { kind: write.kind, path, ...site }]);
    });

    for (const condition of func.conditions ?? []) {
      const c = condition as unknown as Record<string, unknown>;
      if (c.type !== 'VariableCondition') continue;
      const variable = String(c.variableName ?? '');
      if (!belongs.test(variable)) continue;
      const key = variable.toLowerCase();
      reads.set(key, [...(reads.get(key) ?? []), site]);
      if (c.operator !== '>=' && c.operator !== '==') continue;
      const target = Number(c.value);
      if (Number.isFinite(target)) targets.set(key, Math.max(targets.get(key) ?? 0, target));
    }
  }

  return variableNames(model.variables)
    .filter((variable) => belongs.test(variable))
    .map((variable) => {
      const key = variable.toLowerCase();
      const stageWrites = writes.get(key) ?? [];
      const target = targets.get(key) ?? null;
      return {
        variable,
        questBase,
        questTitle: questTitleOf(model.constants, questBase),
        name: variable.replace(belongs, ''),
        // Anything counted or compared against a number is a counter; a flag is
        // only ever written TRUE/FALSE.
        kind: stageWrites.some((write) => write.kind === 'counts') || target !== null ? 'counter' : 'flag',
        writes: stageWrites,
        reads: reads.get(key) ?? [],
        target
      } as QuestStageItem;
    });
}
