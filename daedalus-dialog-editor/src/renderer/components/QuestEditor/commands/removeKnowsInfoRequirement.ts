import type { DialogCondition } from '../../../types/global';
import type { QuestCommandContext, QuestCommandResult, RemoveKnowsInfoRequirementCommand } from './types';
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

export const executeRemoveKnowsInfoRequirementCommand = (
  context: QuestCommandContext,
  command: RemoveKnowsInfoRequirementCommand
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
        message: 'dialogRef is required for removeKnowsInfoRequirement.'
      }]
    };
  }

  const npc = (command.npc || 'self').trim() || 'self';
  const conditions = targetFunction.conditions || [];
  const conditionIndex = conditions.findIndex((condition) => (
    isMatchingKnowsInfoCondition(condition, npc, dialogRef)
  ));

  if (conditionIndex < 0) {
    return {
      ok: true,
      updatedModel: cloneModel(context.model),
      affectedFunctionNames: [command.targetFunctionName]
    };
  }

  const updatedModel = cloneModel(context.model);
  const updatedConditions = [...(updatedModel.functions[command.targetFunctionName].conditions || [])];
  updatedConditions.splice(conditionIndex, 1);
  updatedModel.functions[command.targetFunctionName].conditions = updatedConditions;

  return {
    ok: true,
    updatedModel,
    affectedFunctionNames: [command.targetFunctionName]
  };
};
