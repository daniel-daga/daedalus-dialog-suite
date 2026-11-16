import type { LintRule, Problem } from '../types';
import { bodyKey, functionBodies } from '../fileFacts';

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
    for (const func of functionBodies(file.facts)) {
      for (const [index, { dialogRef, line }] of func.knowsInfoRefs.entries()) {
        if (view.dialogNameKeys.has(dialogRef.trim().toLowerCase())) {
          continue;
        }
        problems.push({
          id: `knowsinfo-dangling:${file.filePath}:${bodyKey(func)}:${index}`,
          rule: 'knowsinfo-dangling',
          severity: 'error',
          message: `Function "${func.name}" checks Npc_KnowsInfo for "${dialogRef}", which is not a known dialog.`,
          locus: { kind: 'script', filePath: file.filePath, functionName: func.name, line }
        });
      }
    }
  }

  return problems;
};
