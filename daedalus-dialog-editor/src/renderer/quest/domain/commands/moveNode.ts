import type { MoveNodeCommand, QuestCommandContext, QuestCommandResult } from './types';

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

  // moveNode is a graph-layout command; semantic model content is unchanged, so
  // the model is returned by reference (its result model is discarded by the
  // position-only history path in QuestFlow).
  const functionExists = !!context.model.functions?.[command.nodeId];

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
    updatedModel: context.model,
    affectedFunctionNames: functionExists ? [command.nodeId] : []
  };
};
