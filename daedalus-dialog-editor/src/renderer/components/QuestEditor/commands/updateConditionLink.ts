import type { DialogCondition } from '../../../types/global';
import type { QuestCommandContext, QuestCommandResult, UpdateConditionLinkCommand } from './types';
import { cloneModel } from './shared';

const isMatchingVariableCondition = (
  condition: DialogCondition,
  variableName: string,
  value: string | number | boolean
): boolean => {
  return (
    condition.type === 'VariableCondition' &&
    condition.variableName === variableName &&
    condition.operator === '==' &&
    String(condition.value) === String(value) &&
    !condition.negated
  );
};

export const executeUpdateConditionLinkCommand = (
  context: QuestCommandContext,
  command: UpdateConditionLinkCommand
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

  if (!command.variableName || command.value === undefined) {
    return {
      ok: false,
      errors: [{
        code: 'INVALID_CONDITION_LINK',
        message: 'Condition link update requires variableName and value.'
      }]
    };
  }

  const conditions = targetFunction.conditions || [];
  const existingIndex = conditions.findIndex((condition) => {
    return isMatchingVariableCondition(condition, command.oldVariableName, command.oldValue);
  });
  if (existingIndex < 0) {
    return {
      ok: false,
      errors: [{
        code: 'CONDITION_NOT_FOUND',
        message: `Condition "${command.oldVariableName} == ${String(command.oldValue)}" was not found on "${command.targetFunctionName}".`
      }]
    };
  }

  const duplicateIndex = conditions.findIndex((condition, index) => {
    if (index === existingIndex) return false;
    return isMatchingVariableCondition(condition, command.variableName, command.value);
  });
  if (duplicateIndex >= 0) {
    return {
      ok: false,
      errors: [{
        code: 'CONDITION_ALREADY_EXISTS',
        message: `Condition "${command.variableName} == ${String(command.value)}" already exists on "${command.targetFunctionName}".`
      }]
    };
  }

  const updatedModel = cloneModel(context.model);
  const updatedConditions = [...(updatedModel.functions[command.targetFunctionName].conditions || [])];
  updatedConditions[existingIndex] = {
    type: 'VariableCondition',
    variableName: command.variableName,
    operator: '==',
    value: command.value,
    negated: false
  };
  updatedModel.functions[command.targetFunctionName].conditions = updatedConditions;

  return {
    ok: true,
    updatedModel,
    affectedFunctionNames: [command.targetFunctionName]
  };
};
