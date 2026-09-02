/**
 * Action renderer registry
 * Maps action type IDs to their corresponding renderer components
 */

import React from 'react';
import { getActionType } from '../actionTypes';
import type { ActionTypeId, DetectableAction } from '../actionTypes';
import { ACTION_TYPE_REGISTRY } from '../actionTypeRegistry';
import type { BaseActionRendererProps } from './types';

import DialogLineRenderer from './DialogLineRenderer';
import ChoiceRenderer from './ChoiceRenderer';
import LogEntryRenderer from './LogEntryRenderer';
import CreateTopicRenderer from './CreateTopicRenderer';
import LogSetTopicStatusRenderer from './LogSetTopicStatusRenderer';
import CreateInventoryItemsRenderer from './CreateInventoryItemsRenderer';
import GiveInventoryItemsRenderer from './GiveInventoryItemsRenderer';
import AttackActionRenderer from './AttackActionRenderer';
import SetAttitudeActionRenderer from './SetAttitudeActionRenderer';
import ChapterTransitionRenderer from './ChapterTransitionRenderer';
import ExchangeRoutineRenderer from './ExchangeRoutineRenderer';
import SetVariableActionRenderer from './SetVariableActionRenderer';
import StopProcessInfosActionRenderer from './StopProcessInfosActionRenderer';
import SetRefuseTalkActionRenderer from './SetRefuseTalkActionRenderer';
import ClearChoicesActionRenderer from './ClearChoicesActionRenderer';
import PlayAniActionRenderer from './PlayAniActionRenderer';
import GivePlayerXPActionRenderer from './GivePlayerXPActionRenderer';
import PickpocketActionRenderer from './PickpocketActionRenderer';
import StartOtherRoutineActionRenderer from './StartOtherRoutineActionRenderer';
import TeachActionRenderer from './TeachActionRenderer';
import GiveTradeInventoryActionRenderer from './GiveTradeInventoryActionRenderer';
import RemoveInventoryItemsActionRenderer from './RemoveInventoryItemsActionRenderer';
import InsertNpcActionRenderer from './InsertNpcActionRenderer';
import HeroFollowsActionRenderer from './HeroFollowsActionRenderer';
import ConditionalActionRenderer from './ConditionalActionRenderer';
import CustomActionRenderer from './CustomActionRenderer';
import CommentActionRenderer from './CommentActionRenderer';
import UnknownActionRenderer from './UnknownActionRenderer';

/**
 * Registry mapping action type IDs to their renderer components
 */
export const ACTION_RENDERERS: Record<ActionTypeId, React.FC<BaseActionRendererProps>> = {
  dialogLine: DialogLineRenderer,
  choice: ChoiceRenderer,
  logEntry: LogEntryRenderer,
  createTopic: CreateTopicRenderer,
  logSetTopicStatus: LogSetTopicStatusRenderer,
  createInventoryItems: CreateInventoryItemsRenderer,
  giveInventoryItems: GiveInventoryItemsRenderer,
  attackAction: AttackActionRenderer,
  setAttitudeAction: SetAttitudeActionRenderer,
  chapterTransition: ChapterTransitionRenderer,
  exchangeRoutine: ExchangeRoutineRenderer,
  setVariableAction: SetVariableActionRenderer,
  stopProcessInfosAction: StopProcessInfosActionRenderer,
  setRefuseTalkAction: SetRefuseTalkActionRenderer,
  clearChoicesAction: ClearChoicesActionRenderer,
  playAniAction: PlayAniActionRenderer,
  givePlayerXPAction: GivePlayerXPActionRenderer,
  pickpocketAction: PickpocketActionRenderer,
  startOtherRoutineAction: StartOtherRoutineActionRenderer,
  teachAction: TeachActionRenderer,
  giveTradeInventoryAction: GiveTradeInventoryActionRenderer,
  removeInventoryItemsAction: RemoveInventoryItemsActionRenderer,
  insertNpcAction: InsertNpcActionRenderer,
  heroFollowsAction: HeroFollowsActionRenderer,
  conditionalAction: ConditionalActionRenderer,
  commentAction: CommentActionRenderer,
  customAction: CustomActionRenderer
};

/**
 * Get the appropriate renderer for an action
 */
export function getRendererForAction(action: DetectableAction): React.FC<BaseActionRendererProps> {
  const actionType = getActionType(action);
  return ACTION_RENDERERS[actionType] || UnknownActionRenderer;
}

/**
 * Get the display label for an action (from the action type registry)
 */
export function getActionTypeLabel(action: DetectableAction): string {
  const actionType = getActionType(action);
  return ACTION_TYPE_REGISTRY[actionType]?.label || 'Unknown';
}
