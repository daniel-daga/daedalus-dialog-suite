import type { DialogAction, DialogCondition, DialogLineAction, SemanticModel } from '../../../shared/types';
import type { DialogFacts, FileFacts, FunctionFacts } from './types';
import { forEachAction } from './walk';

/**
 * A `Npc_KnowsInfo` call in text the parser left unstructured. The same pattern
 * the quest codec reads one clause with (`conditionExpressionCodec.ts`), minus
 * its anchors: here it is matched inside a whole statement or function body.
 */
const KNOWS_INFO_CALL = /Npc_KnowsInfo\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/gi;

/** Resolves a `string | { name }` reference property to a plain name. */
const refName = (ref: string | { name?: string } | undefined): string | undefined =>
  typeof ref === 'string' ? ref : ref?.name;

/**
 * Extracts every per-file input the lint rules need from one semantic model in
 * a single pass (including the walk into nested conditional actions). Pure
 * function of the model object — models are immutable once parsed, so callers
 * cache the result against the model's identity and only files whose model was
 * re-parsed pay the extraction cost on the next scan.
 */
export function extractFileFacts(model: SemanticModel): FileFacts {
  const dialogs: DialogFacts[] = Object.values(model.dialogs || {}).map((dialog) => ({
    name: dialog.name,
    line: dialog.line,
    npc: typeof dialog.properties?.npc === 'string' ? dialog.properties.npc : undefined,
    informationRef: refName(dialog.properties?.information),
    conditionRef: refName(dialog.properties?.condition)
  }));

  const functions: FunctionFacts[] = Object.values(model.functions || {}).map((func) =>
    extractFunctionFacts(func.name, func.line, func.actions, func.conditions, func.calls || []));

  const npcNames: string[] = [];
  // Only `daily_routine` is a modelled field, so the rest of an instance body's
  // function-valued properties (`start_aistate`, a project's own) are read out
  // of its source text. A declaration the model was built from carries one.
  const instanceRefs = new Set<string>();
  for (const instance of Object.values(model.instances || {})) {
    if (instance.dailyRoutine) instanceRefs.add(instance.dailyRoutine);
    for (const [, assigned] of (instance.sourceText || '').matchAll(/=\s*([A-Za-z_]\w*)\s*;/g)) {
      instanceRefs.add(assigned);
    }
    if (instance.parent && instance.parent.trim().toUpperCase() === 'C_NPC') {
      npcNames.push(instance.name);
    }
  }
  for (const npc of Object.values(model.npcs || {})) {
    npcNames.push(npc.name);
  }

  // Only an overload carries `overloadOf`; an extension block is `raw` too.
  // Its body is the parser's read-only projection (#574), read here like any
  // function's and attributed to the overload by its own lines. Its calls are
  // already on the first signature's `calls` (#567), so none are repeated.
  const overloads: FunctionFacts[] = [];
  for (const entry of model.declarationOrder || []) {
    if (entry.type !== 'raw' || entry.overloadOf === undefined) continue;
    overloads.push({
      ...extractFunctionFacts(entry.overloadOf, entry.line, entry.overloadBody?.actions, entry.overloadBody?.conditions, []),
      overload: overloads.length
    });
  }

  return { dialogs, functions, npcNames, instanceRefs: [...instanceRefs], overloads };
}

/**
 * Every function body a file's facts hold — its functions, then its raw
 * overloads (#574) — for the rules that read bodies rather than resolve names.
 * `overloads` may be absent on facts cached or built before the field.
 */
export const functionBodies = (facts: FileFacts): FunctionFacts[] =>
  facts.overloads?.length ? [...facts.functions, ...facts.overloads] : facts.functions;

/** A finding-id segment for one body: an overload's differs from its first signature's. */
export const bodyKey = (func: FunctionFacts): string =>
  func.overload === undefined ? func.name : `${func.name}#overload${func.overload}`;

/**
 * One function body's facts, by a single walk over its (possibly nested)
 * actions and its conditions — a declared function's, or an overload's
 * read-only projection (#574).
 */
function extractFunctionFacts(
  name: string,
  line: number | undefined,
  actions: DialogAction[] | undefined,
  conditions: DialogCondition[] | undefined,
  calls: string[]
): FunctionFacts {
  let hasChoice = false;
  let hasClearChoices = false;
  const choiceTargets: string[] = [];
  const voiceIds: Array<{ id: string; text: string; line?: number }> = [];
  const knowsInfoRefs: FunctionFacts['knowsInfoRefs'] = [];
  const scanKnowsInfo = (text: string | undefined, at?: number) => {
    for (const [, , dialogRef] of (text || '').matchAll(KNOWS_INFO_CALL)) {
      const ref = dialogRef.trim();
      if (ref.length > 0) {
        knowsInfoRefs.push({ dialogRef: ref, line: at });
      }
    }
  };
  forEachAction(actions, (action) => {
    if (action.type === 'Choice') {
      hasChoice = true;
      choiceTargets.push(action.targetFunction);
    } else if (action.type === 'ClearChoicesAction') {
      hasClearChoices = true;
    } else if (action.type === 'DialogLine') {
      const dialogLine = action as DialogLineAction;
      if (typeof dialogLine.id === 'string' && dialogLine.id.trim() !== '' && !dialogLine.idIsExpression) {
        voiceIds.push({ id: dialogLine.id, text: dialogLine.text ?? '', line: action.line });
      }
    } else if (action.type === 'ConditionalAction') {
      scanKnowsInfo(action.condition, action.line);
    } else if (action.type === 'Action') {
      scanKnowsInfo(action.action, action.line);
    }
  });

  // `conditions` is guaranteed by the native parser but may be absent on
  // partial/error models or the browser-harness mock — tolerate that.
  (conditions || []).forEach((condition) => {
    if (condition.type === 'NpcKnowsInfoCondition') {
      if (condition.dialogRef.length > 0) {
        knowsInfoRefs.push({ dialogRef: condition.dialogRef, line: condition.line });
      }
    } else if (condition.type === 'Condition' || condition.type === 'GenericCondition') {
      scanKnowsInfo(condition.condition, condition.line);
    }
  });

  return { name, line, hasChoice, hasClearChoices, choiceTargets, calls, knowsInfoRefs, voiceIds };
}
