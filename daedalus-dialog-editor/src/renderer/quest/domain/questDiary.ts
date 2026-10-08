/**
 * The quest page as the diary (#324, docs/plans/quest-authoring.md phase 3):
 * every diary entry and state change of one quest, in story order, with where
 * each one is written so it can be edited in place and jumped to.
 *
 * Story order is the quest graph's: a function comes after every function it
 * requires (a `MIS_` check another one satisfies, a known info, a choice).
 * Where the graph leaves two unordered, a start comes before entries and
 * entries before an ending, then by name. Within a function, lines keep their
 * written order.
 */
import type { DialogAction, SemanticModel } from '../../types/global';
import {
  getQuestMisVariableName,
  isCaseInsensitiveMatch,
  normalizeQuestLifecycleState,
  type QuestLifecycleState
} from '../../utils/questIdentity';
import { buildQuestGraph } from './graph';
import { getDialogContextForFunction, getFunctionFilePath } from './questGraphSharedHelpers';

export type QuestDiaryState = Exclude<QuestLifecycleState, 'unknown'>;
export type QuestDiaryPath = Array<number | 'then' | 'else'>;

export interface QuestDiaryItem {
  kind: 'entry' | 'state';
  functionName: string;
  filePath?: string;
  dialogName?: string;
  npc?: string;
  /** Where the line sits in the function's actions, through if/else branches. */
  path: QuestDiaryPath;
  /** Entry only. */
  text?: string;
  /** Entry only: the text is a string literal, so it can be edited as text. */
  editable?: boolean;
  /** State only. */
  state?: QuestDiaryState;
}

// Only the named constants: `MIS_Counter = 3` is a counter (questSteps.ts).
const LIFECYCLE_CONSTANT = /^LOG_(RUNNING|SUCCESS|FAILED|OBSOLETE)$/i;

type Line = Omit<QuestDiaryItem, 'functionName' | 'filePath' | 'dialogName' | 'npc'>;

function stateOf(action: DialogAction, questName: string, misName: string): QuestDiaryState | null {
  const a = action as unknown as Record<string, unknown>;
  let state: QuestLifecycleState = 'unknown';
  if (a.type === 'CreateTopic' && isCaseInsensitiveMatch(a.topic as string, questName) && a.topicType !== 'LOG_NOTE') {
    state = 'running';
  } else if (a.type === 'LogSetTopicStatus' && isCaseInsensitiveMatch(a.topic as string, questName)) {
    state = normalizeQuestLifecycleState(a.status);
  } else if (
    a.type === 'SetVariableAction' && a.operator === '=' &&
    isCaseInsensitiveMatch(a.variableName as string, misName) &&
    LIFECYCLE_CONSTANT.test(String(a.value).trim())
  ) {
    state = normalizeQuestLifecycleState(a.value);
  }
  return state === 'unknown' ? null : state;
}

function collectLines(
  actions: readonly DialogAction[],
  questName: string,
  misName: string,
  prefix: QuestDiaryPath,
  out: Line[]
): void {
  actions.forEach((action, index) => {
    const path = [...prefix, index];
    const a = action as unknown as Record<string, unknown>;
    if (a.type === 'ConditionalAction') {
      collectLines((a.thenActions as DialogAction[]) ?? [], questName, misName, [...path, 'then'], out);
      collectLines((a.elseActions as DialogAction[]) ?? [], questName, misName, [...path, 'else'], out);
      return;
    }
    if (a.type === 'LogEntry' && isCaseInsensitiveMatch(a.topic as string, questName)) {
      out.push({ kind: 'entry', path, text: String(a.text ?? ''), editable: !a.textIsExpression });
      return;
    }
    const state = stateOf(action, questName, misName);
    // A step writes its state twice (topic status and MIS_); show it once.
    if (state && !out.some((line) => line.kind === 'state' && line.state === state)) {
      out.push({ kind: 'state', path, state });
    }
  });
}

/** A start sorts first and an ending last; a function with only entries sits between. */
const rankOf = (lines: readonly Line[]) => {
  if (lines.some((line) => line.state === 'running')) return 0;
  return lines.some((line) => line.kind === 'state') ? 2 : 1;
};

