import type { LintRule, Problem } from '../types';

/**
 * `orphaned-function`: flags dialog functions that nothing references.
 *
 * A function is considered referenced when it is named by a dialog's
 * `information` or `condition` property, targeted by a `Choice` action (including
 * choices nested in conditional branches), or listed in another function's
 * `calls` array. Matching is case-insensitive across the whole project; all of
 * these references are pre-extracted into the per-file facts.
 */
export const orphanedFunctionRule: LintRule = (view): Problem[] => {
  const referencedKeys = new Set<string>();

  const addRef = (name: string | undefined): void => {
    if (name && name.trim().length > 0) {
      referencedKeys.add(name.trim().toLowerCase());
    }
  };

  for (const file of view.fileFacts) {
    for (const dialog of file.facts.dialogs) {
      addRef(dialog.informationRef);
      addRef(dialog.conditionRef);
    }
    for (const func of file.facts.functions) {
      for (const target of func.choiceTargets) {
        addRef(target);
      }
      for (const call of func.calls) {
        addRef(call);
      }
    }
  }

  const problems: Problem[] = [];

  for (const [key, entry] of view.functionsByKey) {
    if (referencedKeys.has(key)) {
      continue;
    }
    problems.push({
      id: `orphaned-function:${entry.filePath}:${entry.func.name}`,
      rule: 'orphaned-function',
      severity: 'warning',
      message: `Function "${entry.func.name}" is not referenced by any dialog, choice, or function call.`,
      filePath: entry.filePath,
      functionName: entry.func.name
    });
  }

  return problems;
};
