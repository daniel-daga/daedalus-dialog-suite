import type { LintRule, Problem, ProjectView, FunctionEntry } from '../types';
import { forEachAction } from '../walk';
import type { DialogFunction } from '../../../../shared/types';

/**
 * `choice-no-clearchoices`: flags an info function that opens a choice menu with
 * `Info_AddChoice` but whose choice-target chain never calls `Info_ClearChoices`.
 *
 * The Daedalus convention adds a choice in one function and clears it in the
 * *target* function, so a per-function check would false-flag the adder. This
 * rule instead follows `Choice.targetFunction` transitively (guarding cycles)
 * and only warns when no reachable function clears the menu.
 */
export const choiceNoClearChoicesRule: LintRule = (view: ProjectView): Problem[] => {
  const problems: Problem[] = [];

  for (const [, entry] of view.functionsByKey) {
    if (!hasChoice(entry.func)) {
      continue;
    }
    if (!reachableClears(entry.func, view)) {
      problems.push({
        id: `choice-no-clearchoices:${entry.filePath}:${entry.func.name}`,
        rule: 'choice-no-clearchoices',
        severity: 'warning',
        message: `Function "${entry.func.name}" opens a choice menu (Info_AddChoice) with no Info_ClearChoices in any reachable choice target.`,
        filePath: entry.filePath,
        functionName: entry.func.name
      });
    }
  }

  return problems;
};

/** True when the function contains at least one `Choice` action. */
function hasChoice(func: DialogFunction): boolean {
  let found = false;
  forEachAction(func.actions, (action) => {
    if (action.type === 'Choice') {
      found = true;
    }
  });
  return found;
}

/** True when the function contains at least one `ClearChoicesAction`. */
function hasClearChoices(func: DialogFunction): boolean {
  let found = false;
  forEachAction(func.actions, (action) => {
    if (action.type === 'ClearChoicesAction') {
      found = true;
    }
  });
  return found;
}

/**
 * True when any function reachable from `start` (including itself) via
 * `Choice.targetFunction` clears the menu. Cycles are guarded by a visited set
 * of lowercased function keys.
 */
function reachableClears(start: DialogFunction, view: ProjectView): boolean {
  const visited = new Set<string>();
  const stack: FunctionEntry[] = [];

  const enqueue = (func: DialogFunction, filePath: string): void => {
    const nextKey = func.name.trim().toLowerCase();
    if (visited.has(nextKey)) {
      return;
    }
    visited.add(nextKey);
    stack.push({ func, filePath });
  };

  enqueue(start, '');

  while (stack.length > 0) {
    const { func } = stack.pop() as FunctionEntry;
    if (hasClearChoices(func)) {
      return true;
    }
    forEachAction(func.actions, (action) => {
      if (action.type === 'Choice') {
        const target = view.functionsByKey.get(action.targetFunction.trim().toLowerCase());
        if (target) {
          enqueue(target.func, target.filePath);
        }
      }
    });
  }

  return false;
}
