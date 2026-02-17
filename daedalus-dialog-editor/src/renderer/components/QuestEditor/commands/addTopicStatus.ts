import type { DialogAction } from '../../../types/global';
import type { AddTopicStatusCommand, QuestCommandContext, QuestCommandResult } from './types';
import { cloneModel } from './shared';

export const executeAddTopicStatusCommand = (
  context: QuestCommandContext,
  command: AddTopicStatusCommand
): QuestCommandResult => {
  const status = command.status.trim();
  if (!status) {
    return {
      ok: false,
      errors: [{
        code: 'INVALID_STATUS',
        message: 'Topic status cannot be empty.'
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
    type: 'LogSetTopicStatus',
    topic: command.topic,
    status
  };

  actions.push(nextAction);
  targetFunction.actions = actions;

  return {
    ok: true,
    updatedModel,
    affectedFunctionNames: [command.functionName]
  };
};
