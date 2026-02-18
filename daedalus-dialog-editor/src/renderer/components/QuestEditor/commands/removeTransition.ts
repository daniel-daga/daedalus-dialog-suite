import type { DialogCondition } from '../../../types/global';
import type { RemoveTransitionCommand, QuestCommandContext, QuestCommandResult } from './types';
import { cloneModel } from './shared';

const isMatchingVariableCondition = (
  condition: DialogCondition,
  variableName: string,
  value: string | number | boolean,
  operator: '==' | '!=' = '=='
): boolean => {
  return (
    condition.type === 'VariableCondition' &&
    condition.variableName === variableName &&
    condition.operator === operator &&
    String(condition.value) === String(value) &&
    !condition.negated
  );
};

export const executeRemoveTransitionCommand = (
  context: QuestCommandContext,
  command: RemoveTransitionCommand
): QuestCommandResult => {
  const mode = command.mode || 'transition';

  if (mode === 'requires') {
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

    if (!command.variableName || command.value === undefined) {
      return {
        ok: false,
        errors: [{
          code: 'INVALID_CONDITION_LINK',
          message: 'Removing a condition link requires variableName and value.'
        }]
      };
    }

    const conditions = targetFunction.conditions || [];
    const conditionIndex = conditions.findIndex((condition) => {
      return isMatchingVariableCondition(condition, command.variableName!, command.value!, (command.operator || '==') as '==' | '!=');
    });
    if (conditionIndex < 0) {
      return {
        ok: false,
        errors: [{
          code: 'CONDITION_NOT_FOUND',
          message: `Condition "${command.variableName} ${(command.operator || '==')} ${String(command.value)}" was not found on "${command.targetFunctionName}".`
        }]
      };
    }

    const updatedModel = cloneModel(context.model);
    const updatedConditions = [...(updatedModel.functions[command.targetFunctionName].conditions || [])];
    updatedConditions.splice(conditionIndex, 1);
    updatedModel.functions[command.targetFunctionName].conditions = updatedConditions;

    return {
      ok: true,
      updatedModel,
      affectedFunctionNames: [command.sourceFunctionName, command.targetFunctionName]
    };
  }

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

  const actions = sourceFunction.actions || [];
  const choiceIndex = actions.findIndex((action) => {
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
  updatedActions.splice(choiceIndex, 1);
  updatedModel.functions[command.sourceFunctionName].actions = updatedActions;

  return {
    ok: true,
    updatedModel,
    affectedFunctionNames: [command.sourceFunctionName, command.targetFunctionName]
  };
};
