/**
 * Factory for creating actions with context-aware defaults
 * Centralizes action creation logic to eliminate duplication
 */

import { ACTION_TEMPLATES, getOppositeSpeaker } from './actionTemplates';
import type { ActionTypeId } from './actionTypes';

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

  switch (actionType) {
    case 'dialogLine': {
      // Toggle speaker if we have a current action
      const speaker = currentAction?.speaker
        ? getOppositeSpeaker(currentAction.speaker)
        : 'other';
      return ACTION_TEMPLATES.dialogLine(speaker, '');
    }

    case 'choice':
      return ACTION_TEMPLATES.choice(dialogName || '', '', '');

    case 'logEntry':
      return ACTION_TEMPLATES.logEntry();

    case 'createTopic':
      return ACTION_TEMPLATES.createTopic();

    case 'logSetTopicStatus':
      return ACTION_TEMPLATES.logSetTopicStatus();

    case 'createInventoryItems':
      return ACTION_TEMPLATES.createInventoryItems();

    case 'giveInventoryItems':
      return ACTION_TEMPLATES.giveInventoryItems();

    case 'attackAction':
      return ACTION_TEMPLATES.attackAction();

    case 'setAttitudeAction':
      return ACTION_TEMPLATES.setAttitudeAction();

    case 'chapterTransition':
      return ACTION_TEMPLATES.chapterTransition();

    case 'exchangeRoutine':
      return ACTION_TEMPLATES.exchangeRoutine();

    case 'customAction':
      return ACTION_TEMPLATES.customAction();

    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }
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
