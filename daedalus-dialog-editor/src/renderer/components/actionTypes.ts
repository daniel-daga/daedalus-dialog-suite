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

/**
 * Detect the action type from an action object
 */
export function getActionType(action: DetectableAction): ActionTypeId {
  const a = action as any;

  if (a.speaker !== undefined && a.text !== undefined && a.id !== undefined) {
    return 'dialogLine';
  }
  if (a.dialogRef !== undefined && a.targetFunction !== undefined) {
    return 'choice';
  }
  if (a.topic !== undefined && a.topicType !== undefined && !a.status) {
    return 'createTopic';
  }
  if (a.topic !== undefined && a.text !== undefined && !a.topicType) {
    return 'logEntry';
  }
  if (a.topic !== undefined && a.status !== undefined) {
    return 'logSetTopicStatus';
  }
  if (a.target !== undefined && a.item !== undefined && a.quantity !== undefined &&
      a.giver === undefined && a.receiver === undefined) {
    return 'createInventoryItems';
  }
  if (a.giver !== undefined && a.receiver !== undefined) {
    return 'giveInventoryItems';
  }
  if (a.attacker !== undefined && a.attackReason !== undefined) {
    return 'attackAction';
  }
  if (a.attitude !== undefined && a.routine === undefined) {
    return 'setAttitudeAction';
  }
  if (a.chapter !== undefined && a.world !== undefined) {
    return 'chapterTransition';
  }
  if ((a.npc !== undefined || a.target !== undefined) && a.routine !== undefined && a.attitude === undefined) {
    return 'exchangeRoutine';
  }
  if (a.variableName !== undefined && a.operator !== undefined && a.value !== undefined) {
    return 'setVariableAction';
  }
  if (a.target !== undefined && a.animationName !== undefined) {
    return 'playAniAction';
  }
  if (a.xpAmount !== undefined) {
    return 'givePlayerXPAction';
  }
  if (a.pickpocketMode !== undefined) {
    return 'pickpocketAction';
  }
  if (a.routineFunctionName !== undefined && a.routineNpc !== undefined) {
    return 'startOtherRoutineAction';
  }
  if (a.teachFunctionName !== undefined && Array.isArray(a.teachArgs)) {
    return 'teachAction';
  }
  if (a.tradeTarget !== undefined) {
    return 'giveTradeInventoryAction';
  }
  if (a.removeFunctionName !== undefined && a.removeNpc !== undefined) {
    return 'removeInventoryItemsAction';
  }
  if (a.npcInstance !== undefined && a.spawnPoint !== undefined) {
    return 'insertNpcAction';
  }
  // Loose check for StopProcessInfos - assuming it only has target
  if (a.target !== undefined &&
      a.item === undefined &&
      a.attitude === undefined &&
      a.routine === undefined &&
      a.animationName === undefined) {
    return 'stopProcessInfosAction';
  }
  if (a.action !== undefined) {
    return 'customAction';
  }

  return 'customAction'; // Fallback
}
