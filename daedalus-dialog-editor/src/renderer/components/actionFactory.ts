/**
 * Factory for creating actions with context-aware defaults
 * Centralizes action creation logic to eliminate duplication
 */

import { ACTION_TEMPLATES, getOppositeSpeaker } from './actionTemplates';
import type { ActionTypeId } from './actionTypes';

/**
 * Generate a unique ID for an action
 */
export function generateActionId(): string {
  return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export interface ActionCreationContext {
  dialogName?: string;
  currentAction?: any;
  semanticModel?: any;
}

/**
 * Create a new action based on type and context
 */
export function createAction(
  actionType: ActionTypeId,
  context: ActionCreationContext = {}
): any {
  const { dialogName, currentAction } = context;

  let action: any;
  switch (actionType) {
    case 'dialogLine': {
      // Toggle speaker if we have a current action
      const speaker = currentAction?.speaker
        ? getOppositeSpeaker(currentAction.speaker)
        : 'other';
      action = ACTION_TEMPLATES.dialogLine(speaker, '');
      break;
    }

    case 'choice':
      action = ACTION_TEMPLATES.choice(dialogName || '', '', '');
      break;

    case 'logEntry':
      action = ACTION_TEMPLATES.logEntry();
      break;

    case 'createTopic':
      action = ACTION_TEMPLATES.createTopic();
      break;

    case 'logSetTopicStatus':
      action = ACTION_TEMPLATES.logSetTopicStatus();
      break;

    case 'createInventoryItems':
      action = ACTION_TEMPLATES.createInventoryItems();
      break;

    case 'giveInventoryItems':
      action = ACTION_TEMPLATES.giveInventoryItems();
      break;

    case 'attackAction':
      action = ACTION_TEMPLATES.attackAction();
      break;

    case 'setAttitudeAction':
      action = ACTION_TEMPLATES.setAttitudeAction();
      break;

    case 'chapterTransition':
      action = ACTION_TEMPLATES.chapterTransition();
      break;

    case 'exchangeRoutine':
      action = ACTION_TEMPLATES.exchangeRoutine();
      break;

    case 'setVariableAction':
      action = ACTION_TEMPLATES.setVariableAction();
      break;

    case 'stopProcessInfosAction':
      action = ACTION_TEMPLATES.stopProcessInfosAction();
      break;

    case 'playAniAction':
      action = ACTION_TEMPLATES.playAniAction();
      break;

    case 'givePlayerXPAction':
      action = ACTION_TEMPLATES.givePlayerXPAction();
      break;

    case 'pickpocketAction':
      action = ACTION_TEMPLATES.pickpocketAction();
      break;

    case 'startOtherRoutineAction':
      action = ACTION_TEMPLATES.startOtherRoutineAction();
      break;

    case 'teachAction':
      action = ACTION_TEMPLATES.teachAction();
      break;

    case 'giveTradeInventoryAction':
      action = ACTION_TEMPLATES.giveTradeInventoryAction();
      break;

    case 'removeInventoryItemsAction':
      action = ACTION_TEMPLATES.removeInventoryItemsAction();
      break;

    case 'insertNpcAction':
      action = ACTION_TEMPLATES.insertNpcAction();
      break;

    case 'customAction':
      action = ACTION_TEMPLATES.customAction();
      break;

    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }

  // Ensure every action has a unique ID
  if (action && (!action.id || action.id === 'NEW_LINE_ID')) {
    action.id = generateActionId();
  }

  return action;
}

/**
 * Create an action to be inserted after the specified index
 * Automatically infers context from the action at the given index
 */
export function createActionAfterIndex(
  actionType: ActionTypeId,
  index: number,
  actions: any[],
  dialogName?: string
): any {
  const currentAction = actions[index];
  return createAction(actionType, {
    dialogName,
    currentAction
  });
}
