/**
 * Default templates for creating new actions
 * Centralizes all default values in one place
 */

import type {
  DialogLineAction,
  ChoiceAction,
  LogEntryAction,
  CreateTopicAction,
  LogSetTopicStatusAction,
  CreateInventoryItemsAction,
  GiveInventoryItemsAction,
  AttackAction,
  SetAttitudeAction,
  ChapterTransitionAction,
  ExchangeRoutineAction,
  SetVariableAction,
  StopProcessInfosAction,
  PlayAniAction,
  GivePlayerXPAction,
  PickpocketAction,
  StartOtherRoutineAction,
  TeachAction,
  GiveTradeInventoryAction,
  RemoveInventoryItemsAction,
  InsertNpcAction,
  CustomAction
} from './actionTypes';

export const ACTION_TEMPLATES = {
  dialogLine: (speaker: 'self' | 'other' = 'other', text: string = ''): DialogLineAction => ({
    type: 'DialogLine',
    speaker,
    text,
    id: 'NEW_LINE_ID'
  }),

  choice: (dialogRef: string, text: string = '', targetFunction: string = ''): ChoiceAction => ({
    type: 'Choice',
    dialogRef,
    text,
    targetFunction
  }),

  logEntry: (topic: string = 'TOPIC_NAME', text: string = ''): LogEntryAction => ({
    type: 'LogEntry',
    topic,
    text
  }),

  createTopic: (topic: string = 'TOPIC_NAME', topicType: string = 'LOG_MISSION'): CreateTopicAction => ({
    type: 'CreateTopic',
    topic,
    topicType
  }),

  logSetTopicStatus: (topic: string = 'TOPIC_NAME', status: string = 'LOG_SUCCESS'): LogSetTopicStatusAction => ({
    type: 'LogSetTopicStatus',
    topic,
    status
  }),

  createInventoryItems: (target: string = 'hero', item: string = 'ItMi_Gold', quantity: number = 1): CreateInventoryItemsAction => ({
    type: 'CreateInventoryItems',
    target,
    item,
    quantity
  }),

  giveInventoryItems: (giver: string = 'self', receiver: string = 'hero', item: string = 'ItMi_Gold', quantity: number = 1): GiveInventoryItemsAction => ({
    type: 'GiveInventoryItems',
    giver,
    receiver,
    item,
    quantity
  }),

  attackAction: (attacker: string = 'self', target: string = 'hero', attackReason: string = 'ATTACK_REASON_KILL', damage: number = 0): AttackAction => ({
    type: 'AttackAction',
    attacker,
    target,
    attackReason,
    damage
  }),

  setAttitudeAction: (target: string = 'self', attitude: string = 'ATT_FRIENDLY'): SetAttitudeAction => ({
    type: 'SetAttitudeAction',
    target,
    attitude
  }),

  chapterTransition: (chapter: number = 1, world: string = 'NEWWORLD_ZEN'): ChapterTransitionAction => ({
    type: 'ChapterTransitionAction',
    chapter,
    world
  }),

  exchangeRoutine: (target: string = 'self', routine: string = 'START'): ExchangeRoutineAction => ({
    type: 'ExchangeRoutineAction',
    target,
    routine
  }),

  setVariableAction: (variableName: string = 'MIS_Quest', operator: string = '=', value: string | number | boolean = 'LOG_RUNNING'): SetVariableAction => ({
    type: 'SetVariableAction',
    variableName,
    operator,
    value
  }),

  stopProcessInfosAction: (target: string = 'self'): StopProcessInfosAction => ({
    type: 'StopProcessInfosAction',
    target
  }),

  playAniAction: (target: string = 'self', animationName: string = 'T_SEARCH'): PlayAniAction => ({
    type: 'PlayAniAction',
    target,
    animationName
  }),

  givePlayerXPAction: (xpAmount: string = 'XP_Ambient'): GivePlayerXPAction => ({
    type: 'GivePlayerXPAction',
    xpAmount
  }),

  pickpocketAction: (
    pickpocketMode: 'B_Beklauen' | 'C_Beklauen' = 'B_Beklauen',
    minChance: string = '10',
    maxChance: string = '90'
  ): PickpocketAction => ({
    type: 'PickpocketAction',
    pickpocketMode,
    minChance,
    maxChance
  }),

  startOtherRoutineAction: (
    routineFunctionName: 'B_StartOtherRoutine' | 'B_StartotherRoutine' = 'B_StartOtherRoutine',
    routineNpc: string = 'self',
    routineName: string = 'START'
  ): StartOtherRoutineAction => ({
    type: 'StartOtherRoutineAction',
    routineFunctionName,
    routineNpc,
    routineName
  }),

  teachAction: (teachFunctionName: string = 'B_TeachPlayerTalentRunes', teachArgs: string[] = ['self', 'other', 'SPL_LIGHT']): TeachAction => ({
    type: 'TeachAction',
    teachFunctionName,
    teachArgs
  }),

  giveTradeInventoryAction: (tradeTarget: string = 'self'): GiveTradeInventoryAction => ({
    type: 'GiveTradeInventoryAction',
    tradeTarget
  }),

  removeInventoryItemsAction: (
    removeFunctionName: 'Npc_RemoveInvItems' | 'Npc_RemoveInvItem' = 'Npc_RemoveInvItems',
    removeNpc: string = 'self',
    removeItem: string = 'ItMi_Gold',
    removeQuantity: string = '1'
  ): RemoveInventoryItemsAction => ({
    type: 'RemoveInventoryItemsAction',
    removeFunctionName,
    removeNpc,
    removeItem,
    removeQuantity
  }),

  insertNpcAction: (npcInstance: string = 'NONE_100_XARDAS', spawnPoint: string = 'WP_START'): InsertNpcAction => ({
    type: 'InsertNpcAction',
    npcInstance,
    spawnPoint
  }),

  customAction: (action: string = 'AI_StopProcessInfos(self)'): CustomAction => ({
    type: 'CustomAction',
    action
  })
};

/**
 * Get the opposite speaker for dialog lines
 */
export function getOppositeSpeaker(speaker: 'self' | 'other'): 'self' | 'other' {
  return speaker === 'self' ? 'other' : 'self';
}
