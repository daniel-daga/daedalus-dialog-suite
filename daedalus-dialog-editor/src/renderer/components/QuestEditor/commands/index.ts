import { executeAddLogEntryCommand } from './addLogEntry';
import { executeAddKnowsInfoRequirementCommand } from './addKnowsInfoRequirement';
import { executeAddTopicStatusCommand } from './addTopicStatus';
import { executeConnectConditionCommand } from './connectCondition';
import { executeMoveNodeCommand } from './moveNode';
import { executeRemoveKnowsInfoRequirementCommand } from './removeKnowsInfoRequirement';
import { executeRemoveTransitionCommand } from './removeTransition';
import { executeSetMisStateCommand } from './setMisState';
import { executeUpdateConditionLinkCommand } from './updateConditionLink';
import { executeUpdateTransitionTextCommand } from './updateTransitionText';
import type { QuestCommandContext, QuestCommandResult, QuestGraphCommand } from './types';

export type {
  QuestCommandContext,
  QuestCommandError,
  QuestCommandFailure,
  QuestCommandResult,
  QuestCommandSuccess,
  QuestCommandType,
  QuestGraphCommand,
  AddLogEntryCommand,
  AddTopicStatusCommand,
  AddKnowsInfoRequirementCommand,
  RemoveKnowsInfoRequirementCommand,
  ConnectConditionCommand,
  RemoveConditionLinkCommand,
  RemoveTransitionCommand,
  UpdateConditionLinkCommand,
  UpdateTransitionTextCommand,
  MoveNodeCommand,
  SetMisStateCommand
} from './types';

export const executeQuestGraphCommand = (
  context: QuestCommandContext,
  command: QuestGraphCommand
): QuestCommandResult => {
  switch (command.type) {
    case 'setMisState':
      return executeSetMisStateCommand(context, command);
    case 'addTopicStatus':
      return executeAddTopicStatusCommand(context, command);
    case 'addLogEntry':
      return executeAddLogEntryCommand(context, command);
    case 'connectCondition':
      return executeConnectConditionCommand(context, command);
    case 'addKnowsInfoRequirement':
      return executeAddKnowsInfoRequirementCommand(context, command);
    case 'removeKnowsInfoRequirement':
      return executeRemoveKnowsInfoRequirementCommand(context, command);
    case 'removeTransition':
      return executeRemoveTransitionCommand(context, command);
    case 'removeConditionLink':
      return executeRemoveTransitionCommand(context, {
        type: 'removeTransition',
        mode: 'requires',
        sourceFunctionName: command.targetFunctionName,
        targetFunctionName: command.targetFunctionName,
        variableName: command.variableName,
        value: command.value
      });
    case 'updateConditionLink':
      return executeUpdateConditionLinkCommand(context, command);
    case 'updateTransitionText':
      return executeUpdateTransitionTextCommand(context, command);
    case 'moveNode':
      return executeMoveNodeCommand(context, command);
    default:
      return {
        ok: false,
        errors: [{
          code: 'UNKNOWN_COMMAND',
          message: `Unknown quest command type "${(command as { type: string }).type}".`
        }]
      };
  }
};
