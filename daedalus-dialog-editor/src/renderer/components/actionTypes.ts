/**
 * Proper TypeScript type definitions for all action types in the dialog system
 */

export interface DialogLineAction {
  type: 'DialogLine';
  speaker: 'self' | 'other';
  text: string;
  id: string;
}

export interface ChoiceAction {
  type: 'Choice';
  dialogRef: string;
  text: string;
  targetFunction: string;
}

export interface LogEntryAction {
  type: 'LogEntry';
  topic: string;
  text: string;
}

export interface CreateTopicAction {
  type: 'CreateTopic';
  topic: string;
  topicType: string;
}

export interface LogSetTopicStatusAction {
  type: 'LogSetTopicStatus';
  topic: string;
  status: string;
}

export interface CreateInventoryItemsAction {
  type: 'CreateInventoryItems';
  target: string;
  item: string;
  quantity: number;
}

export interface GiveInventoryItemsAction {
  type: 'GiveInventoryItems';
  giver: string;
  receiver: string;
  item: string;
  quantity: number;
}

export interface AttackAction {
  type: 'AttackAction';
  attacker: string;
  target: string;
  attackReason: string;
  damage: number;
}

export interface SetAttitudeAction {
  type: 'SetAttitudeAction';
  target: string;
  attitude: string;
}

export interface ChapterTransitionAction {
  type: 'ChapterTransitionAction';
  chapter: number;
  world: string;
}

export interface ExchangeRoutineAction {
  type: 'ExchangeRoutineAction';
  target?: string;
  npc?: string;
  routine: string;
}

export interface SetVariableAction {
  type: 'SetVariableAction';
  variableName: string;
  operator: string;
  value: string | number | boolean;
}

export interface StopProcessInfosAction {
  type: 'StopProcessInfosAction';
  target: string;
}

export interface PlayAniAction {
  type: 'PlayAniAction';
  target: string;
  animationName: string;
}

export interface Action {
  type: 'Action';
  action: string;
}

export interface GivePlayerXPAction {
  type: 'GivePlayerXPAction';
  xpAmount: string;
}

export interface PickpocketAction {
  type: 'PickpocketAction';
  pickpocketMode: 'B_Beklauen' | 'C_Beklauen';
  minChance?: string;
  maxChance?: string;
}

export interface StartOtherRoutineAction {
  type: 'StartOtherRoutineAction';
  routineFunctionName: 'B_StartOtherRoutine' | 'B_StartotherRoutine';
  routineNpc: string;
  routineName: string;
}

export interface TeachAction {
  type: 'TeachAction';
  teachFunctionName: string;
  teachArgs: string[];
}

export interface GiveTradeInventoryAction {
  type: 'GiveTradeInventoryAction';
  tradeTarget: string;
}

export interface RemoveInventoryItemsAction {
  type: 'RemoveInventoryItemsAction';
  removeFunctionName: 'Npc_RemoveInvItems' | 'Npc_RemoveInvItem';
  removeNpc: string;
  removeItem: string;
  removeQuantity: string;
}

export interface InsertNpcAction {
  type: 'InsertNpcAction';
  npcInstance: string;
  spawnPoint: string;
}

export interface CustomAction {
  type: 'CustomAction';
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
  | GivePlayerXPAction
  | PickpocketAction
  | StartOtherRoutineAction
  | TeachAction
  | GiveTradeInventoryAction
  | RemoveInventoryItemsAction
  | InsertNpcAction
  | Action
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
  | 'givePlayerXPAction'
  | 'pickpocketAction'
  | 'startOtherRoutineAction'
  | 'teachAction'
  | 'giveTradeInventoryAction'
  | 'removeInventoryItemsAction'
  | 'insertNpcAction'
  | 'customAction';

export type UnknownDialogAction = Record<string, unknown>;

export type DetectableAction = ActionType | UnknownDialogAction;

function hasProperty<T extends string>(value: Record<string, unknown>, key: T): value is Record<T, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Detect the action type from an action object
 */
export function getActionType(action: DetectableAction): ActionTypeId {
  const a = action;

  if (hasProperty(a, 'speaker') && hasProperty(a, 'text') && hasProperty(a, 'id')) {
    return 'dialogLine';
  }
  if (hasProperty(a, 'dialogRef') && hasProperty(a, 'targetFunction')) {
    return 'choice';
  }
  if (hasProperty(a, 'topic') && hasProperty(a, 'topicType') && !hasProperty(a, 'status')) {
    return 'createTopic';
  }
  if (hasProperty(a, 'topic') && hasProperty(a, 'text') && !hasProperty(a, 'topicType')) {
    return 'logEntry';
  }
  if (hasProperty(a, 'topic') && hasProperty(a, 'status')) {
    return 'logSetTopicStatus';
  }
  if (hasProperty(a, 'target') && hasProperty(a, 'item') && hasProperty(a, 'quantity') &&
      !hasProperty(a, 'giver') && !hasProperty(a, 'receiver')) {
    return 'createInventoryItems';
  }
  if (hasProperty(a, 'giver') && hasProperty(a, 'receiver')) {
    return 'giveInventoryItems';
  }
  if (hasProperty(a, 'attacker') && hasProperty(a, 'attackReason')) {
    return 'attackAction';
  }
  if (hasProperty(a, 'attitude') && !hasProperty(a, 'routine')) {
    return 'setAttitudeAction';
  }
  if (hasProperty(a, 'chapter') && hasProperty(a, 'world')) {
    return 'chapterTransition';
  }
  if ((hasProperty(a, 'npc') || hasProperty(a, 'target')) && hasProperty(a, 'routine') && !hasProperty(a, 'attitude')) {
    return 'exchangeRoutine';
  }
  if (hasProperty(a, 'variableName') && hasProperty(a, 'operator') && hasProperty(a, 'value')) {
    return 'setVariableAction';
  }
  if (hasProperty(a, 'target') && hasProperty(a, 'animationName')) {
    return 'playAniAction';
  }
  if (hasProperty(a, 'xpAmount')) {
    return 'givePlayerXPAction';
  }
  if (hasProperty(a, 'pickpocketMode')) {
    return 'pickpocketAction';
  }
  if (hasProperty(a, 'routineFunctionName') && hasProperty(a, 'routineNpc')) {
    return 'startOtherRoutineAction';
  }
  if (hasProperty(a, 'teachFunctionName') && hasProperty(a, 'teachArgs') && Array.isArray(a.teachArgs)) {
    return 'teachAction';
  }
  if (hasProperty(a, 'tradeTarget')) {
    return 'giveTradeInventoryAction';
  }
  if (hasProperty(a, 'removeFunctionName') && hasProperty(a, 'removeNpc')) {
    return 'removeInventoryItemsAction';
  }
  if (hasProperty(a, 'npcInstance') && hasProperty(a, 'spawnPoint')) {
    return 'insertNpcAction';
  }
  // Loose check for StopProcessInfos - assuming it only has target
  if (hasProperty(a, 'target') &&
      !hasProperty(a, 'item') &&
      !hasProperty(a, 'attitude') &&
      !hasProperty(a, 'routine') &&
      !hasProperty(a, 'animationName')) {
    return 'stopProcessInfosAction';
  }
  if (hasProperty(a, 'action')) {
    return 'customAction';
  }

  return 'customAction'; // Fallback
}
