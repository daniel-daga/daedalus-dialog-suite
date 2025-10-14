/**
 * Action renderer registry
 * Maps action type IDs to their corresponding renderer components
 */

import React from 'react';
import { getActionType } from '../actionTypes';
import type { ActionTypeId } from '../actionTypes';
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
import CustomActionRenderer from './CustomActionRenderer';
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
  customAction: CustomActionRenderer
};

/**
 * Get the appropriate renderer for an action
 */
export function getRendererForAction(action: any): React.FC<BaseActionRendererProps> {
  const actionType = getActionType(action);
  return ACTION_RENDERERS[actionType] || UnknownActionRenderer;
}

/**
 * Action type labels for UI display
 */
export const ACTION_TYPE_LABELS: Record<ActionTypeId, string> = {
  dialogLine: 'Dialog Line',
  choice: 'Choice',
  logEntry: 'Log Entry',
  createTopic: 'Create Topic',
  logSetTopicStatus: 'Log Set Status',
  createInventoryItems: 'Create Inventory Items',
  giveInventoryItems: 'Give Inventory Items',
  attackAction: 'Attack Action',
  setAttitudeAction: 'Set Attitude',
  chapterTransition: 'Chapter Transition',
  exchangeRoutine: 'Exchange Routine',
  customAction: 'Action'
};

/**
 * Get the display label for an action
 */
export function getActionTypeLabel(action: any): string {
  const actionType = getActionType(action);
  return ACTION_TYPE_LABELS[actionType] || 'Unknown';
}