/** Kahn's order over the quest graph; a cycle is broken at its lowest-ranked node. */
function storyOrder(model: SemanticModel, questName: string, rank: (id: string) => number): string[] {
  const { nodes, edges } = buildQuestGraph(model, questName);
  const pending = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    if (!pending.has(edge.source) || !pending.has(edge.target) || edge.source === edge.target) continue;
    pending.set(edge.target, pending.get(edge.target)! + 1);
    next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target]);
  }
  const before = (a: string, b: string) => rank(a) - rank(b) || a.localeCompare(b);
  const order: string[] = [];
  while (pending.size > 0) {
    const candidates = Array.from(pending.keys());
    const ready = candidates.filter((id) => pending.get(id) === 0);
    const id = (ready.length > 0 ? ready : candidates).sort(before)[0];
    pending.delete(id);
    order.push(id);
    for (const target of next.get(id) ?? []) {
      if (pending.has(target)) pending.set(target, pending.get(target)! - 1);
    }
  }
  return order;
}

export function buildQuestDiary(model: SemanticModel, questName: string): QuestDiaryItem[] {
  const misName = getQuestMisVariableName(questName);
  const linesByFunction = new Map<string, Line[]>();
  for (const func of Object.values(model.functions || {})) {
    const lines: Line[] = [];
    collectLines(func.actions ?? [], questName, misName, [], lines);
    if (lines.length > 0) linesByFunction.set(func.name, lines);
  }
  if (linesByFunction.size === 0) return [];

  const rank = (id: string) => {
    const lines = linesByFunction.get(id);
    return lines ? rankOf(lines) : 1;
  };
  const graphOrder = storyOrder(model, questName, rank).filter((id) => linesByFunction.has(id));
  const placed = new Set(graphOrder);
  const rest = Array.from(linesByFunction.keys())
    .filter((id) => !placed.has(id))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  return [...graphOrder, ...rest].flatMap((functionName) => {
    const context = getDialogContextForFunction(functionName, model);
    const filePath = getFunctionFilePath(model.functions[functionName]);
    return linesByFunction.get(functionName)!.map((line) => ({
      ...line,
      functionName,
      ...(filePath ? { filePath } : {}),
      ...(context.dialogName ? { dialogName: context.dialogName, npc: context.npc } : {})
    }));
  });
}

/** The dialog (or function) an implicit quest's state is read from: the one that starts it. */
export function implicitQuestSource(diary: readonly QuestDiaryItem[]): string | null {
  const source = diary.find((item) => item.state === 'running') ?? diary[0];
  return source ? source.dialogName ?? source.functionName : null;
}

const STATE_CONSTANT: Record<QuestDiaryState, string> = {
  running: 'LOG_RUNNING',
  success: 'LOG_SUCCESS',
  failed: 'LOG_FAILED',
  obsolete: 'LOG_OBSOLETE'
};

/**
 * The implicit-quest upgrade for one action list: after each line that sets
 * the quest's state through its topic, set `MIS_X` to the same state, unless
 * the list already does. A lone `Log_CreateTopic` starts the quest; a note's
 * does not. Returns null when nothing needs adding.
 */
export function withQuestStateAssignments(actions: readonly DialogAction[], questName: string): DialogAction[] | null {
  const misName = getQuestMisVariableName(questName);
  const isMis = (action: DialogAction) => (action as { type: string }).type === 'SetVariableAction';
  const covered = new Set(actions.filter(isMis).map((action) => stateOf(action, questName, misName)));
  const statuses = new Set(actions
    .filter((action) => (action as { type: string }).type === 'LogSetTopicStatus')
    .map((action) => stateOf(action, questName, misName)));

  let changed = false;
  const out: DialogAction[] = [];
  for (const action of actions) {
    const a = action as unknown as Record<string, unknown>;
    if (a.type === 'ConditionalAction') {
      const thenActions = withQuestStateAssignments((a.thenActions as DialogAction[]) ?? [], questName);
      const elseActions = withQuestStateAssignments((a.elseActions as DialogAction[]) ?? [], questName);
      if (thenActions || elseActions) {
        changed = true;
        out.push({ ...a, thenActions: thenActions ?? a.thenActions, elseActions: elseActions ?? a.elseActions } as unknown as DialogAction);
        continue;
      }
    }
    out.push(action);
    if (isMis(action)) continue;
    const state = stateOf(action, questName, misName);
    if (!state || covered.has(state)) continue;
    // A Log_CreateTopic followed by its own RUNNING status line waits for that line.
    if (a.type === 'CreateTopic' && statuses.has(state)) continue;
    covered.add(state);
    changed = true;
    out.push({ type: 'SetVariableAction', variableName: misName, operator: '=', value: STATE_CONSTANT[state] } as DialogAction);
  }
  return changed ? out : null;
}
