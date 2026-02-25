/**
 * Factory for creating actions with context-aware defaults
 * Centralizes action creation logic to eliminate duplication
 */

import { ACTION_TEMPLATES, getOppositeSpeaker } from './actionTemplates';
import type { ActionTypeId } from './actionTypes';

type DialogSpeaker = 'self' | 'other';

interface ParsedDialogLineId {
  token: string;
  index: number;
  indexRaw: string;
}

const DEFAULT_DIALOG_SPEAKER_TOKEN: Record<DialogSpeaker, string> = {
  self: '08',
  other: '15'
};

/**
 * Generate a unique ID for an action
 */
export function generateActionId(): string {
  return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveDialogNameForLineId(contextName: string | undefined): string | null {
  if (!contextName || !contextName.trim()) {
    return null;
  }

  const trimmed = contextName.trim();
  return trimmed.endsWith('_Info') ? trimmed.slice(0, -5) : trimmed;
}

function parseDialogLineId(id: string, dialogName?: string): ParsedDialogLineId | null {
  if (!id || typeof id !== 'string') {
    return null;
  }

  const pattern = dialogName
    ? new RegExp(`^${escapeRegExp(dialogName)}_(\\d+)_([0-9]+)$`)
    : /^(?:.+)_(\d+)_([0-9]+)$/;
  const match = id.match(pattern);
  if (!match) {
    return null;
  }

  const index = Number.parseInt(match[2], 10);
  if (!Number.isFinite(index)) {
    return null;
  }

  return {
    token: match[1],
    index,
    indexRaw: match[2]
  };
}

function chooseSpeakerToken(
  speaker: DialogSpeaker,
  actions: any[]
): string {
  const tokenCounts = new Map<string, number>();

  for (const action of actions) {
    if (!action || action.type !== 'DialogLine' || action.speaker !== speaker || typeof action.id !== 'string') {
      continue;
    }

    const parsed = parseDialogLineId(action.id);
    if (!parsed) {
      continue;
    }

    tokenCounts.set(parsed.token, (tokenCounts.get(parsed.token) || 0) + 1);
  }

  if (tokenCounts.size === 0) {
    return DEFAULT_DIALOG_SPEAKER_TOKEN[speaker];
  }

  let bestToken = DEFAULT_DIALOG_SPEAKER_TOKEN[speaker];
  let bestCount = -1;
  tokenCounts.forEach((count, token) => {
    if (count > bestCount) {
      bestToken = token;
      bestCount = count;
    }
  });

  return bestToken;
}

export interface DialogLineIdOptions {
  dialogName?: string;
  speaker: DialogSpeaker;
  actions?: any[];
}

export function createDialogLineId(options: DialogLineIdOptions): string {
  const { speaker } = options;
  const actions = options.actions || [];
  const dialogName = resolveDialogNameForLineId(options.dialogName) || 'DIA_NewDialog';

  let maxIndex = -1;
  let indexWidth = 2;
  const existingIds = new Set<string>();

  for (const action of actions) {
    if (!action || action.type !== 'DialogLine' || typeof action.id !== 'string') {
      continue;
    }

    existingIds.add(action.id);
    const parsed = parseDialogLineId(action.id, dialogName);
    if (!parsed) {
      continue;
    }

    if (parsed.index > maxIndex) {
      maxIndex = parsed.index;
    }
    indexWidth = Math.max(indexWidth, parsed.indexRaw.length);
  }

  const token = chooseSpeakerToken(speaker, actions);
  let nextIndex = maxIndex + 1;
  let candidate = '';

  do {
    candidate = `${dialogName}_${token}_${String(nextIndex).padStart(indexWidth, '0')}`;
    nextIndex += 1;
  } while (existingIds.has(candidate));

  return candidate;
}

export interface ActionCreationContext {
  dialogName?: string;
  currentAction?: any;
  semanticModel?: any;
  actions?: any[];
}

/**
 * Create a new action based on type and context
 */
export function createAction(
  actionType: ActionTypeId,
  context: ActionCreationContext = {}
): any {
  const { dialogName, currentAction, actions } = context;

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

  if (actionType === 'dialogLine' && action && action.speaker) {
    action.id = createDialogLineId({
      dialogName,
      speaker: action.speaker,
      actions: actions || []
    });
  } else if (action && (!action.id || action.id === 'NEW_LINE_ID')) {
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
    currentAction,
    actions
  });
}
