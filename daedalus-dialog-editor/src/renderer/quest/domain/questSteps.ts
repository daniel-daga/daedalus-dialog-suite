/**
 * Quest steps (#322, docs/plans/quest-authoring.md): a quest-level view over
 * the vanilla lines that start, log, end or note a quest.
 *
 * A step is not a new action type. It is a contiguous run of existing actions
 * in one action list — `Log_CreateTopic`, `Log_SetTopicStatus`, `B_LogEntry`,
 * `MIS_X = LOG_…` and a trailing `B_GivePlayerXP` — that the recogniser folds
 * into one card. The lines stay in the model as they are, so a file saves
 * byte-for-byte unless a step is edited, and a run the recogniser does not
 * match simply stays as raw cards.
 */
import type { DialogAction } from '../../types/global';
import {
  getCanonicalQuestKey,
  getQuestMisVariableName,
  normalizeQuestLifecycleState,
  type QuestLifecycleState
} from '../../utils/questIdentity';

export type QuestStepKind = 'start' | 'entry' | 'complete' | 'fail' | 'cancel' | 'note';

/** Absolute indices of the lines a step is made of; absent means not written. */
export interface QuestStepIndices {
  create?: number;
  status?: number;
  mis?: number;
  entry?: number;
  xp?: number;
}

export interface QuestStep {
  kind: QuestStepKind;
  /** The `TOPIC_` name as written, or derived from `MIS_` when no topic line is present. */
  topic: string;
  /** The `MIS_` name as written, or derived from the topic. */
  misVariable: string;
  /** First action of the run. */
  start: number;
  /** One past the last action of the run. */
  end: number;
  indices: QuestStepIndices;
  text?: string;
  xp?: string;
}

type Slot = keyof QuestStepIndices;

interface Part {
  slot: Slot;
  /** Canonical quest key (lowercased topic base name); absent for XP. */
  key?: string;
  /** Lifecycle state the line sets; create means running. */
  state?: QuestLifecycleState;
  topic?: string;
  misVariable?: string;
  isNote?: boolean;
  text?: string;
  xp?: string;
}

const TOPIC_PREFIX = /^topic_/i;
const MIS_PREFIX = /^mis_/i;

// Only the named constants: `MIS_Counter = 3` is a counter, not LOG_FAILED.
const LIFECYCLE_CONSTANT = /^LOG_(RUNNING|SUCCESS|FAILED|OBSOLETE)$/i;
const lifecycleOf = (value: unknown): QuestLifecycleState =>
  LIFECYCLE_CONSTANT.test(String(value).trim()) ? normalizeQuestLifecycleState(value) : 'unknown';

const keyOfTopic = (topic: string) => getCanonicalQuestKey(topic.replace(TOPIC_PREFIX, ''));
const topicFromMis = (mis: string) => mis.replace(MIS_PREFIX, 'TOPIC_');

const END_STATES: Record<string, QuestStepKind> = { success: 'complete', failed: 'fail', obsolete: 'cancel' };
const STATE_CONSTANT: Record<'complete' | 'fail' | 'cancel', string> = {
  complete: 'LOG_SUCCESS',
  fail: 'LOG_FAILED',
  cancel: 'LOG_OBSOLETE'
};

function classify(action: DialogAction): Part | null {
  const a = action as unknown as Record<string, unknown>;
  switch (a.type) {
    case 'CreateTopic': {
      const topic = String(a.topic ?? '');
      if (!topic) return null;
      return { slot: 'create', key: keyOfTopic(topic), state: 'running', topic, isNote: a.topicType === 'LOG_NOTE' };
    }
    case 'LogSetTopicStatus': {
      const topic = String(a.topic ?? '');
      const state = lifecycleOf(a.status);
      if (!topic || state === 'unknown') return null;
      return { slot: 'status', key: keyOfTopic(topic), state, topic };
    }
    case 'SetVariableAction': {
      const name = String(a.variableName ?? '');
      const state = lifecycleOf(a.value);
      if (!MIS_PREFIX.test(name) || a.operator !== '=' || state === 'unknown') return null;
      return { slot: 'mis', key: getCanonicalQuestKey(name.replace(MIS_PREFIX, '')), state, misVariable: name };
    }
    case 'LogEntry': {
      const topic = String(a.topic ?? '');
      if (!topic || a.textIsExpression) return null;
      return { slot: 'entry', key: keyOfTopic(topic), topic, text: String(a.text ?? '') };
    }
    case 'GivePlayerXPAction':
      return { slot: 'xp', xp: String(a.xpAmount ?? '') };
    default:
      return null;
  }
}

interface Group {
  key: string;
  state?: QuestLifecycleState;
  parts: Map<Slot, { part: Part; index: number }>;
}

/** Whether `part` may join `group` without changing what the step means. */
function fits(group: Group, part: Part): boolean {
  if (group.parts.has(part.slot)) return false;
  if (part.slot === 'xp') return group.state !== undefined && group.state in END_STATES;
  if (part.key !== group.key) return false;
  // An XP line closes a step: nothing of the quest follows it.
  if (group.parts.has('xp')) return false;
  if (part.state && group.state && part.state !== group.state) return false;
  return true;
}

