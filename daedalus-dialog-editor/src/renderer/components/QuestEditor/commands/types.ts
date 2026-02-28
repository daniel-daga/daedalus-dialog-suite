import type { SemanticModel } from '../../../types/global';

export type QuestCommandType =
  | 'addTopicStatus'
  | 'setMisState'
  | 'addLogEntry'
  | 'connectCondition'
  | 'addKnowsInfoRequirement'
  | 'removeKnowsInfoRequirement'
  | 'removeTransition'
  | 'removeConditionLink'
  | 'updateConditionLink'
  | 'updateTransitionText'
  | 'moveNode';

export interface AddTopicStatusCommand {
  type: 'addTopicStatus';
  functionName: string;
  topic: string;
  status: string;
}

export interface SetMisStateCommand {
  type: 'setMisState';
  functionName: string;
  variableName: string;
  value: string | number | boolean;
  operator?: string;
}

export interface AddLogEntryCommand {
  type: 'addLogEntry';
  functionName: string;
  topic: string;
  text: string;
}

export interface ConnectConditionCommand {
  type: 'connectCondition';
  mode?: 'transition' | 'requires';
  sourceFunctionName: string;
  targetFunctionName: string;
  choiceText?: string;
  variableName?: string;
  value?: string | number | boolean;
  operator?: '==' | '!=';
  negated?: boolean;
}

export interface AddKnowsInfoRequirementCommand {
  type: 'addKnowsInfoRequirement';
  targetFunctionName: string;
  dialogRef: string;
  npc?: string;
}

export interface RemoveKnowsInfoRequirementCommand {
  type: 'removeKnowsInfoRequirement';
  targetFunctionName: string;
  dialogRef: string;
  npc?: string;
}

export interface RemoveTransitionCommand {
  type: 'removeTransition';
  mode?: 'transition' | 'requires';
  sourceFunctionName: string;
  targetFunctionName: string;
  variableName?: string;
  value?: string | number | boolean;
  operator?: '==' | '!=';
}

export interface RemoveConditionLinkCommand {
  type: 'removeConditionLink';
  targetFunctionName: string;
  variableName: string;
  value: string | number | boolean;
  operator?: '==' | '!=';
}

export interface UpdateConditionLinkCommand {
  type: 'updateConditionLink';
  targetFunctionName: string;
  conditionIndex?: number;
  oldVariableName: string;
  oldValue: string | number | boolean;
  variableName: string;
  value: string | number | boolean;
  operator?: '==' | '!=';
  negated?: boolean;
}

export interface UpdateTransitionTextCommand {
  type: 'updateTransitionText';
  sourceFunctionName: string;
  targetFunctionName: string;
  text: string;
}

export interface MoveNodeCommand {
  type: 'moveNode';
  nodeId: string;
  position: {
    x: number;
    y: number;
  };
}

export type QuestGraphCommand =
  | AddTopicStatusCommand
  | SetMisStateCommand
  | AddLogEntryCommand
  | ConnectConditionCommand
  | AddKnowsInfoRequirementCommand
  | RemoveKnowsInfoRequirementCommand
  | RemoveTransitionCommand
  | RemoveConditionLinkCommand
  | UpdateConditionLinkCommand
  | UpdateTransitionTextCommand
  | MoveNodeCommand;

export interface QuestCommandContext {
  questName: string;
  model: SemanticModel;
}

export interface QuestCommandError {
  code:
    | 'UNKNOWN_COMMAND'
    | 'UNSUPPORTED_COMMAND'
    | 'FUNCTION_NOT_FOUND'
    | 'INVALID_VARIABLE_NAME'
    | 'INVALID_OPERATOR'
    | 'INVALID_VALUE'
    | 'INVALID_STATUS'
    | 'INVALID_TEXT'
    | 'TRANSITION_ALREADY_EXISTS'
    | 'TRANSITION_NOT_FOUND'
    | 'CONDITION_ALREADY_EXISTS'
    | 'CONDITION_NOT_FOUND'
    | 'INVALID_CONDITION_LINK';
  message: string;
}

export interface QuestCommandSuccess {
  ok: true;
  updatedModel: SemanticModel;
  affectedFunctionNames: string[];
}

export interface QuestCommandFailure {
  ok: false;
  errors: QuestCommandError[];
}

export type QuestCommandResult = QuestCommandSuccess | QuestCommandFailure;
