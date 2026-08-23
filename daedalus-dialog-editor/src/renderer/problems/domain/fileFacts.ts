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
    npc: typeof dialog.properties?.npc === 'string' ? dialog.properties.npc : undefined,
    informationRef: refName(dialog.properties?.information),
    conditionRef: refName(dialog.properties?.condition)
  }));

  const functions: FunctionFacts[] = Object.values(model.functions || {}).map((func) => {
    let hasChoice = false;
    let hasClearChoices = false;
    const choiceTargets: string[] = [];
    const voiceIds: string[] = [];
    forEachAction(func.actions, (action) => {
      if (action.type === 'Choice') {
        hasChoice = true;
        choiceTargets.push(action.targetFunction);
      } else if (action.type === 'ClearChoicesAction') {
        hasClearChoices = true;
      } else if (action.type === 'DialogLine') {
        const line = action as DialogLineAction;
        if (typeof line.id === 'string' && line.id.trim() !== '' && !line.idIsExpression) {
          voiceIds.push(line.id);
        }
      }
    });

    const knowsInfoRefs: Array<{ index: number; dialogRef: string }> = [];
    // `conditions` is guaranteed by the native parser but may be absent on
    // partial/error models or the browser-harness mock — tolerate that.
    (func.conditions || []).forEach((condition, index) => {
      if (condition.type !== 'NpcKnowsInfoCondition') {
        return;
      }
      const { dialogRef } = condition as NpcKnowsInfoCondition;
      if (typeof dialogRef === 'string' && dialogRef.length > 0) {
        knowsInfoRefs.push({ index, dialogRef });
      }
    });

    return {
      name: func.name,
      hasChoice,
      hasClearChoices,
      choiceTargets,
      calls: func.calls || [],
      knowsInfoRefs,
      voiceIds
    };
  });

  const npcNames: string[] = [];
  for (const instance of Object.values(model.instances || {})) {
    if (instance.parent && instance.parent.trim().toUpperCase() === 'C_NPC') {
      npcNames.push(instance.name);
    }
  }
  for (const npc of Object.values(model.npcs || {})) {
    npcNames.push(npc.name);
  }

  return { dialogs, functions, npcNames };
}
