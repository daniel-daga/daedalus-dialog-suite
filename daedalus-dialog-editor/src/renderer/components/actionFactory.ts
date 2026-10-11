/**
 * Factory for creating actions with context-aware defaults
 * Centralizes action creation logic to eliminate duplication
 */

import { ACTION_TEMPLATES, getOppositeSpeaker } from './actionTemplates';
import type { ActionTypeId } from './actionTypes';
import type { DialogAction, SemanticModel } from '../types/global';

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
  return `action_${crypto.randomUUID()}`;
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
  actions: DialogAction[]
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
  actions?: DialogAction[];
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
  currentAction?: DialogAction;
  semanticModel?: SemanticModel;
  actions?: DialogAction[];
}

/**
 * Find the item name from the first "NPC has item" condition
 * (NpcHasItemsCondition) on the dialog instance's condition function, or null.
 * Used to pre-fill the Item of a new "Give Inventory Item" action (issue #183
 * item 2): a dialog that gates on the hero owning item X almost always wants to
 * give / hand back that same item X.
 */
function findHasItemConditionItem(
  semanticModel: SemanticModel | undefined,
  dialogName: string | undefined
): string | null {
  if (!semanticModel?.dialogs || !dialogName) {
    return null;
  }

  const dialog =
    semanticModel.dialogs[dialogName] ||
    (dialogName.endsWith('_Info') ? semanticModel.dialogs[dialogName.slice(0, -5)] : undefined);

  const conditionRef = dialog?.properties?.condition;
  const conditionName = typeof conditionRef === 'string' ? conditionRef : conditionRef?.name;
  if (!conditionName) {
    return null;
  }

  const conditions = semanticModel.functions?.[conditionName]?.conditions || [];
  for (const condition of conditions) {
    if (condition && condition.type === 'NpcHasItemsCondition') {
      const item = (condition as { item?: string }).item;
      if (item) {
        return item;
      }
    }
  }

  return null;
}

/**
 * Create a new action based on type and context
 */
export function createAction(
  actionType: ActionTypeId,
  context: ActionCreationContext = {}
): DialogAction {
  const { dialogName, currentAction, actions, semanticModel } = context;

  let action: DialogAction;

  // Handle special cases that need context-aware arguments
  if (actionType === 'dialogLine') {
    const speaker = currentAction && 'speaker' in currentAction && currentAction.speaker
      ? getOppositeSpeaker(currentAction.speaker)
      : 'other';
    action = ACTION_TEMPLATES.dialogLine(speaker, '');
  } else if (actionType === 'choice') {
    action = ACTION_TEMPLATES.choice(dialogName || '', '', '');
  } else if (actionType === 'clearChoicesAction') {
    // Auto-fill the dialog instance from the current dialog context (issue #123).
    action = ACTION_TEMPLATES.clearChoicesAction(dialogName || '');
  } else if (actionType === 'giveInventoryItems') {
    // Pre-fill the Item from an "NPC has item" condition on the same dialog
    // instance, keeping the giver/receiver template defaults (issue #183 item 2).
    const seededItem = findHasItemConditionItem(semanticModel, dialogName);
    action = seededItem
      ? ACTION_TEMPLATES.giveInventoryItems(undefined, undefined, seededItem)
      : ACTION_TEMPLATES.giveInventoryItems();
  } else {
    // All other action types use default arguments.
    // CommentAction is parser-preserved-only (not offered in the "add action"
    // menu: `addable: false` in actionTypeRegistry) and has no template here.
    const templateFn = (ACTION_TEMPLATES as Partial<Record<ActionTypeId, () => DialogAction>>)[actionType];
    if (!templateFn) {
      throw new Error(`Unknown action type: ${actionType}`);
    }
    action = templateFn();
  }

  if (actionType === 'dialogLine' && 'speaker' in action) {
    action = {
      ...action,
      id: createDialogLineId({
        dialogName,
        speaker: action.speaker,
        actions: actions || []
      })
    };
  } else if (!('id' in action) || !action.id || action.id === 'NEW_LINE_ID') {
    action = { ...action, id: generateActionId() } as DialogAction;
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
  actions: DialogAction[],
  dialogName?: string,
  semanticModel?: SemanticModel
): DialogAction {
  const currentAction = actions[index];
  return createAction(actionType, {
    dialogName,
    currentAction,
    actions,
    semanticModel
  });
}
