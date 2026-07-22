import type { LintRule, Problem } from '../types';
import type { NpcKnowsInfoCondition } from '../../../../shared/types';

/**
 * `knowsinfo-dangling`: flags `Npc_KnowsInfo` checks whose `dialogRef` does not
 * name any dialog known to the project.
 *
 * A `NpcKnowsInfoCondition` only ever appears in a function's flat `conditions`
 * array, so this walks each function's conditions and matches the referenced
 * dialog name case-insensitively against the aggregated dialog names.
 */
export const knowsInfoDanglingRule: LintRule = (view): Problem[] => {
  const problems: Problem[] = [];

  for (const file of view.files) {
    for (const func of Object.values(file.model.functions || {})) {
      func.conditions.forEach((condition, i) => {
        if (condition.type !== 'NpcKnowsInfoCondition') {
          return;
        }
        const { dialogRef } = condition as NpcKnowsInfoCondition;
        if (typeof dialogRef !== 'string' || dialogRef.length === 0) {
          return;
        }
        if (view.dialogNameKeys.has(dialogRef.trim().toLowerCase())) {
          return;
        }
        problems.push({
          id: `knowsinfo-dangling:${file.filePath}:${func.name}:${i}`,
          rule: 'knowsinfo-dangling',
          severity: 'error',
          message: `Function "${func.name}" checks Npc_KnowsInfo for "${dialogRef}", which is not a known dialog.`,
          filePath: file.filePath,
          functionName: func.name
        });
      });
    }
  }

  return problems;
};
