import type { ConditionalAction, DialogAction } from '../types/global';
import { resolveDialogNameForLineId } from './actionFactory';
import { recognizeQuestSteps, type QuestStep } from '../quest/domain/questSteps';

export type ActionBranchKey = 'then' | 'else';
export type ActionPath = Array<number | ActionBranchKey>;

function isConditionalAction(action: DialogAction | undefined): action is ConditionalAction {
  return !!action && action.type === 'ConditionalAction';
}

function branchProperty(branch: ActionBranchKey): 'thenActions' | 'elseActions' {
  return branch === 'then' ? 'thenActions' : 'elseActions';
}

function cloneBranchWithChildren(
  action: ConditionalAction,
  branch: ActionBranchKey,
  children: DialogAction[]
): ConditionalAction {
  const property = branchProperty(branch);
  return {
    ...action,
    [property]: children
  };
}

export function getActionAtPath(actions: DialogAction[], path: ActionPath): DialogAction | undefined {
  if (path.length === 0) {
    return undefined;
  }

  const [first, ...rest] = path;
  if (typeof first !== 'number') {
    return undefined;
  }

  const action = actions[first];
  if (rest.length === 0) {
    return action;
  }

  const [branch, ...nestedRest] = rest;
  if (branch !== 'then' && branch !== 'else') {
    return undefined;
  }

  if (!isConditionalAction(action)) {
    return undefined;
  }

  return getActionAtPath(action[branchProperty(branch)], nestedRest);
}

export function updateActionAtPath(actions: DialogAction[], path: ActionPath, updatedAction: DialogAction): DialogAction[] {
  const [first, ...rest] = path;
  if (typeof first !== 'number') {
    return actions;
  }

  // Only write an in-range slot. An out-of-range index (e.g. `first === length`)
  // means the card was reindexed/removed while a debounce was pending: without
  // this guard the write below appends a resurrected action, corrupting the list
  // (0.1). Mirrors ConditionEditor's updateCondition bounds check.
  if (first < 0 || first >= actions.length) {
    return actions;
  }

  const nextActions = [...actions];
  if (rest.length === 0) {
    nextActions[first] = updatedAction;
    return nextActions;
  }

  const [branch, ...nestedRest] = rest;
  if ((branch !== 'then' && branch !== 'else') || !isConditionalAction(nextActions[first])) {
    return actions;
  }

  const property = branchProperty(branch);
  nextActions[first] = cloneBranchWithChildren(
    nextActions[first] as ConditionalAction,
    branch,
    updateActionAtPath((nextActions[first] as ConditionalAction)[property], nestedRest, updatedAction)
  );
  return nextActions;
}

export function insertActionAfterPath(actions: DialogAction[], path: ActionPath, actionToInsert: DialogAction): DialogAction[] {
  const [first, ...rest] = path;
  if (typeof first !== 'number') {
    return actions;
  }

  if (rest.length === 0) {
    const nextActions = [...actions];
    nextActions.splice(first + 1, 0, actionToInsert);
    return nextActions;
  }

  const [branch, ...nestedRest] = rest;
  if ((branch !== 'then' && branch !== 'else') || !isConditionalAction(actions[first])) {
    return actions;
  }

  const parent = actions[first] as ConditionalAction;
  const property = branchProperty(branch);
  const nextActions = [...actions];
  nextActions[first] = cloneBranchWithChildren(
    parent,
    branch,
    insertActionAfterPath(parent[property], nestedRest, actionToInsert)
  );
  return nextActions;
}

export function appendActionToBranch(actions: DialogAction[], path: ActionPath, branch: ActionBranchKey, actionToAppend: DialogAction): DialogAction[] {
  const target = getActionAtPath(actions, path);
  if (!isConditionalAction(target)) {
    return actions;
  }

  const property = branchProperty(branch);
  const branchActions = [...target[property], actionToAppend];
  return updateActionAtPath(actions, path, {
    ...target,
    [property]: branchActions
  });
}

export function deleteActionAtPath(actions: DialogAction[], path: ActionPath): DialogAction[] {
  const [first, ...rest] = path;
  if (typeof first !== 'number') {
    return actions;
  }

  if (rest.length === 0) {
    return actions.filter((_, index) => index !== first);
  }

  const [branch, ...nestedRest] = rest;
  if ((branch !== 'then' && branch !== 'else') || !isConditionalAction(actions[first])) {
    return actions;
  }

  const parent = actions[first] as ConditionalAction;
  const property = branchProperty(branch);
  const nextActions = [...actions];
  nextActions[first] = cloneBranchWithChildren(
    parent,
    branch,
    deleteActionAtPath(parent[property], nestedRest)
  );
  return nextActions;
}

