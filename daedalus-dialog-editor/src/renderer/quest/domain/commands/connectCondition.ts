import type { DialogAction, DialogCondition } from '../../../types/global';
import type { ConnectConditionCommand, QuestCommandContext, QuestCommandResult } from './types';
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

export const executeConnectConditionCommand = (
  context: QuestCommandContext,
  command: ConnectConditionCommand
): QuestCommandResult => {
  const mode = command.mode || 'transition';
  const sourceFunction = context.model.functions?.[command.sourceFunctionName];
  const targetFunction = context.model.functions?.[command.targetFunctionName];

  if (mode === 'requires') {
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
          message: 'Condition links require variableName and value.'
        }]
      };
    }

    const existing = (targetFunction.conditions || []).some((condition) => {
      return isMatchingVariableCondition(condition, command.variableName!, command.value!, command.operator || '==');
    });
    if (existing) {
      return {
        ok: false,
        errors: [{
          code: 'CONDITION_ALREADY_EXISTS',
          message: `Condition "${command.variableName} == ${String(command.value)}" already exists on "${command.targetFunctionName}".`
        }]
      };
    }

    const updatedModel = cloneModel(context.model);
    const conditions = [...(updatedModel.functions[command.targetFunctionName].conditions || [])];
    const operator = command.operator || '==';
    if (operator !== '==' && operator !== '!=') {
      return {
        ok: false,
        errors: [{
          code: 'INVALID_OPERATOR',
          message: `Condition links currently support only == and != operators.`
        }]
      };
    }

    conditions.push({
      type: 'VariableCondition',
      variableName: command.variableName,
      operator,
      value: command.value,
      negated: false
    });
    updatedModel.functions[command.targetFunctionName].conditions = conditions;

    return {
      ok: true,
      updatedModel,
      affectedFunctionNames: [command.sourceFunctionName, command.targetFunctionName]
    };
  }

  if (!sourceFunction) {
    return {
      ok: false,
      errors: [{
        code: 'FUNCTION_NOT_FOUND',
        message: `Source function "${command.sourceFunctionName}" was not found in the active semantic model.`
      }]
    };
  }

  const alreadyExists = (sourceFunction.actions || []).some((action) => {
    return action.type === 'Choice' && action.targetFunction === command.targetFunctionName;
  });
  if (alreadyExists) {
    return {
      ok: false,
      errors: [{
        code: 'TRANSITION_ALREADY_EXISTS',
        message: `Transition from "${command.sourceFunctionName}" to "${command.targetFunctionName}" already exists.`
      }]
    };
  }

  const updatedModel = cloneModel(context.model);
  const actions = [...(updatedModel.functions[command.sourceFunctionName].actions || [])];
  const nextAction: DialogAction = {
    type: 'Choice',
    dialogRef: 'self',
    text: (command.choiceText || 'Continue').trim() || 'Continue',
    targetFunction: command.targetFunctionName
  };
  actions.push(nextAction);
  updatedModel.functions[command.sourceFunctionName].actions = actions;

  return {
    ok: true,
    updatedModel,
    affectedFunctionNames: [command.sourceFunctionName, command.targetFunctionName]
  };
};
