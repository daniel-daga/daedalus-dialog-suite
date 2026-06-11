import type { DialogAction } from '../../../types/global';
import type { AddLogEntryCommand, QuestCommandContext, QuestCommandResult } from './types';
import { cloneModel } from './shared';

export const executeAddLogEntryCommand = (
  context: QuestCommandContext,
  command: AddLogEntryCommand
): QuestCommandResult => {
  const text = command.text.trim();
  if (!text) {
    return {
      ok: false,
      errors: [{
        code: 'INVALID_TEXT',
        message: 'Log entry text cannot be empty.'
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

  const nextAction: DialogAction = {
    type: 'LogEntry',
    topic: command.topic,
    text
  };

  actions.push(nextAction);
  targetFunction.actions = actions;

  return {
    ok: true,
    updatedModel,
    affectedFunctionNames: [command.functionName]
  };
};
