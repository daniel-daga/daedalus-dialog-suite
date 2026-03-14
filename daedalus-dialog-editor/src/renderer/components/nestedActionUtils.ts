import type { ConditionalAction, DialogAction } from '../types/global';

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

export function actionPathToKey(path: ActionPath): string {
  return path.join('.');
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
