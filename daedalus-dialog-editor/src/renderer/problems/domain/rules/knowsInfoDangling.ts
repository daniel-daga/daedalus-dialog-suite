import type { LintRule, Problem } from '../types';

/**
 * `knowsinfo-dangling`: flags `Npc_KnowsInfo` checks whose `dialogRef` does not
 * name any dialog known to the project.
 *
 * The per-function `Npc_KnowsInfo` refs are pre-extracted into the file facts;
 * this matches each referenced dialog name case-insensitively against the
 * aggregated dialog names.
 */
export const knowsInfoDanglingRule: LintRule = (view): Problem[] => {
  const problems: Problem[] = [];

  for (const file of view.fileFacts) {
    for (const func of file.facts.functions) {
      for (const { index, dialogRef } of func.knowsInfoRefs) {
        if (view.dialogNameKeys.has(dialogRef.trim().toLowerCase())) {
          continue;
        }
        problems.push({
          id: `knowsinfo-dangling:${file.filePath}:${func.name}:${index}`,
          rule: 'knowsinfo-dangling',
          severity: 'error',
          message: `Function "${func.name}" checks Npc_KnowsInfo for "${dialogRef}", which is not a known dialog.`,
          filePath: file.filePath,
          functionName: func.name
        });
      }
    }
  }

  return problems;
};
