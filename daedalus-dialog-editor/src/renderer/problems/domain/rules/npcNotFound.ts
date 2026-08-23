import type { LintRule, Problem } from '../types';

/**
 * Flags dialogs whose `npc` property names an NPC that no file in the project
 * defines. Matching is case-insensitive against {@link ProjectView.npcNameKeys};
 * dialogs with a missing or empty `npc` are left to a different rule.
 */
export const npcNotFoundRule: LintRule = (view) => {
  const problems: Problem[] = [];

  for (const file of view.fileFacts) {
    for (const dialog of file.facts.dialogs) {
      const npc = dialog.npc;
      if (typeof npc !== 'string' || npc.trim() === '') {
        continue;
      }
      if (view.npcNameKeys.has(npc.trim().toLowerCase())) {
        continue;
      }
      problems.push({
        id: `npc-not-found:${file.filePath}:${dialog.name}`,
        rule: 'npc-not-found',
        severity: 'error',
        message: `Dialog "${dialog.name}" references NPC "${npc}", which is not defined in the project.`,
        filePath: file.filePath,
        dialogName: dialog.name,
        npc
      });
    }
  }

  return problems;
};
