import type { FunctionEntry, FunctionFacts, LintRule, Problem, ProjectView } from '../types';
import { bodyKey } from '../fileFacts';

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

  // A name resolves to its first signature, so that is what choice targets
  // reach; a raw overload (#574) is only ever a start of its own.
  const starts: FunctionEntry[] = [...view.functionsByKey.values()];
  for (const { filePath, facts } of view.fileFacts) {
    for (const func of facts.overloads || []) starts.push({ func, filePath });
  }

  for (const entry of starts) {
    if (!entry.func.hasChoice) {
      continue;
    }
    if (!reachableClears(entry.func, view)) {
      problems.push({
        id: `choice-no-clearchoices:${entry.filePath}:${bodyKey(entry.func)}`,
        rule: 'choice-no-clearchoices',
        severity: 'warning',
        message: `Function "${entry.func.name}" opens a choice menu (Info_AddChoice) with no Info_ClearChoices in any reachable choice target.`,
        locus: { kind: 'script', filePath: entry.filePath, functionName: entry.func.name, line: entry.func.line }
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
    // An overload shares its first signature's name, not its body (#574).
    const nextKey = bodyKey(func).trim().toLowerCase();
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
