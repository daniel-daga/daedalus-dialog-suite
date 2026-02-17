import type { QuestCommandContext, QuestCommandResult, UpdateTransitionTextCommand } from './types';
import { cloneModel } from './shared';

export const executeUpdateTransitionTextCommand = (
  context: QuestCommandContext,
  command: UpdateTransitionTextCommand
): QuestCommandResult => {
  const sourceFunction = context.model.functions?.[command.sourceFunctionName];
  if (!sourceFunction) {
    return {
      ok: false,
      errors: [{
        code: 'FUNCTION_NOT_FOUND',
        message: `Source function "${command.sourceFunctionName}" was not found in the active semantic model.`
      }]
    };
  }

  const text = command.text.trim();
  if (!text) {
    return {
      ok: false,
      errors: [{
        code: 'INVALID_TEXT',
        message: 'Transition text cannot be empty.'
      }]
    };
  }

  const choiceIndex = (sourceFunction.actions || []).findIndex((action) => {
    return action.type === 'Choice' && action.targetFunction === command.targetFunctionName;
  });
  if (choiceIndex < 0) {
    return {
      ok: false,
      errors: [{
        code: 'TRANSITION_NOT_FOUND',
        message: `Transition from "${command.sourceFunctionName}" to "${command.targetFunctionName}" does not exist.`
      }]
    };
  }

  const updatedModel = cloneModel(context.model);
  const updatedActions = [...(updatedModel.functions[command.sourceFunctionName].actions || [])];
  const existingAction = updatedActions[choiceIndex];
  if (existingAction.type !== 'Choice') {
    return {
      ok: false,
      errors: [{
        code: 'TRANSITION_NOT_FOUND',
        message: `Transition from "${command.sourceFunctionName}" to "${command.targetFunctionName}" does not exist.`
      }]
    };
  }

  updatedActions[choiceIndex] = {
    ...existingAction,
    text
  };
  updatedModel.functions[command.sourceFunctionName].actions = updatedActions;

  return {
    ok: true,
    updatedModel,
    affectedFunctionNames: [command.sourceFunctionName, command.targetFunctionName]
  };
};
