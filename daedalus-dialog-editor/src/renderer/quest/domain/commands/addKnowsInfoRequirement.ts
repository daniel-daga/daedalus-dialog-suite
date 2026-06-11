import type { DialogCondition } from '../../../types/global';
import type { AddKnowsInfoRequirementCommand, QuestCommandContext, QuestCommandResult } from './types';
import { cloneModel } from './shared';

const isMatchingKnowsInfoCondition = (
  condition: DialogCondition,
  npc: string,
  dialogRef: string
): boolean => (
  condition.type === 'NpcKnowsInfoCondition' &&
  condition.npc === npc &&
  condition.dialogRef === dialogRef
);

export const executeAddKnowsInfoRequirementCommand = (
  context: QuestCommandContext,
  command: AddKnowsInfoRequirementCommand
): QuestCommandResult => {
  const targetFunction = context.model.functions?.[command.targetFunctionName];
  if (!targetFunction) {
    return {
      ok: false,
      errors: [{
        code: 'FUNCTION_NOT_FOUND',
        message: `Target function "${command.targetFunctionName}" was not found in the active semantic model.`
      }]
    };
  }

  const dialogRef = command.dialogRef.trim();
  if (!dialogRef) {
    return {
      ok: false,
      errors: [{
        code: 'INVALID_VALUE',
        message: 'dialogRef is required for addKnowsInfoRequirement.'
      }]
    };
  }

  const npc = (command.npc || 'self').trim() || 'self';
  const existing = (targetFunction.conditions || []).some((condition) => (
    isMatchingKnowsInfoCondition(condition, npc, dialogRef)
  ));

  if (existing) {
    return {
      ok: true,
      updatedModel: cloneModel(context.model),
      affectedFunctionNames: [command.targetFunctionName]
    };
  }

  const updatedModel = cloneModel(context.model);
  const conditions = [...(updatedModel.functions[command.targetFunctionName].conditions || [])];
  conditions.push({
    type: 'NpcKnowsInfoCondition',
    npc,
    dialogRef
  });
  updatedModel.functions[command.targetFunctionName].conditions = conditions;

  return {
    ok: true,
    updatedModel,
    affectedFunctionNames: [command.targetFunctionName]
  };
};
