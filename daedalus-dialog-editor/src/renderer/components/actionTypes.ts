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
  quantity: number | string;
}

export interface GiveInventoryItemsAction {
  type: 'GiveInventoryItems';
  giver: string;
  receiver: string;
  item: string;
  quantity: number | string;
}

export interface AttackAction {
  type: 'AttackAction';
  attacker: string;
  target: string;
  attackReason: string;
  damage: number | string;
}

export interface SetAttitudeAction {
  type: 'SetAttitudeAction';
  target: string;
  attitude: string;
}

export interface ChapterTransitionAction {
  type: 'ChapterTransitionAction';
  chapter: number | string;
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

export interface SetRefuseTalkAction {
  type: 'SetRefuseTalkAction';
  target: string;
  seconds: number | string;
}

export interface ClearChoicesAction {
  type: 'ClearChoicesAction';
  dialog: string;
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
  /** Absent for the 2-arg `Npc_RemoveInvItem` engine form. */
  removeQuantity?: string;
}

export interface InsertNpcAction {
  type: 'InsertNpcAction';
  npcInstance: string;
  spawnPoint: string;
}

export interface HeroFollowsAction {
  type: 'HeroFollowsAction';
  guideRoutine: string;
}

export interface CustomAction {
  type: 'CustomAction';
  action: string;
}

/**
 * A standalone comment inside a function or condition body, preserved in
 * source position (mirrors the parser's `CommentAction`). Read-only in the
 * editor UI; regenerates verbatim with no trailing `;`.
 */
export interface CommentAction {
  type: 'CommentAction';
  text: string;
}

export interface ConditionalAction {
  type: 'ConditionalAction';
  condition: string;
  thenActions: ActionType[];
  elseActions: ActionType[];
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
  | SetRefuseTalkAction
  | ClearChoicesAction
  | GivePlayerXPAction
  | PickpocketAction
  | StartOtherRoutineAction
  | TeachAction
  | GiveTradeInventoryAction
  | RemoveInventoryItemsAction
  | InsertNpcAction
  | HeroFollowsAction
  | ConditionalAction
  | Action
  | CommentAction
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
  | 'setRefuseTalkAction'
  | 'clearChoicesAction'
  | 'givePlayerXPAction'
  | 'pickpocketAction'
  | 'startOtherRoutineAction'
  | 'teachAction'
  | 'giveTradeInventoryAction'
  | 'removeInventoryItemsAction'
  | 'insertNpcAction'
  | 'heroFollowsAction'
  | 'conditionalAction'
  | 'commentAction'
  | 'customAction';

export type UnknownDialogAction = Record<string, unknown>;

export type DetectableAction = object;

/**
 * Map from the `type` discriminant field value to the ActionTypeId.
 * This is the primary detection mechanism -- fast and unambiguous.
 */
const TYPE_TO_ID: Record<string, ActionTypeId> = {
  'DialogLine': 'dialogLine',
  'Choice': 'choice',
  'LogEntry': 'logEntry',
  'CreateTopic': 'createTopic',
  'LogSetTopicStatus': 'logSetTopicStatus',
  'CreateInventoryItems': 'createInventoryItems',
  'GiveInventoryItems': 'giveInventoryItems',
  'AttackAction': 'attackAction',
  'SetAttitudeAction': 'setAttitudeAction',
  'ChapterTransitionAction': 'chapterTransition',
  'ExchangeRoutineAction': 'exchangeRoutine',
  'SetVariableAction': 'setVariableAction',
  'StopProcessInfosAction': 'stopProcessInfosAction',
  'PlayAniAction': 'playAniAction',
  'SetRefuseTalkAction': 'setRefuseTalkAction',
  'ClearChoicesAction': 'clearChoicesAction',
  'GivePlayerXPAction': 'givePlayerXPAction',
  'PickpocketAction': 'pickpocketAction',
  'StartOtherRoutineAction': 'startOtherRoutineAction',
  'TeachAction': 'teachAction',
  'GiveTradeInventoryAction': 'giveTradeInventoryAction',
  'RemoveInventoryItemsAction': 'removeInventoryItemsAction',
  'InsertNpcAction': 'insertNpcAction',
  'HeroFollowsAction': 'heroFollowsAction',
  'ConditionalAction': 'conditionalAction',
  'Action': 'customAction',
  'CommentAction': 'commentAction',
  'CustomAction': 'customAction',
};

/**
 * Detect the action type from an action object.
 * Uses the `type` discriminant field as the primary lookup.
 * Falls back to `'customAction'` for unrecognized or missing type values.
 */
export function getActionType(action: DetectableAction): ActionTypeId {
  if ('type' in action && typeof (action as Record<string, unknown>).type === 'string') {
    const mapped = TYPE_TO_ID[(action as Record<string, unknown>).type as string];
    if (mapped) return mapped;
  }

  // Fallback for legacy actions without a `type` field
  return 'customAction';
}

