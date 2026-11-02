import type { DialogLineAction, NpcKnowsInfoCondition, SemanticModel } from '../../../shared/types';
import type { DialogFacts, FileFacts, FunctionFacts } from './types';
import { forEachAction } from './walk';

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

  const functions: FunctionFacts[] = Object.values(model.functions || {}).map((func) => {
    let hasChoice = false;
    let hasClearChoices = false;
    const choiceTargets: string[] = [];
    const voiceIds: Array<{ id: string; text: string; line?: number }> = [];
    forEachAction(func.actions, (action) => {
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
      }
    });

    const knowsInfoRefs: Array<{ index: number; dialogRef: string; line?: number }> = [];
    // `conditions` is guaranteed by the native parser but may be absent on
    // partial/error models or the browser-harness mock — tolerate that.
    (func.conditions || []).forEach((condition, index) => {
      if (condition.type !== 'NpcKnowsInfoCondition') {
        return;
      }
      const { dialogRef } = condition as NpcKnowsInfoCondition;
      if (typeof dialogRef === 'string' && dialogRef.length > 0) {
        knowsInfoRefs.push({ index, dialogRef, line: condition.line });
      }
    });

    return {
      name: func.name,
      line: func.line,
      hasChoice,
      hasClearChoices,
      choiceTargets,
      calls: func.calls || [],
      knowsInfoRefs,
      voiceIds
    };
  });

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

  return { dialogs, functions, npcNames, instanceRefs: [...instanceRefs] };
}
