import type { ConditionalAction, DialogAction } from '../types/global';
import { resolveDialogNameForLineId } from './actionFactory';

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
  mapTarget: (target: string) => string | undefined
): { actions: DialogAction[]; changed: boolean } {
  let changed = false;

  const nextActions = actions.map((action) => {
    if (action.type === 'Choice') {
      const target = (action as DialogAction & { targetFunction?: unknown }).targetFunction;
      if (typeof target === 'string') {
        const newTarget = mapTarget(target);
        if (newTarget !== undefined && newTarget !== target) {
          changed = true;
          return { ...action, targetFunction: newTarget };
        }
      }
      return action;
    }

    if (isConditionalAction(action)) {
      const thenResult = mapChoiceTargetFunctions(action.thenActions, mapTarget);
      const elseResult = mapChoiceTargetFunctions(action.elseActions, mapTarget);
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
