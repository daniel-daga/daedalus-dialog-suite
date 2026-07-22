import type { LintRule, Problem } from '../types';
import { forEachAction } from '../walk';

/**
 * `orphaned-function`: flags dialog functions that nothing references.
 *
 * A function is considered referenced when it is named by a dialog's
 * `information` or `condition` property, targeted by a `Choice` action (including
 * choices nested in conditional branches), or listed in another function's
 * `calls` array. Matching is case-insensitive across the whole project.
 */
export const orphanedFunctionRule: LintRule = (view): Problem[] => {
  const referencedKeys = new Set<string>();

  const addRef = (name: string | undefined): void => {
    if (name && name.trim().length > 0) {
      referencedKeys.add(name.trim().toLowerCase());
    }
  };

  for (const file of view.files) {
    for (const dialog of Object.values(file.model.dialogs || {})) {
      const { information, condition } = dialog.properties;
      addRef(typeof information === 'string' ? information : information?.name);
      addRef(typeof condition === 'string' ? condition : condition?.name);
    }
    for (const func of Object.values(file.model.functions || {})) {
      forEachAction(func.actions, (action) => {
        if (action.type === 'Choice') {
          addRef(action.targetFunction);
        }
      });
      for (const call of func.calls || []) {
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