function toStep(group: Group, start: number, end: number): QuestStep | null {
  const get = (slot: Slot) => group.parts.get(slot)?.part;
  const create = get('create');
  let kind: QuestStepKind;
  if (create) kind = create.isNote ? 'note' : 'start';
  else if (group.state === 'running') kind = 'start';
  else if (group.state && END_STATES[group.state]) kind = END_STATES[group.state];
  else if (get('entry')) kind = 'entry';
  else return null;

  const topic = create?.topic ?? get('status')?.topic ?? get('entry')?.topic
    ?? topicFromMis(get('mis')?.misVariable ?? '');
  const indices: QuestStepIndices = {};
  for (const [slot, { index }] of group.parts) indices[slot] = index;

  const step: QuestStep = {
    kind,
    topic,
    misVariable: get('mis')?.misVariable ?? getQuestMisVariableName(topic),
    start,
    end,
    indices
  };
  const entry = get('entry');
  if (entry) step.text = entry.text;
  const xp = get('xp');
  if (xp) step.xp = xp.xp;
  return step;
}

/**
 * Fold the quest lines of one action list into steps. Greedy and
 * left-to-right: a run grows while the next line belongs to the same quest,
 * fills a slot the run has not filled yet, and does not contradict the run's
 * lifecycle state. XP joins only a run that ends the quest.
 */
export function recognizeQuestSteps(actions: readonly DialogAction[]): QuestStep[] {
  const steps: QuestStep[] = [];
  let i = 0;
  while (i < actions.length) {
    const first = classify(actions[i]);
    if (!first || first.slot === 'xp') {
      i++;
      continue;
    }
    const group: Group = { key: first.key as string, state: first.state, parts: new Map([[first.slot, { part: first, index: i }]]) };
    let j = i + 1;
    while (j < actions.length) {
      const part = classify(actions[j]);
      if (!part || !fits(group, part)) break;
      group.parts.set(part.slot, { part, index: j });
      group.state = group.state ?? part.state;
      j++;
    }
    const step = toStep(group, i, j);
    if (step) steps.push(step);
    i = j;
  }
  return steps;
}

export interface QuestStepSpec {
  kind: QuestStepKind;
  topic: string;
  text?: string;
  /** Complete only: an `XP_` constant or a number. */
  xp?: string | null;
}

const entryLine = (topic: string, text: string) => ({ type: 'LogEntry', topic, text }) as DialogAction;
const xpLine = (xpAmount: string) => ({ type: 'GivePlayerXPAction', xpAmount }) as DialogAction;
const topicStatusLine = (topic: string, status: string) =>
  ({ type: 'LogSetTopicStatus', topic, status }) as DialogAction;
const misLine = (variableName: string, value: string) =>
  ({ type: 'SetVariableAction', variableName, operator: '=', value }) as DialogAction;

/** The vanilla lines for a new step. */
export function buildQuestStepActions({ kind, topic, text, xp }: QuestStepSpec): DialogAction[] {
  const mis = getQuestMisVariableName(topic);
  switch (kind) {
    case 'start':
      return [
        { type: 'CreateTopic', topic, topicType: 'LOG_MISSION' } as DialogAction,
        topicStatusLine(topic, 'LOG_RUNNING'),
        entryLine(topic, text ?? ''),
        misLine(mis, 'LOG_RUNNING')
      ];
    case 'note':
      return [
        { type: 'CreateTopic', topic, topicType: 'LOG_NOTE' } as DialogAction,
        entryLine(topic, text ?? '')
      ];
    case 'entry':
      return [entryLine(topic, text ?? '')];
    default: {
      const status = STATE_CONSTANT[kind];
      const lines = [misLine(mis, status), topicStatusLine(topic, status)];
      if (text) lines.push(entryLine(topic, text));
      if (kind === 'complete' && xp) lines.push(xpLine(xp));
      return lines;
    }
  }
}

const replaceAt = (actions: readonly DialogAction[], index: number, patch: Record<string, unknown>) => {
  const next = actions.slice();
  next[index] = { ...(actions[index] as object), ...patch } as unknown as DialogAction;
  return next;
};

/** Point every line of the step at another quest; the `MIS_` name follows the topic. */
export function setQuestStepTopic(actions: readonly DialogAction[], step: QuestStep, topic: string): DialogAction[] {
  let next = actions.slice();
  const { create, status, entry, mis } = step.indices;
  for (const index of [create, status, entry]) {
    if (index !== undefined) next = replaceAt(next, index, { topic });
  }
  if (mis !== undefined) next = replaceAt(next, mis, { variableName: getQuestMisVariableName(topic) });
  return next;
}

/** Set the diary text; a step without an entry line gets one after its state lines. */
export function setQuestStepText(actions: readonly DialogAction[], step: QuestStep, text: string): DialogAction[] {
  if (step.indices.entry !== undefined) return replaceAt(actions, step.indices.entry, { text });
  const at = step.indices.xp ?? step.end;
  return [...actions.slice(0, at), entryLine(step.topic, text), ...actions.slice(at)];
}

/** Set, change or (with null) remove the XP a completion gives. */
export function setQuestStepXp(actions: readonly DialogAction[], step: QuestStep, xp: string | null): DialogAction[] {
  const index = step.indices.xp;
  if (index === undefined) {
    return xp ? [...actions.slice(0, step.end), xpLine(xp), ...actions.slice(step.end)] : actions.slice();
  }
  if (xp) return replaceAt(actions, index, { xpAmount: xp });
  return [...actions.slice(0, index), ...actions.slice(index + 1)];
}
