import type { MoveNodeCommand, QuestCommandContext, QuestCommandResult } from './types';
import { cloneModel } from './shared';

export const executeMoveNodeCommand = (
  context: QuestCommandContext,
  command: MoveNodeCommand
): QuestCommandResult => {
  if (!command.nodeId.trim()) {
    return {
      ok: false,
      errors: [{
        code: 'INVALID_VALUE',
        message: 'Node id is required for moveNode.'
      }]
    };
  }

  if (!Number.isFinite(command.position.x) || !Number.isFinite(command.position.y)) {
    return {
      ok: false,
      errors: [{
        code: 'INVALID_VALUE',
        message: 'Node position must contain finite x/y coordinates.'
      }]
    };
  }

  // moveNode is a graph-layout command; semantic model content is unchanged.
  const updatedModel = cloneModel(context.model);
  const functionExists = !!updatedModel.functions?.[command.nodeId];

  if (!functionExists && !command.nodeId.startsWith('external-')) {
    return {
      ok: false,
      errors: [{
        code: 'FUNCTION_NOT_FOUND',
        message: `Cannot move unknown quest node "${command.nodeId}".`
      }]
    };
  }

  return {
    ok: true,
    updatedModel,
    affectedFunctionNames: functionExists ? [command.nodeId] : []
  };
};
