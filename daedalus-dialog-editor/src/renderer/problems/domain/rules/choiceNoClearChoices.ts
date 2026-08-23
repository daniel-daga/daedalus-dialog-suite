import type { FunctionFacts, LintRule, Problem, ProjectView } from '../types';

/**
 * `choice-no-clearchoices`: flags an info function that opens a choice menu with
 * `Info_AddChoice` but whose choice-target chain never calls `Info_ClearChoices`.
 *
 * The Daedalus convention adds a choice in one function and clears it in the
 * *target* function, so a per-function check would false-flag the adder. This
 * rule instead follows the pre-extracted choice targets transitively (guarding
 * cycles) and only warns when no reachable function clears the menu.
 */
export const choiceNoClearChoicesRule: LintRule = (view: ProjectView): Problem[] => {
  const problems: Problem[] = [];

  for (const [, entry] of view.functionsByKey) {
    if (!entry.func.hasChoice) {
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

/**
 * True when any function reachable from `start` (including itself) via its
 * choice targets clears the menu. Cycles are guarded by a visited set of
 * lowercased function keys.
 */
function reachableClears(start: FunctionFacts, view: ProjectView): boolean {
  const visited = new Set<string>();
  const stack: FunctionFacts[] = [];

  const enqueue = (func: FunctionFacts): void => {
    const nextKey = func.name.trim().toLowerCase();
    if (visited.has(nextKey)) {
      return;
    }
    visited.add(nextKey);
    stack.push(func);
  };

  enqueue(start);

  while (stack.length > 0) {
    const func = stack.pop() as FunctionFacts;
    if (func.hasClearChoices) {
      return true;
    }
    for (const targetName of func.choiceTargets) {
      const target = view.functionsByKey.get(targetName.trim().toLowerCase());
      if (target) {
        enqueue(target.func);
      }
    }
  }

  return false;
}
