/**
 * Quest conditions (#323, docs/plans/quest-authoring.md phase 2): a
 * plain-language view over the vanilla `MIS_` checks — "Quest X is running"
 * rather than `MIS_X == LOG_RUNNING`.
 *
 * Like quest steps, this is a view, not a new condition type. The parser
 * hands a `MIS_X == LOG_…` check over as a VariableCondition, and that is what
 * the card writes back, so a recognised check saves as the same plain Gothic
 * code it was read from.
 */
import type { DialogCondition } from '../../types/global';

export const QUEST_CONDITION_STATES = ['running', 'success', 'failed', 'obsolete', 'not_started', 'not_running'] as const;
export type QuestConditionState = (typeof QUEST_CONDITION_STATES)[number];

export interface QuestCondition {
  /** The `MIS_` variable as written; empty while no quest is picked. */
  misVariable: string;
  state: QuestConditionState;
}

const MIS_PREFIX = /^mis_/i;

const LOG_CONSTANT: Record<'running' | 'success' | 'failed' | 'obsolete', string> = {
  running: 'LOG_RUNNING',
  success: 'LOG_SUCCESS',
  failed: 'LOG_FAILED',
  obsolete: 'LOG_OBSOLETE'
};

const stateOfConstant = (value: unknown): QuestConditionState | null => {
  const text = String(value).trim().toUpperCase();
  const found = Object.entries(LOG_CONSTANT).find(([, constant]) => constant === text);
  return found ? (found[0] as QuestConditionState) : null;
};

// An unset MIS_ variable is 0. Only 0: another number may be a counter.
const isNotStartedValue = (value: unknown) =>
  value === false || value === 0 || /^(false|0)$/i.test(String(value).trim());

/** The quest check this condition is, or null when it is anything else. */
export function recognizeQuestCondition(condition: DialogCondition): QuestCondition | null {
  const c = condition as unknown as Record<string, unknown>;
  if (c.type !== 'VariableCondition') return null;
  const misVariable = String(c.variableName ?? '');
  // Empty is a card whose quest has not been picked yet.
  if (misVariable && !MIS_PREFIX.test(misVariable)) return null;

  if (c.operator === undefined) {
    return c.negated && misVariable ? { misVariable, state: 'not_started' } : null;
  }
  if (c.negated) return null;
  const constantState = stateOfConstant(c.value);
  if (c.operator === '==') {
    if (constantState) return { misVariable, state: constantState };
    if (isNotStartedValue(c.value)) return { misVariable, state: 'not_started' };
  }
  if (c.operator === '!=' && constantState === 'running') return { misVariable, state: 'not_running' };
  return null;
}

/** The VariableCondition that checks `state`. */
export function buildQuestCondition(misVariable: string, state: QuestConditionState): DialogCondition {
  const [operator, value] = state === 'not_started'
    ? ['==', 'FALSE']
    : state === 'not_running'
      ? ['!=', LOG_CONSTANT.running]
      : ['==', LOG_CONSTANT[state]];
  return { type: 'VariableCondition', variableName: misVariable, negated: false, operator, value } as DialogCondition;
}

/** The check as Daedalus, for the card's "show script" view. */
export function questConditionScript({ misVariable, state }: QuestCondition): string {
  const c = buildQuestCondition(misVariable || 'MIS_?', state) as unknown as Record<string, string>;
  return `${c.variableName} ${c.operator} ${c.value}`;
}
