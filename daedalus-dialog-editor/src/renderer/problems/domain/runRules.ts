import type { LintRule, Problem, ProjectView } from './types';
import { npcNotFoundRule } from './rules/npcNotFound';
import { knowsInfoDanglingRule } from './rules/knowsInfoDangling';
import { choiceNoClearChoicesRule } from './rules/choiceNoClearChoices';
import { orphanedFunctionRule } from './rules/orphanedFunction';
import { voiceIdRule } from './rules/voiceId';

/** Every lint rule the Problems panel runs, in declaration order. */
export const ALL_RULES: readonly LintRule[] = [
  npcNotFoundRule,
  knowsInfoDanglingRule,
  choiceNoClearChoicesRule,
  orphanedFunctionRule,
  voiceIdRule
];

const SEVERITY_ORDER: Record<Problem['severity'], number> = { error: 0, warning: 1 };

/**
 * Runs every rule over the project view and returns a stably-ordered list:
 * errors before warnings, then by file path, then by message. Stable ordering
 * keeps the panel from reshuffling between scans of an unchanged project.
 */
export function runRules(view: ProjectView): Problem[] {
  const problems = ALL_RULES.flatMap((rule) => rule(view));

  return problems.sort((a, b) => {
    if (SEVERITY_ORDER[a.severity] !== SEVERITY_ORDER[b.severity]) {
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    }
    if (a.filePath !== b.filePath) {
      return a.filePath.localeCompare(b.filePath);
    }
    return a.message.localeCompare(b.message);
  });
}
