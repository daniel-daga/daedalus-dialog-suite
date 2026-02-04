/**
 * Proper TypeScript type definitions for all action types in the dialog system
 */

export interface DialogLineAction {
  speaker: 'self' | 'other';
  text: string;
  id: string;
}

export interface ChoiceAction {
  dialogRef: string;
  text: string;
  targetFunction: string;
}

export interface LogEntryAction {
  topic: string;
  text: string;
}

export interface CreateTopicAction {
  topic: string;
  topicType: string;
}

export interface LogSetTopicStatusAction {
  topic: string;
  status: string;
}

export interface CreateInventoryItemsAction {
  target: string;
  item: string;
  quantity: number;
}

export interface GiveInventoryItemsAction {
  giver: string;
  receiver: string;
  item: string;
  quantity: number;
}

export interface AttackAction {
  attacker: string;
  target: string;
  attackReason: string;
  damage: number;
}

export interface SetAttitudeAction {
  target: string;
  attitude: string;
}

export interface ChapterTransitionAction {
  chapter: number;
  world: string;
}

export interface ExchangeRoutineAction {
  target?: string;
  npc?: string;
  routine: string;
}

export interface SetVariableAction {
  variableName: string;
  operator: string;
  value: string | number | boolean;
}

export interface StopProcessInfosAction {
  target: string;
}

export interface PlayAniAction {
  target: string;
  animationName: string;
}

export interface CustomAction {
  action: string;
}

/**
 * Discriminated union of all action types
 */
export type ActionType =
  | DialogLineAction
  | ChoiceAction
  | LogEntryAction
  | CreateTopicAction
  | LogSetTopicStatusAction
  | CreateInventoryItemsAction
  | GiveInventoryItemsAction
  | AttackAction
  | SetAttitudeAction
  | ChapterTransitionAction
  | ExchangeRoutineAction
  | SetVariableAction
  | StopProcessInfosAction
  | PlayAniAction
  | CustomAction;

/**
 * Action type identifiers
 */
export type ActionTypeId =
  | 'dialogLine'
  | 'choice'
  | 'logEntry'
  | 'createTopic'
  | 'logSetTopicStatus'
  | 'createInventoryItems'
  | 'giveInventoryItems'
  | 'attackAction'
  | 'setAttitudeAction'
  | 'chapterTransition'
  | 'exchangeRoutine'
  | 'setVariableAction'
  | 'stopProcessInfosAction'
  | 'playAniAction'
  | 'customAction';

/**
 * Detect the action type from an action object
 */
export function getActionType(action: any): ActionTypeId {
  if (action.speaker !== undefined && action.text !== undefined && action.id !== undefined) {
    return 'dialogLine';
  }
  if (action.dialogRef !== undefined && action.targetFunction !== undefined) {
    return 'choice';
  }
  if (action.topic !== undefined && action.topicType !== undefined && !action.status) {
    return 'createTopic';
  }
  if (action.topic !== undefined && action.text !== undefined && !action.topicType) {
    return 'logEntry';
  }
  if (action.topic !== undefined && action.status !== undefined) {
    return 'logSetTopicStatus';
  }
  if (action.target !== undefined && action.item !== undefined && action.quantity !== undefined &&
      action.giver === undefined && action.receiver === undefined) {
    return 'createInventoryItems';
  }
  if (action.giver !== undefined && action.receiver !== undefined) {
    return 'giveInventoryItems';
  }
  if (action.attacker !== undefined && action.attackReason !== undefined) {
    return 'attackAction';
  }
  if (action.attitude !== undefined && action.routine === undefined) {
    return 'setAttitudeAction';
  }
  if (action.chapter !== undefined && action.world !== undefined) {
    return 'chapterTransition';
  }
  if ((action.npc !== undefined || action.target !== undefined) && action.routine !== undefined && action.attitude === undefined) {
    return 'exchangeRoutine';
  }
  if (action.variableName !== undefined && action.operator !== undefined && action.value !== undefined) {
    return 'setVariableAction';
  }
  if (action.target !== undefined && action.animationName !== undefined) {
    return 'playAniAction';
  }
  // Loose check for StopProcessInfos - assuming it only has target
  if (action.target !== undefined &&
      action.item === undefined &&
      action.attitude === undefined &&
      action.routine === undefined &&
      action.animationName === undefined) {
    return 'stopProcessInfosAction';
  }
  if (action.action !== undefined) {
    return 'customAction';
  }

  return 'customAction'; // Fallback
}
