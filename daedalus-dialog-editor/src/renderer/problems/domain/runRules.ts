import type { LintRule, Problem, ProjectView } from './types';
import { npcNotFoundRule } from './rules/npcNotFound';
import { knowsInfoDanglingRule } from './rules/knowsInfoDangling';
import { choiceNoClearChoicesRule } from './rules/choiceNoClearChoices';
import { orphanedFunctionRule } from './rules/orphanedFunction';
import { voiceIdRule } from './rules/voiceId';
import { waypointNotInWorldRule } from './rules/waypointNotInWorld';
import { duplicateSpawnRule } from './rules/duplicateSpawn';

/** Every lint rule the Problems panel runs, in declaration order. */
export const ALL_RULES: readonly LintRule[] = [
  npcNotFoundRule,
  knowsInfoDanglingRule,
  choiceNoClearChoicesRule,
  orphanedFunctionRule,
  voiceIdRule,
  waypointNotInWorldRule,
  duplicateSpawnRule
];

const SEVERITY_ORDER: Record<Problem['severity'], number> = { error: 0, warning: 1 };

/**
 * Maps each function used as a dialog's `information` or `condition` back to that
 * dialog's name (lowercased key → original dialog name). Lets a function-based
 * problem (voice id, orphan, dangling KnowsInfo) navigate straight to the dialog
 * that owns its function.
 */
function buildFunctionToDialogName(view: ProjectView): Map<string, string> {
  const map = new Map<string, string>();
  const record = (name: string | undefined, dialogName: string): void => {
    if (name) {
      const key = name.trim().toLowerCase();
      if (!map.has(key)) map.set(key, dialogName);
    }
  };
  for (const { facts } of view.fileFacts) {
    for (const dialog of facts.dialogs) {
      record(dialog.informationRef, dialog.name);
      record(dialog.conditionRef, dialog.name);
    }
  }
  return map;
}

/**
 * Runs every rule over the project view and returns a stably-ordered list:
 * errors before warnings, then by file path, then by message. Stable ordering
 * keeps the panel from reshuffling between scans of an unchanged project.
 * Function-based problems are enriched with the owning dialog so a click can
 * navigate to it.
 */
export function runRules(view: ProjectView): Problem[] {
  const functionToDialogName = buildFunctionToDialogName(view);

  const problems = ALL_RULES.flatMap((rule) => rule(view)).map((problem) => {
    const { locus } = problem;
    if (locus.kind !== 'script' || locus.dialogName || !locus.functionName) return problem;
    const dialogName = functionToDialogName.get(locus.functionName.trim().toLowerCase());
    return dialogName ? { ...problem, locus: { ...locus, dialogName } } : problem;
  });

  return problems.sort(compareProblems);
}

/**
 * The panel's total order: errors first, then by file path, then by message.
 * A world problem has no file path, so it sorts after every script problem of
 * its severity — one group, in one place, rather than interleaved with files
 * it has nothing to do with.
 */
export function compareProblems(a: Problem, b: Problem): number {
  if (SEVERITY_ORDER[a.severity] !== SEVERITY_ORDER[b.severity]) {
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  }
  const aFile = a.locus.kind === 'script' ? a.locus.filePath : null;
  const bFile = b.locus.kind === 'script' ? b.locus.filePath : null;
  if (aFile === null || bFile === null) {
    if (aFile !== bFile) return aFile === null ? 1 : -1;
  } else if (aFile !== bFile) {
    return aFile.localeCompare(bFile);
  }
  return a.message.localeCompare(b.message);
}