export function flattenActionPaths(actions: DialogAction[], prefix: ActionPath = []): ActionPath[] {
  const paths: ActionPath[] = [];

  actions.forEach((action, index) => {
    const path = [...prefix, index];
    paths.push(path);

    if (isConditionalAction(action)) {
      paths.push(...flattenActionPaths(action.thenActions, [...path, 'then']));
      paths.push(...flattenActionPaths(action.elseActions, [...path, 'else']));
    }
  });

  return paths;
}

/**
 * The list as the editor shows it (#322): a recognised quest step is one item
 * spanning its lines, every other action is an item of its own.
 */
export interface ActionListItem {
  start: number;
  end: number;
  step?: QuestStep;
}

export function getActionListItems(actions: readonly DialogAction[]): ActionListItem[] {
  const items: ActionListItem[] = [];
  const steps = recognizeQuestSteps(actions);
  let next = 0;
  for (let i = 0; i < actions.length;) {
    const step = steps[next]?.start === i ? steps[next++] : undefined;
    const end = step ? step.end : i + 1;
    items.push(step ? { start: i, end, step } : { start: i, end });
    i = end;
  }
  return items;
}

/** Move item `from` to item position `to`, carrying all of a step's lines. */
export function moveActionListItem(actions: readonly DialogAction[], from: number, to: number): DialogAction[] {
  const items = getActionListItems(actions);
  const source = items[from];
  if (!source || from === to || to < 0 || to >= items.length) return actions.slice();
  const block = actions.slice(source.start, source.end);
  const rest = [...actions.slice(0, source.start), ...actions.slice(source.end)];
  const others = items.filter((_, i) => i !== from);
  const count = source.end - source.start;
  const at = to < others.length
    ? others[to].start - (others[to].start > source.start ? count : 0)
    : rest.length;
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

/**
 * Paths a keyboard walk visits: like flattenActionPaths, but a quest step is
 * visited once, at its first line — the others have no card.
 */
export function flattenVisibleActionPaths(actions: DialogAction[], prefix: ActionPath = []): ActionPath[] {
  const paths: ActionPath[] = [];
  for (const { start } of getActionListItems(actions)) {
    const action = actions[start];
    const path = [...prefix, start];
    paths.push(path);
    if (isConditionalAction(action)) {
      paths.push(...flattenVisibleActionPaths(action.thenActions, [...path, 'then']));
      paths.push(...flattenVisibleActionPaths(action.elseActions, [...path, 'else']));
    }
  }
  return paths;
}

/** Replace the list at `pathPrefix` (the root, or a conditional branch) with `transform` of it. */
export function patchActionsAtLevel(
  actions: DialogAction[],
  pathPrefix: ActionPath,
  transform: (actions: DialogAction[]) => DialogAction[]
): DialogAction[] {
  if (pathPrefix.length === 0) return transform(actions);
  const parentPath = pathPrefix.slice(0, -1);
  const branch = pathPrefix[pathPrefix.length - 1];
  const parent = getActionAtPath(actions, parentPath);
  if ((branch !== 'then' && branch !== 'else') || !isConditionalAction(parent)) return actions;
  return updateActionAtPath(actions, parentPath, cloneBranchWithChildren(parent, branch, transform(parent[branchProperty(branch)])));
}

export function moveActionWithinLevel(
  actions: DialogAction[],
  pathPrefix: ActionPath,
  sourceIndex: number,
  destinationIndex: number
): DialogAction[] {
  if (sourceIndex === destinationIndex) return actions;

  if (pathPrefix.length === 0) {
    // Top-level move
    const result = [...actions];
    const [moved] = result.splice(sourceIndex, 1);
    result.splice(destinationIndex, 0, moved);
    return result;
  }

  // Nested move (inside a conditional branch)
  const parentPath = pathPrefix.slice(0, -1);
  const branch = pathPrefix[pathPrefix.length - 1] as ActionBranchKey;
  const parent = getActionAtPath(actions, parentPath);
  if (!parent || parent.type !== 'ConditionalAction') return actions;

  const property = branch === 'then' ? 'thenActions' : 'elseActions';
  const branchActions = [...(parent as ConditionalAction)[property]];
  const [moved] = branchActions.splice(sourceIndex, 1);
  branchActions.splice(destinationIndex, 0, moved);

  return updateActionAtPath(actions, parentPath, {
    ...parent,
    [property]: branchActions
  });
}

export function actionPathToKey(path: ActionPath): string {
  return path.join('.');
}

/**
 * Collect all Choice actions, including those nested inside ConditionalAction
 * branches, in visible order.
 */
export function collectChoiceActions(actions: DialogAction[]): DialogAction[] {
  const collected: DialogAction[] = [];

  actions.forEach((action) => {
    if (action.type === 'Choice') {
      collected.push(action);
      return;
    }

    if (isConditionalAction(action)) {
      collected.push(...collectChoiceActions(action.thenActions));
      collected.push(...collectChoiceActions(action.elseActions));
    }
  });

  return collected;
}

/**
 * Rewrite `Choice.targetFunction` references anywhere in the action tree
 * (including ConditionalAction branches). `mapTarget` returns the new target
 * name, or undefined to leave a choice unchanged. Unchanged subtrees keep
 * reference identity; if nothing changed the input array is returned as-is.
 */
export function mapChoiceTargetFunctions(
  actions: DialogAction[],
  mapTarget: (target: string) => string | undefined,
  mapDialog: (dialog: string) => string | undefined = () => undefined
): { actions: DialogAction[]; changed: boolean } {
  let changed = false;

  const nextActions = actions.map((action) => {
    if (action.type === 'Choice') {
      const target = (action as DialogAction & { targetFunction?: unknown }).targetFunction;
      const dialog = (action as DialogAction & { dialogRef?: unknown }).dialogRef;
      const newTarget = typeof target === 'string' ? mapTarget(target) : undefined;
      const newDialog = typeof dialog === 'string' ? mapDialog(dialog) : undefined;
      if ((newTarget !== undefined && newTarget !== target) || (newDialog !== undefined && newDialog !== dialog)) {
        changed = true;
        return {
          ...action,
          ...(newTarget !== undefined ? { targetFunction: newTarget } : {}),
          ...(newDialog !== undefined ? { dialogRef: newDialog } : {}),
        };
      }
      return action;
    }

    if (action.type === 'ClearChoicesAction') {
      const dialog = (action as DialogAction & { dialog?: unknown }).dialog;
      if (typeof dialog === 'string') {
        const newDialog = mapDialog(dialog);
        if (newDialog !== undefined && newDialog !== dialog) {
          changed = true;
          return { ...action, dialog: newDialog };
        }
      }
      return action;
    }

    if (isConditionalAction(action)) {
      const thenResult = mapChoiceTargetFunctions(action.thenActions, mapTarget, mapDialog);
      const elseResult = mapChoiceTargetFunctions(action.elseActions, mapTarget, mapDialog);
      if (thenResult.changed || elseResult.changed) {
        changed = true;
        return {
          ...action,
          thenActions: thenResult.actions,
          elseActions: elseResult.actions
        };
      }
    }

    return action;
  });

  return changed ? { actions: nextActions, changed } : { actions, changed };
}

export function collectDialogLineActions(actions: DialogAction[]): DialogAction[] {
  const collected: DialogAction[] = [];

  actions.forEach((action) => {
    if (action.type === 'DialogLine') {
      collected.push(action);
      return;
    }

    if (isConditionalAction(action)) {
      collected.push(...collectDialogLineActions(action.thenActions));
      collected.push(...collectDialogLineActions(action.elseActions));
    }
  });

  return collected;
}

/**
 * Collect all dialog line actions from all functions in a semantic model
 * that belong to the same dialog (matched by name prefix).
 * Optionally excludes a specific function (e.g. the one being live-edited).
 */
export function collectAllDialogLineActionsFromModel(
  semanticModel: { functions: Record<string, { actions?: DialogAction[] }> },
  dialogName: string,
  excludeFunctionName?: string | null
): DialogAction[] {
  const baseName = resolveDialogNameForLineId(dialogName);
  if (!baseName) return [];

  const collected: DialogAction[] = [];
  for (const [funcName, func] of Object.entries(semanticModel.functions)) {
    if (funcName === excludeFunctionName) continue;
    if (funcName === baseName || funcName.startsWith(baseName + '_')) {
      collected.push(...collectDialogLineActions(func.actions || []));
    }
  }
  return collected;
}
