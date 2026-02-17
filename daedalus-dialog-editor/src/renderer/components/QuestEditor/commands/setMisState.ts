import type { DialogAction } from '../../../types/global';
import type { QuestCommandContext, QuestCommandResult, SetMisStateCommand } from './types';
import { cloneModel } from './shared';

export const executeSetMisStateCommand = (
  context: QuestCommandContext,
  command: SetMisStateCommand
): QuestCommandResult => {
  const variableName = command.variableName.trim();
  const operator = command.operator || '=';

  if (!variableName || !variableName.startsWith('MIS_')) {
    return {
      ok: false,
      errors: [{
        code: 'INVALID_VARIABLE_NAME',
        message: `Expected MIS_ variable name, received "${command.variableName}".`
      }]
    };
  }

  if (operator !== '=') {
    return {
      ok: false,
      errors: [{
        code: 'INVALID_OPERATOR',
        message: `Unsupported operator "${operator}". Only "=" is currently supported.`
      }]
    };
  }

  if (
    typeof command.value !== 'string' &&
    typeof command.value !== 'number' &&
    typeof command.value !== 'boolean'
  ) {
    return {
      ok: false,
      errors: [{
        code: 'INVALID_VALUE',
        message: 'MIS state value must be a string, number, or boolean.'
      }]
    };
  }

  const existingFunction = context.model.functions?.[command.functionName];
  if (!existingFunction) {
    return {
      ok: false,
      errors: [{
        code: 'FUNCTION_NOT_FOUND',
        message: `Function "${command.functionName}" does not exist in the active semantic model.`
      }]
    };
  }

  const updatedModel = cloneModel(context.model);
  const targetFunction = updatedModel.functions[command.functionName];
  const actions = [...(targetFunction.actions || [])];

  const actionIndex = actions.findIndex((action: DialogAction) => {
    return (
      action.type === 'SetVariableAction' &&
      action.variableName === variableName &&
      action.operator === '='
    );
  });

  const nextAction: DialogAction = {
    type: 'SetVariableAction',
    variableName,
    operator: '=',
    value: command.value
  };

  if (actionIndex >= 0) {
    actions[actionIndex] = nextAction;
  } else {
    actions.push(nextAction);
  }

  targetFunction.actions = actions;

  return {
    ok: true,
    updatedModel,
    affectedFunctionNames: [command.functionName]
  };
};
