import type { QuestCommandContext, QuestCommandResult, SetConditionExpressionCommand } from './types';
import { cloneModel } from './shared';
import { parseConditionExpressionToConditions } from './conditionExpressionCodec';

export const executeSetConditionExpressionCommand = (
  context: QuestCommandContext,
  command: SetConditionExpressionCommand
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

  const parseResult = parseConditionExpressionToConditions(command.expression);
  if (!parseResult.ok) {
    return {
      ok: false,
      errors: [{
        code: 'INVALID_CONDITION_LINK',
        message: parseResult.error
      }]
    };
  }

  const updatedModel = cloneModel(context.model);
  updatedModel.functions[command.targetFunctionName].conditions = parseResult.conditions;

  return {
    ok: true,
    updatedModel,
    affectedFunctionNames: [command.targetFunctionName]
  };
};

